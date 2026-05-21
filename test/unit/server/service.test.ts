import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  DocumentServiceError,
  type DocumentService,
} from "#server/data/documents";
import {
  createRemoteService,
  createService,
  repositoryCases,
  tenantA,
  tenantB,
  type RemoteAdapterOutputs,
  type RemoteTask,
  type TaskDocument,
} from "./fixtures/service";

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

    it("supports batch create, get by ids, and update without partial stale writes", async () => {
      const service = createTestService();
      const created = await service.createMany<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        items: [
          {
            data: {
              title: "Batch A",
              status: "draft",
              priority: 1,
              tags: [],
            },
          },
          {
            data: {
              title: "Batch B",
              status: "submitted",
              priority: 2,
              tags: ["bulk"],
            },
          },
        ],
      });

      expect(created).toHaveLength(2);
      expect(created.map((item) => item.data.title)).toEqual([
        "Batch A",
        "Batch B",
      ]);

      const fetched = await service.getByIds<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        ids: [
          created[1]!.id,
          "00000000-0000-4000-8000-999999999999",
          created[0]!.id,
        ],
      });

      expect(fetched.map((item) => item?.id ?? null)).toEqual([
        created[1]!.id,
        null,
        created[0]!.id,
      ]);

      const updated = await service.updateMany<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        items: [
          {
            id: created[0]!.id,
            expectedVersion: created[0]!.version,
            data: {
              title: "Batch A done",
              status: "done",
              priority: 3,
              tags: ["bulk"],
            },
          },
          {
            id: created[1]!.id,
            expectedVersion: created[1]!.version,
            data: {
              title: "Batch B done",
              status: "done",
              priority: 4,
              tags: ["bulk"],
            },
          },
        ],
      });

      expect(updated.map((item) => item.version)).toEqual([2, 2]);
      expect(updated.map((item) => item.data.title)).toEqual([
        "Batch A done",
        "Batch B done",
      ]);

      await expect(
        service.updateMany<TaskDocument>({
          tenantId: tenantA,
          collection: "tasks",
          items: [
            {
              id: updated[0]!.id,
              expectedVersion: updated[0]!.version,
              data: {
                title: "Should not apply",
                status: "submitted",
                priority: 5,
                tags: [],
              },
            },
            {
              id: updated[1]!.id,
              expectedVersion: created[1]!.version,
              data: {
                title: "Stale",
                status: "submitted",
                priority: 6,
                tags: [],
              },
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT_STALE_VERSION" });

      await expect(
        service.getById<TaskDocument>({
          tenantId: tenantA,
          collection: "tasks",
          id: updated[0]!.id,
        }),
      ).resolves.toMatchObject({
        data: { title: "Batch A done" },
        version: 2,
      });
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
