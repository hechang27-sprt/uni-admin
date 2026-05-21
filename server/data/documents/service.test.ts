import { inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { z } from "zod";

import { tenantsTable } from "../../db/schema";
import { testDb } from "../../util/drizzle";
import {
  createCollectionRegistry,
  createDocumentService,
  createRemoteProjectionMapper,
  DocumentServiceError,
  DrizzleDocumentRepository,
  InMemoryDocumentRepository,
  type DocumentRepository,
  type DocumentService,
  type RemoteCollectionAdapter,
} from ".";

const tenantA = "00000000-0000-4000-8000-000000000001";
const tenantB = "00000000-0000-4000-8000-000000000002";
let testDatabaseReady = false;

const taskSchema = z.object({
  title: z.string(),
  status: z.enum(["draft", "submitted", "done"]),
  priority: z.number(),
  tags: z.array(z.string()).default([]),
  nested: z
    .object({
      score: z.number(),
      owner: z.string(),
    })
    .optional(),
});

type TaskDocument = z.infer<typeof taskSchema>;

const remoteTaskSchema = z.object({
  remote_id: z.string(),
  name: z.string(),
  phase: z.enum(["draft", "submitted", "done"]),
  priority: z.number(),
  labels: z.array(z.string()).default([]),
  owner: z.object({
    name: z.string(),
    score: z.number(),
  }),
});

type RemoteTask = z.infer<typeof remoteTaskSchema>;

const mapRemoteTask = createRemoteProjectionMapper<RemoteTask, TaskDocument>({
  schema: remoteTaskSchema,
  getRemoteId: (remote) => remote.remote_id,
  mapData: (remote) => ({
    title: remote.name,
    status: remote.phase,
    priority: remote.priority,
    tags: remote.labels,
    nested: {
      owner: remote.owner.name,
      score: remote.owner.score,
    },
  }),
});

const testTenantIds = [tenantA, tenantB];

interface RepositoryTestCase {
  name: string;
  createRepository: () => DocumentRepository;
  beforeAll?: () => Promise<void>;
  beforeEach?: () => Promise<void>;
  afterEach?: () => Promise<void>;
  afterAll?: () => Promise<void>;
}

const repositoryCases = [
  {
    name: "in-memory repository",
    createRepository: () => new InMemoryDocumentRepository(),
  },
  {
    name: "drizzle repository",
    createRepository: () => new DrizzleDocumentRepository(testDb),
    beforeAll: async () => {
      await migrate(testDb, { migrationsFolder: "drizzle" });
      testDatabaseReady = true;
    },
    beforeEach: resetTestDatabase,
    afterEach: cleanupTestDatabase,
    afterAll: async () => {
      if (testDatabaseReady) {
        await cleanupTestDatabase();
      }
      await testDb.$client.end();
    },
  },
] satisfies RepositoryTestCase[];

function createService(repository: DocumentRepository): DocumentService {
  const registry = createCollectionRegistry([
    {
      name: "tasks",
      schema: taskSchema,
      schemaVersion: 1,
    },
  ]);

  return createDocumentService({
    registry,
    repository,
  });
}

interface RemoteAdapterCalls {
  syncOne: number;
  syncList: number;
  createRemote: number;
  updateRemote: number;
  deleteRemote: number;
}

interface RemoteAdapterOutputs {
  syncOne: { requestId: string };
  syncList: { nextCursor: string | null };
  create: { requestId: string };
  update: { requestId: string };
  delete: { requestId: string };
}

function createRemoteService(repository: DocumentRepository): {
  service: DocumentService;
  calls: RemoteAdapterCalls;
  setRemoteFailure: (failure: Error | null) => void;
} {
  const calls: RemoteAdapterCalls = {
    syncOne: 0,
    syncList: 0,
    createRemote: 0,
    updateRemote: 0,
    deleteRemote: 0,
  };
  let remoteFailure: Error | null = null;
  const remoteRows = new Map<string, RemoteTask>([
    [
      "remote-1",
      {
        remote_id: "remote-1",
        name: "Remote draft",
        phase: "draft",
        priority: 1,
        labels: ["remote"],
        owner: { name: "Ada", score: 10 },
      },
    ],
  ]);

  const adapter: RemoteCollectionAdapter<
    TaskDocument,
    { remoteId: string },
    Record<string, never>,
    RemoteTask,
    Partial<RemoteTask>,
    Record<string, never>,
    RemoteAdapterOutputs
  > = {
    remoteSource: "fixture-api",
    idempotency: {
      create: {
        stableKey: (input) => `create:${input.remote_id}`,
      },
    },
    async syncOne(input) {
      calls.syncOne += 1;
      const row = remoteRows.get(input.remoteId);
      return {
        projection: row ? mapRemoteTask(row) : null,
        output: { requestId: `sync-one-${calls.syncOne}` },
      };
    },
    async syncList() {
      calls.syncList += 1;
      return {
        projections: [...remoteRows.values()].map(mapRemoteTask),
        output: { nextCursor: null },
      };
    },
    async createRemote(input) {
      calls.createRemote += 1;
      if (remoteFailure) {
        throw remoteFailure;
      }
      remoteRows.set(input.remote_id, input);
      return {
        projection: mapRemoteTask(input),
        output: { requestId: `create-${calls.createRemote}` },
      };
    },
    async updateRemote(input, context) {
      calls.updateRemote += 1;
      if (remoteFailure) {
        throw remoteFailure;
      }
      const remoteId = context.current.remoteId ?? input.remote_id;
      if (!remoteId) {
        throw new Error("Missing remote id");
      }
      const current = remoteRows.get(remoteId);
      if (!current) {
        throw new Error("Remote row not found");
      }
      const updated = {
        ...current,
        ...input,
        remote_id: remoteId,
      };
      remoteRows.set(remoteId, updated);
      return {
        projection: mapRemoteTask(updated),
        output: { requestId: `update-${calls.updateRemote}` },
      };
    },
    async deleteRemote() {
      calls.deleteRemote += 1;
      if (remoteFailure) {
        throw remoteFailure;
      }
      return { output: { requestId: `delete-${calls.deleteRemote}` } };
    },
  };

  const registry = createCollectionRegistry([
    {
      name: "remoteTasks",
      schema: taskSchema,
      schemaVersion: 1,
      remoteAdapter: adapter,
    },
  ]);

  return {
    service: createDocumentService({ registry, repository }),
    calls,
    setRemoteFailure: (failure) => {
      remoteFailure = failure;
    },
  };
}

async function resetTestDatabase(): Promise<void> {
  await cleanupTestDatabase();
  await testDb.insert(tenantsTable).values([
    { id: tenantA, name: "Test Tenant A" },
    { id: tenantB, name: "Test Tenant B" },
  ]);
}

async function cleanupTestDatabase(): Promise<void> {
  await testDb
    .delete(tenantsTable)
    .where(inArray(tenantsTable.id, testTenantIds));
}

describe.each(repositoryCases)(
  "local document service ($name)",
  (repositoryCase) => {
    beforeAll(async () => {
      await repositoryCase.beforeAll?.();
    });

    beforeEach(async () => {
      await repositoryCase.beforeEach?.();
    });

    afterEach(async () => {
      await repositoryCase.afterEach?.();
    });

    afterAll(async () => {
      await repositoryCase.afterAll?.();
    });

    function createTestService(): DocumentService {
      return createService(repositoryCase.createRepository());
    }

    it("rejects unknown collections and invalid data before persistence", async () => {
      const service = createTestService();

      await expect(
        service.create({
          tenantId: tenantA,
          collection: "unknown",
          data: { title: "Draft", status: "draft", priority: 1 },
        }),
      ).rejects.toMatchObject({ code: "UNKNOWN_COLLECTION" });

      await expect(
        service.create({
          tenantId: tenantA,
          collection: "tasks",
          data: { title: "Draft", status: "invalid", priority: 1 },
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("covers create, getById, list, update, patch, softDelete, restore, and hardDelete", async () => {
      const service = createTestService();
      const created = await service.create<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        data: { title: "Draft", status: "draft", priority: 1, tags: [] },
      });

      expect(created.version).toBe(1);
      expect(created.schemaVersion).toBe(1);

      const updated = await service.update<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        expectedVersion: created.version,
        data: {
          title: "Submitted",
          status: "submitted",
          priority: 2,
          tags: ["review"],
        },
      });

      expect(updated.version).toBe(2);

      const patched = await service.patch<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        expectedVersion: updated.version,
        patch: [
          { op: "test", path: "/status", value: "submitted" },
          { op: "replace", path: "/status", value: "done" },
          { op: "add", path: "/tags/-", value: "closed" },
        ],
      });

      expect(patched.data).toMatchObject({
        status: "done",
        tags: ["review", "closed"],
      });

      const listed = await service.list<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        sort: [
          { field: { kind: "metadata", name: "createdAt" }, direction: "asc" },
        ],
      });

      expect(listed.items).toHaveLength(1);
      expect(listed.hasMore).toBe(false);

      const deleted = await service.softDelete({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        expectedVersion: patched.version,
      });

      expect(deleted.deletedAt).toBeInstanceOf(Date);
      await expect(
        service.getById({
          tenantId: tenantA,
          collection: "tasks",
          id: created.id,
        }),
      ).resolves.toBeNull();

      const restored = await service.restore({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        expectedVersion: deleted.version,
      });

      expect(restored.deletedAt).toBeNull();

      await service.hardDelete({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        confirmHardDelete: true,
      });

      await expect(
        service.getById({
          tenantId: tenantA,
          collection: "tasks",
          id: created.id,
          includeDeleted: true,
        }),
      ).resolves.toBeNull();
    });

    it("enforces tenant isolation on reads and mutations", async () => {
      const service = createTestService();
      const created = await service.create<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        data: { title: "Private", status: "draft", priority: 1, tags: [] },
      });

      await expect(
        service.getById({
          tenantId: tenantB,
          collection: "tasks",
          id: created.id,
        }),
      ).resolves.toBeNull();

      await expect(
        service.update<TaskDocument>({
          tenantId: tenantB,
          collection: "tasks",
          id: created.id,
          expectedVersion: created.version,
          data: {
            title: "Cross tenant",
            status: "done",
            priority: 5,
            tags: [],
          },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("supports JSONB-path filters, metadata filters, sorting, pagination bounds, and deleted inclusion", async () => {
      const service = createTestService();

      const low = await service.create<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        data: {
          title: "Low",
          status: "draft",
          priority: 1,
          tags: [],
          nested: { score: 10, owner: "Ada" },
        },
      });
      await service.create<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        data: {
          title: "High",
          status: "submitted",
          priority: 3,
          tags: [],
          nested: { score: 30, owner: "Grace" },
        },
      });
      await service.create<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        data: {
          title: "Mid",
          status: "draft",
          priority: 2,
          tags: [],
          nested: { score: 20, owner: "Ada" },
        },
      });

      const filtered = await service.list<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        filter: {
          and: [
            {
              field: { kind: "data", path: ["nested", "owner"] },
              op: "eq",
              value: "Ada",
            },
            {
              field: { kind: "metadata", name: "version" },
              op: "eq",
              value: 1,
            },
          ],
        },
        sort: [
          { field: { kind: "data", path: ["priority"] }, direction: "desc" },
        ],
        limit: 1,
      });

      expect(filtered.items.map((item) => item.data.title)).toEqual(["Mid"]);
      expect(filtered.hasMore).toBe(true);
      expect(filtered.limit).toBe(1);

      const bounded = await service.list<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        limit: 500,
      });
      expect(bounded.limit).toBe(100);

      const deleted = await service.softDelete({
        tenantId: tenantA,
        collection: "tasks",
        id: low.id,
        expectedVersion: low.version,
      });

      const withoutDeleted = await service.list<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
      });
      const withDeleted = await service.list<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        includeDeleted: true,
      });

      expect(withoutDeleted.items.some((item) => item.id === deleted.id)).toBe(
        false,
      );
      expect(withDeleted.items.some((item) => item.id === deleted.id)).toBe(
        true,
      );
    });

    it("rejects stale version updates", async () => {
      const service = createTestService();
      const created = await service.create<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        data: { title: "Draft", status: "draft", priority: 1, tags: [] },
      });

      await service.update<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        expectedVersion: created.version,
        data: {
          title: "Submitted",
          status: "submitted",
          priority: 2,
          tags: [],
        },
      });

      await expect(
        service.update<TaskDocument>({
          tenantId: tenantA,
          collection: "tasks",
          id: created.id,
          expectedVersion: created.version,
          data: { title: "Stale", status: "done", priority: 3, tags: [] },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT_STALE_VERSION" });
    });

    it("preserves JSON Patch RFC edge behavior", async () => {
      const service = createTestService();
      const created = await service.create<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        data: { title: "Draft", status: "draft", priority: 1, tags: ["a"] },
      });

      const added = await service.patch<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        expectedVersion: created.version,
        patch: [{ op: "add", path: "/tags/0", value: "first" }],
      });

      expect(added.data.tags).toEqual(["first", "a"]);

      await expect(
        service.patch<TaskDocument>({
          tenantId: tenantA,
          collection: "tasks",
          id: created.id,
          expectedVersion: added.version,
          patch: [{ op: "replace", path: "/missing", value: "nope" }],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

      await expect(
        service.patch<TaskDocument>({
          tenantId: tenantA,
          collection: "tasks",
          id: created.id,
          expectedVersion: added.version,
          patch: [{ op: "remove", path: "/missing" }],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

      await expect(
        service.patch<TaskDocument>({
          tenantId: tenantA,
          collection: "tasks",
          id: created.id,
          expectedVersion: added.version,
          patch: [{ op: "test", path: "/status", value: "done" }],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT_PATCH_TEST_FAILED" });

      await expect(
        service.patch<TaskDocument>({
          tenantId: tenantA,
          collection: "tasks",
          id: created.id,
          expectedVersion: added.version,
          patch: [{ op: "copy", path: "/title", value: "nope" }],
        }),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_OPERATION" });
    });

    it("exposes normalized document service errors", async () => {
      const service = createTestService();

      await expect(
        service.create({
          tenantId: tenantA,
          collection: "tasks",
          data: { title: "Draft", status: "invalid", priority: 1 },
        }),
      ).rejects.toBeInstanceOf(DocumentServiceError);
    });

    it("syncs remote projections by remote identity without calling remotes during normal reads", async () => {
      const { service, calls } = createRemoteService(
        repositoryCase.createRepository(),
      );

      const syncedResult = await service.syncRemoteOne<
        TaskDocument,
        { remoteId: string },
        RemoteAdapterOutputs["syncOne"]
      >({
        tenantId: tenantA,
        collection: "remoteTasks",
        input: { remoteId: "remote-1" },
      });
      const synced = syncedResult.document;

      expect(synced).toMatchObject({
        remoteSource: "fixture-api",
        remoteId: "remote-1",
        data: {
          title: "Remote draft",
          nested: { owner: "Ada", score: 10 },
        },
      });
      expect(syncedResult.output).toEqual({ requestId: "sync-one-1" });

      const syncedAgainResult = await service.remoteCreate<
        TaskDocument,
        RemoteTask,
        RemoteAdapterOutputs["create"]
      >({
        tenantId: tenantA,
        collection: "remoteTasks",
        input: {
          remote_id: "remote-1",
          name: "Remote submitted",
          phase: "submitted",
          priority: 2,
          labels: ["remote", "updated"],
          owner: { name: "Ada", score: 20 },
        },
      });
      const syncedAgain = syncedAgainResult.document;

      expect(syncedAgain.id).toBe(synced?.id);
      expect(syncedAgain.version).toBe(2);
      expect(syncedAgain.data).toMatchObject({
        title: "Remote submitted",
        status: "submitted",
        nested: { score: 20 },
      });
      expect(syncedAgainResult.output).toEqual({ requestId: "create-1" });

      const page = await service.syncRemoteList<
        TaskDocument,
        Record<string, never>,
        RemoteAdapterOutputs["syncList"]
      >({
        tenantId: tenantA,
        collection: "remoteTasks",
        input: {},
      });

      expect(page.documents).toHaveLength(1);
      expect(page.output).toEqual({ nextCursor: null });

      const callsBeforeRead = { ...calls };
      await expect(
        service.getById({
          tenantId: tenantA,
          collection: "remoteTasks",
          id: syncedAgain.id,
        }),
      ).resolves.toMatchObject({ id: syncedAgain.id });
      const listed = await service.list<TaskDocument>({
        tenantId: tenantA,
        collection: "remoteTasks",
      });

      expect(listed.items).toHaveLength(1);
      expect(calls).toEqual(callsBeforeRead);
    });

    it("keeps local projections unchanged when a remote create fails", async () => {
      const { service, setRemoteFailure } = createRemoteService(
        repositoryCase.createRepository(),
      );
      setRemoteFailure(new Error("remote unavailable"));

      await expect(
        service.remoteCreate<TaskDocument, RemoteTask>({
          tenantId: tenantA,
          collection: "remoteTasks",
          input: {
            remote_id: "remote-2",
            name: "Failed",
            phase: "draft",
            priority: 1,
            labels: [],
            owner: { name: "Grace", score: 1 },
          },
        }),
      ).rejects.toThrow("remote unavailable");

      const listed = await service.list<TaskDocument>({
        tenantId: tenantA,
        collection: "remoteTasks",
      });
      expect(listed.items).toHaveLength(0);
    });

    it("applies remote updates only after the remote mutation succeeds", async () => {
      const { service, calls, setRemoteFailure } = createRemoteService(
        repositoryCase.createRepository(),
      );
      const syncedResult = await service.syncRemoteOne<
        TaskDocument,
        { remoteId: string }
      >({
        tenantId: tenantA,
        collection: "remoteTasks",
        input: { remoteId: "remote-1" },
      });
      const synced = syncedResult.document;
      expect(synced).not.toBeNull();

      const updatedResult = await service.remoteUpdate<
        TaskDocument,
        Partial<RemoteTask>,
        RemoteAdapterOutputs["update"]
      >({
        tenantId: tenantA,
        collection: "remoteTasks",
        id: synced!.id,
        expectedVersion: synced!.version,
        input: {
          phase: "done",
          name: "Remote done",
          priority: 5,
          labels: ["closed"],
        },
      });
      const updated = updatedResult.document;

      expect(calls.updateRemote).toBe(1);
      expect(updated.data).toMatchObject({
        title: "Remote done",
        status: "done",
        priority: 5,
      });
      expect(updatedResult.output).toEqual({ requestId: "update-1" });

      setRemoteFailure(new Error("remote update failed"));
      await expect(
        service.remoteUpdate<TaskDocument, Partial<RemoteTask>>({
          tenantId: tenantA,
          collection: "remoteTasks",
          id: updated.id,
          expectedVersion: updated.version,
          input: { phase: "submitted", name: "Should not project" },
        }),
      ).rejects.toThrow("remote update failed");

      await expect(
        service.getById<TaskDocument>({
          tenantId: tenantA,
          collection: "remoteTasks",
          id: updated.id,
        }),
      ).resolves.toMatchObject({
        data: { status: "done", title: "Remote done" },
      });
    });
  },
);
