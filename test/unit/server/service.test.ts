import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { sql } from "kysely";
import { z } from "zod";

import { migrateToLatest } from "#server/db/migrate";
import { createCollectionRegistry } from "#server/data/collections";
import {
  DocumentServiceError,
  type DocumentService,
} from "#server/data/documents";
import type { CatalogService } from "#server/data/catalog";
import { createServerContainer, SERVER_DI_TYPES } from "#server/di";
import {
  createRemoteService,
  createService,
  tenantA,
  tenantB,
  type RemoteAdapterOutputs,
  type RemoteTask,
  type TaskDocument,
} from "./fixtures/service";

describe.each([{ name: "pgLite Kysely repository" }])(
  "local document service ($name)",
  () => {
    let database: ReturnType<typeof createInMemoryDb> | null = null;

    beforeAll(() => {
      database = createInMemoryDb();
    });

    beforeEach(async () => {
      await prepareTestDatabase();
    });

    afterEach(async () => {
      await dropTestDatabaseTables();
    });

    afterAll(async () => {
      await database?.destroy();
      database = null;
    });

    async function prepareTestDatabase(): Promise<void> {
      const db = getTestDatabase();

      await migrateToLatest(db);
      await db
        .insertInto("tenants")
        .values([
          { id: tenantA, name: "Test Tenant A" },
          { id: tenantB, name: "Test Tenant B" },
        ])
        .execute();
    }

    async function dropTestDatabaseTables(): Promise<void> {
      const db = getTestDatabase();

      await sql`drop schema if exists public cascade`.execute(db);
      await sql`create schema public`.execute(db);
    }

    function getTestDatabase(): ReturnType<typeof createInMemoryDb> {
      if (!database) {
        throw new Error("Test database has not been initialized");
      }

      return database;
    }

    async function createTestService(): Promise<DocumentService> {
      return createService(getTestDatabase());
    }

    async function createTwoAppTaskService(): Promise<DocumentService> {
      const registry = createCollectionRegistry([
        {
          appKey: "default",
          name: "tasks",
          schema: z.object({ title: z.string() }),
          schemaVersion: 1,
        },
        {
          appKey: "workflow",
          name: "tasks",
          schema: z.object({ title: z.string() }),
          schemaVersion: 1,
        },
      ]);
      const container = createServerContainer({
        database: getTestDatabase(),
        registry,
      });
      const catalog = container.get<CatalogService>(SERVER_DI_TYPES.CatalogService);
      await catalog.enableDefaultAppForTenant(tenantA);
      await catalog.enableDefaultAppForTenant(tenantB);
      await catalog.syncRegistryCollections();
      await catalog.enableTenantApp({ tenantId: tenantA, appKey: "workflow" });
      await catalog.enableTenantApp({ tenantId: tenantB, appKey: "workflow" });
      return container.get<DocumentService>(SERVER_DI_TYPES.DocumentService);
    }

    it("rejects unknown collections and invalid data before persistence", async () => {
      const service = await createTestService();

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

    it("preserves snake_case keys in document JSON through row casing conversion", async () => {
      const service = await createTestService();
      const created = await service.create<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        data: {
          title: "External key",
          status: "draft",
          priority: 1,
          tags: [],
          external_ref: "source-record",
        },
      });

    const listed = await service.list<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      ids: [created.id],
    });

    expect(listed.items[0]).toMatchObject({
      data: { external_ref: "source-record" },
    });
    });

  it("covers create, list, update, patch, softDelete, restore, and hardDelete", async () => {
      const service = await createTestService();
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
    const afterSoftDelete = await service.list({
      tenantId: tenantA,
      collection: "tasks",
      ids: [created.id],
    });

    expect(afterSoftDelete.items).toHaveLength(0);

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

    const afterHardDelete = await service.list({
      tenantId: tenantA,
      collection: "tasks",
      ids: [created.id],
      includeDeleted: true,
    });

    expect(afterHardDelete.items).toHaveLength(0);
    });

  it("supports batch create, list by ids, and update without partial stale writes", async () => {
      const service = await createTestService();
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

    const fetchedResult = await service.list<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      ids: [
        created[1]!.id,
        "00000000-0000-4000-8000-999999999999",
        created[0]!.id,
      ],
    });
    const fetched = new Map(fetchedResult.items.map((item) => [item.id, item]));
    expect([...fetched.keys()].toSorted()).toEqual(
      [created[0]!.id, created[1]!.id].toSorted(),
    );

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

    const fetchedUpdated = await service.list<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      ids: [updated[0]!.id],
    });
    expect(fetchedUpdated.items[0]).toMatchObject({
      data: { title: "Batch A done" },
      version: 2,
    });
  });
    it("enforces tenant isolation on reads and mutations", async () => {
      const service = await createTestService();
      const created = await service.create<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        data: { title: "Private", status: "draft", priority: 1, tags: [] },
      });

    const crossTenantRead = await service.list({
      tenantId: tenantB,
      collection: "tasks",
      ids: [created.id],
    });

    expect(crossTenantRead.items).toHaveLength(0);

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

    it("uses registration key as collection identity and name as description", async () => {
    const registry = createCollectionRegistry([
      {
        key: "tasks",
        name: "Task records",
        schema: z.object({ title: z.string() }),
        schemaVersion: 1,
      },
      {
        name: "legacy-tasks",
        schema: z.object({ title: z.string() }),
        schemaVersion: 1,
      },
    ]);
    const container = createServerContainer({
      database: getTestDatabase(),
      registry,
    });
    const service = container.get<DocumentService>(SERVER_DI_TYPES.DocumentService);
    const catalog = container.get<CatalogService>(SERVER_DI_TYPES.CatalogService);
    await catalog.syncRegistryCollections();
    await catalog.enableDefaultAppForTenant(tenantA);

    expect(registry.has("tasks")).toBe(true);
    expect(registry.has("Task records")).toBe(false);
    expect(registry.get("tasks")).toMatchObject({
      key: "tasks",
      name: "Task records",
      definitionKey: "tasks",
    });
    expect(registry.get("legacy-tasks")).toMatchObject({
      key: "legacy-tasks",
      name: "legacy-tasks",
      definitionKey: "legacy-tasks",
    });

    const created = await service.create({
      tenantId: tenantA,
      collection: "tasks",
      data: { title: "Keyed" },
    });

    expect(created).toMatchObject({
      tenantId: tenantA,
      schemaVersion: 1,
      data: { title: "Keyed" },
    });

    const catalogRow = await getTestDatabase()
      .selectFrom("collections")
      .innerJoin("apps", "apps.appId", "collections.appId")
      .select(["collections.key", "collections.name", "collections.definitionKey"])
      .where("apps.key", "=", "default")
      .where("collections.key", "=", "tasks")
      .executeTakeFirstOrThrow();

    expect(catalogRow).toEqual({
      key: "tasks",
      name: "Task records",
      definitionKey: "tasks",
    });
  });

  it("scopes documents by structured tenant, app, and collection identity", async () => {
      const service = await createTwoAppTaskService();

      const tenantADefault = await service.create({
        tenantId: tenantA,
        collection: "tasks",
        data: { title: "Tenant A default" },
      });
      const tenantBDefault = await service.create({
        tenantId: tenantB,
        collection: "tasks",
        data: { title: "Tenant B default" },
      });
      const tenantAWorkflow = await service.create({
        tenantId: tenantA,
        appKey: "workflow",
        collection: "tasks",
        data: { title: "Tenant A workflow" },
      });

    const tenantBCrossRead = await service.list({
      tenantId: tenantB,
      collection: "tasks",
      ids: [tenantADefault.id],
    });
    expect(tenantBCrossRead.items).toHaveLength(0);

    const crossAppRead = await service.list({
      tenantId: tenantA,
      appKey: "workflow",
      collection: "tasks",
      ids: [tenantADefault.id],
    });
    expect(crossAppRead.items).toHaveLength(0);

      const tenantAWorkflowList = await service.list({
        tenantId: tenantA,
        appKey: "workflow",
        collection: "tasks",
      });
      expect(tenantAWorkflowList.items.map((item) => item.id)).toEqual([
        tenantAWorkflow.id,
      ]);
      const tenantADefaultList = await service.list({
        tenantId: tenantA,
        collection: "tasks",
      });
      const tenantBDefaultList = await service.list({
        tenantId: tenantB,
        collection: "tasks",
      });
      expect(tenantADefaultList.items.map((item) => item.id)).toEqual([
        tenantADefault.id,
      ]);
      expect(tenantBDefaultList.items.map((item) => item.id)).toEqual([
        tenantBDefault.id,
      ]);
    });

    it("requires tenant app enablement for non-default app writes", async () => {
      const registry = createCollectionRegistry([
        {
          appKey: "workflow",
          name: "tasks",
          schema: z.object({ title: z.string() }),
          schemaVersion: 1,
        },
      ]);
      const container = createServerContainer({
        database: getTestDatabase(),
        registry,
      });
      const service = container.get<DocumentService>(SERVER_DI_TYPES.DocumentService);

      await expect(
        service.create({
          tenantId: tenantA,
          appKey: "workflow",
          collection: "tasks",
          data: { title: "Blocked" },
        }),
      ).rejects.toMatchObject({ code: "UNKNOWN_COLLECTION" });
    });

    it("scopes remote upsert uniqueness by app and collection identity", async () => {
      const registry = createCollectionRegistry([
        {
          appKey: "default",
          name: "tasks",
          schema: z.object({ title: z.string() }),
          schemaVersion: 1,
        },
        {
          appKey: "workflow",
          name: "tasks",
          schema: z.object({ title: z.string() }),
          schemaVersion: 1,
        },
      ]);
      const container = createServerContainer({
        database: getTestDatabase(),
        registry,
      });
      const catalog = container.get<CatalogService>(SERVER_DI_TYPES.CatalogService);
      await catalog.syncRegistryCollections();
      await catalog.enableDefaultAppForTenant(tenantA);
      await catalog.enableTenantApp({ tenantId: tenantA, appKey: "workflow" });
      const repository = getTestDatabase();
      const identities = await Promise.all([
        catalog.findTenantCollectionIdentity({
          tenantId: tenantA,
          appKey: "default",
          collectionKey: "tasks",
        }),
        catalog.findTenantCollectionIdentity({
          tenantId: tenantA,
          appKey: "workflow",
          collectionKey: "tasks",
        }),
      ]);

      await repository
        .insertInto("documents")
        .values(
          identities.map((identity, index) => ({
            tenantId: tenantA,
            appId: identity!.appId,
            collectionId: identity!.collectionId,
            schemaVersion: 1,
            data: { title: `Remote ${index}` },
            remoteSource: "linear",
            remoteId: "remote-1",
          })),
        )
        .execute();

      const rows = await repository
        .selectFrom("documents")
        .select(["appId", "collectionId", "remoteId"])
        .where("tenantId", "=", tenantA)
        .where("remoteSource", "=", "linear")
        .where("remoteId", "=", "remote-1")
        .execute();
      expect(rows).toHaveLength(2);
    });

    it("supports JSONB-path filters, metadata filters, sorting, pagination bounds, and deleted inclusion", async () => {
      const service = await createTestService();

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
      const service = await createTestService();
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
      const service = await createTestService();
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
      const service = await createTestService();

      await expect(
        service.create({
          tenantId: tenantA,
          collection: "tasks",
          data: { title: "Draft", status: "invalid", priority: 1 },
        }),
      ).rejects.toBeInstanceOf(DocumentServiceError);
    });

    it("syncs remote projections by remote identity without calling remotes during normal reads", async () => {
      const { service, calls } = await createRemoteService(getTestDatabase());

      const syncedResult = await service.syncRemoteOne<
        TaskDocument,
        { remoteId: string },
        RemoteAdapterOutputs["syncOne"]
      >({
        tenantId: tenantA,
        collection: "remote-tasks",
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
        collection: "remote-tasks",
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
        collection: "remote-tasks",
        input: {},
      });

      expect(page.documents).toHaveLength(1);
      expect(page.output).toEqual({ nextCursor: null });

      const callsBeforeRead = { ...calls };
      const normalRead = await service.list({
        tenantId: tenantA,
        collection: "remote-tasks",
        ids: [syncedAgain.id],
      });

      expect(normalRead.items[0]).toMatchObject({ id: syncedAgain.id });
      expect(normalRead.items).toHaveLength(1);
      expect(calls).toEqual(callsBeforeRead);
    });

    it("keeps local projections unchanged when a remote create fails", async () => {
      const { service, setRemoteFailure } =
        await createRemoteService(getTestDatabase());
      setRemoteFailure(new Error("remote unavailable"));

      await expect(
        service.remoteCreate<TaskDocument, RemoteTask>({
          tenantId: tenantA,
          collection: "remote-tasks",
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
        collection: "remote-tasks",
      });
      expect(listed.items).toHaveLength(0);
    });

    it("applies remote updates only after the remote mutation succeeds", async () => {
      const { service, calls, setRemoteFailure } =
        await createRemoteService(getTestDatabase());
      const syncedResult = await service.syncRemoteOne<
        TaskDocument,
        { remoteId: string }
      >({
        tenantId: tenantA,
        collection: "remote-tasks",
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
        collection: "remote-tasks",
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
          collection: "remote-tasks",
          id: updated.id,
          expectedVersion: updated.version,
          input: { phase: "submitted", name: "Should not project" },
        }),
      ).rejects.toThrow("remote update failed");

      const afterFailedRemoteUpdate = await service.list<TaskDocument>({
        tenantId: tenantA,
        collection: "remote-tasks",
        ids: [updated.id],
      });
      expect(afterFailedRemoteUpdate.items[0]).toMatchObject({
        data: { status: "done", title: "Remote done" },
      });
    });
  },
);
