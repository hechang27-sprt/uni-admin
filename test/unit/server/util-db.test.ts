import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sql } from "kysely";
import { z } from "zod";

import { migrateToLatest } from "#server/db/migrate";
import { CatalogService, KyselyCatalogRepository } from "#server/data/catalog";
import { CollectionRegistry } from "#server/data/collections";
import { createInMemoryDb } from "#server/utils/kysely";
import { pivotToColumns } from "#server/utils/pivot";

describe("server database utilities", () => {
  it("pivots rows and normalizes undefined values to null", () => {
    const columns = pivotToColumns([
      { id: "a", optional: undefined, value: 1 },
      { id: "b", optional: "present", value: undefined },
    ]);

    expect(columns).toEqual({
      id: ["a", "b"],
      optional: [null, "present"],
      value: [1, null],
    });
  });

  it("uses a schema shape to build missing optional columns", () => {
    const rowSchema = z.object({
      id: z.string(),
      optional: z.string().optional(),
      nullable: z.string().nullable().optional(),
      value: z.number().optional(),
    });

    const columns = pivotToColumns(
      [{ id: "a" }, { id: "b", optional: "present", value: undefined }],
      rowSchema,
      "set",
    );

    expect(columns).toEqual({
      id: ["a", "b"],
      setId: [true, true],
      optional: [null, "present"],
      setOptional: [false, true],
      nullable: [null, null],
      setNullable: [false, false],
      value: [null, null],
      setValue: [false, false],
    });
  });

  it("returns empty schema columns for empty input", () => {
    const rowSchema = z.object({
      id: z.string(),
      optional: z.string().optional(),
    });

    expect(pivotToColumns([], rowSchema)).toEqual({
      id: [],
      optional: [],
    });
  });
});

describe("baseline migration catalog tables", () => {
  let database: ReturnType<typeof createInMemoryDb> | null = null;

  beforeAll(() => {
    database = createInMemoryDb();
  });

  beforeEach(async () => {
    await migrateToLatest(getTestDatabase());
  });

  afterEach(async () => {
    const db = getTestDatabase();

    await sql`drop schema if exists public cascade`.execute(db);
    await sql`create schema public`.execute(db);
  });

  afterAll(async () => {
    await database?.destroy();
    database = null;
  });

  it("creates apps, tenant app enablement, and app-scoped collections", async () => {
    const db = getTestDatabase();

    const tenant = await db
      .insertInto("tenants")
      .values({ name: "Catalog Tenant" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const defaultApp = await db
      .insertInto("apps")
      .values({ key: "default", name: "Default", config: { builtin: true } })
      .returning("appId")
      .executeTakeFirstOrThrow();
    const crmApp = await db
      .insertInto("apps")
      .values({ key: "crm", name: "CRM" })
      .returning("appId")
      .executeTakeFirstOrThrow();

    await db
      .insertInto("tenantApps")
      .values({ tenantId: tenant.id, appId: defaultApp.appId })
      .execute();
    await db
      .insertInto("collections")
      .values([
        {
          appId: defaultApp.appId,
          key: "tasks",
          definitionKey: "tasks",
          name: "Tasks",
          schemaVersion: 1,
        },
        {
          appId: crmApp.appId,
          key: "tasks",
          definitionKey: "tasks",
          name: "CRM Tasks",
          schemaVersion: 1,
        },
      ])
      .execute();

    const collections = await db
      .selectFrom("collections")
      .select(["appId", "key"])
      .orderBy("appId")
      .execute();

    expect(collections).toHaveLength(2);
    expect(collections.map((collection) => collection.key)).toEqual([
      "tasks",
      "tasks",
    ]);
  });

  it("enforces catalog uniqueness boundaries", async () => {
    const db = getTestDatabase();
    const tenant = await db
      .insertInto("tenants")
      .values({ name: "Catalog Tenant" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const app = await db
      .insertInto("apps")
      .values({ key: "default" })
      .returning("appId")
      .executeTakeFirstOrThrow();

    await expect(
      db.insertInto("apps").values({ key: "default" }).execute(),
    ).rejects.toThrow("apps_key_unique");

    await db
      .insertInto("tenantApps")
      .values({ tenantId: tenant.id, appId: app.appId })
      .execute();
    await expect(
      db
        .insertInto("tenantApps")
        .values({ tenantId: tenant.id, appId: app.appId })
        .execute(),
    ).rejects.toThrow("tenant_apps_pk");

    await db
      .insertInto("collections")
      .values({
        appId: app.appId,
        key: "tasks",
        definitionKey: "tasks",
        schemaVersion: 1,
      })
      .execute();
    await expect(
      db
        .insertInto("collections")
        .values({
          appId: app.appId,
          key: "tasks",
          definitionKey: "other-tasks",
          schemaVersion: 1,
        })
        .execute(),
    ).rejects.toThrow("collections_app_key_unique");
  });

  it("syncs registry collections into app-scoped catalog rows", async () => {
    const db = getTestDatabase();
    const registry = CollectionRegistry.fromRegistrations([
      {
        name: "tasks",
        schema: z.object({ title: z.string() }),
        schemaVersion: 1,
      },
      {
        appKey: "crm",
        name: "tasks",
        definitionKey: "crm-tasks",
        schema: z.object({ company: z.string() }),
        schemaVersion: 2,
      },
    ]);
    const service = new CatalogService(
      new KyselyCatalogRepository(db),
      registry,
    );

    const firstSync = await service.syncRegistryCollections();
    const secondSync = await service.syncRegistryCollections();
    const defaultTasks = await service.findCollectionIdentity({
      appKey: "default",
      collectionKey: "tasks",
    });
    const crmTasks = await service.findCollectionIdentity({
      appKey: "crm",
      collectionKey: "tasks",
    });

    expect(
      firstSync.find((collection) => collection.appKey === "default")?.appId,
    ).toBe(defaultTasks?.appId);
    expect(firstSync).toHaveLength(2);
    expect(
      secondSync.map((collection) => collection.collectionId).toSorted(),
    ).toEqual(
      firstSync.map((collection) => collection.collectionId).toSorted(),
    );
    expect(defaultTasks).toMatchObject({
      appKey: "default",
      key: "tasks",
      definitionKey: "tasks",
      schemaVersion: 1,
    });
    expect(crmTasks).toMatchObject({
      appKey: "crm",
      key: "tasks",
      definitionKey: "crm-tasks",
      schemaVersion: 2,
    });
    expect(crmTasks?.collectionId).not.toEqual(defaultTasks?.collectionId);
    expect(
      await service.findCollectionIdentity({
        appKey: "default",
        collectionKey: "missing",
      }),
    ).toBeNull();
  });

  it("reuses warm collection lookups and refreshes only touched tenant identities on sync", async () => {
    const db = getTestDatabase();
    const registry = CollectionRegistry.fromRegistrations([
      {
        name: "tasks",
        schema: z.object({ title: z.string() }),
        schemaVersion: 1,
      },
      {
        appKey: "crm",
        name: "tasks",
        definitionKey: "crm-tasks",
        schema: z.object({ company: z.string() }),
        schemaVersion: 1,
      },
    ]);
    const repository = new KyselyCatalogRepository(db);
    const service = new CatalogService(repository, registry);

    await service.syncRegistryCollections();

    const findCollection = vi.spyOn(repository, "findCollection");
    const findTenantCollection = vi.spyOn(repository, "findTenantCollection");

    const warmDefault = await service.findCollectionIdentity({
      appKey: "default",
      collectionKey: "tasks",
    });
    const warmCrm = await service.findCollectionIdentity({
      appKey: "crm",
      collectionKey: "tasks",
    });

    const tenantId = "00000000-0000-4000-8000-000000000011";
    await db
      .insertInto("tenants")
      .values({ id: tenantId, name: "Cache Tenant" })
      .execute();
    await service.enableTenantApp({ tenantId });
    await service.enableTenantApp({ tenantId, appKey: "crm" });

    const warmTenantDefault = await service.findTenantCollectionIdentity({
      tenantId,
      appKey: "default",
      collectionKey: "tasks",
    });
    const warmTenantCrm = await service.findTenantCollectionIdentity({
      tenantId,
      appKey: "crm",
      collectionKey: "tasks",
    });

    const refreshedRegistry = CollectionRegistry.fromRegistrations([
      {
        name: "tasks",
        schema: z.object({ title: z.string(), body: z.string().optional() }),
        schemaVersion: 2,
      },
      {
        appKey: "crm",
        name: "tasks",
        definitionKey: "crm-tasks",
        schema: z.object({ company: z.string() }),
        schemaVersion: 1,
      },
    ]);
    const syncedCollections =
      await service.syncRegistryCollections(refreshedRegistry);
    expect(syncedCollections).toHaveLength(2);
    expect(syncedCollections[0]).toMatchObject({ schemaVersion: 2 });
    expect(syncedCollections[1]).toMatchObject({ schemaVersion: 1 });

    const defaultAfterSync = await service.findCollectionIdentity({
      appKey: "default",
      collectionKey: "tasks",
    });
    const crmAfterSync = await service.findCollectionIdentity({
      appKey: "crm",
      collectionKey: "tasks",
    });
    const tenantDefaultAfterSync = await service.findTenantCollectionIdentity({
      tenantId,
      appKey: "default",
      collectionKey: "tasks",
    });
    const tenantCrmAfterSync = await service.findTenantCollectionIdentity({
      tenantId,
      appKey: "crm",
      collectionKey: "tasks",
    });

    expect(warmDefault).toMatchObject({ key: "tasks", schemaVersion: 1 });
    expect(warmCrm).toMatchObject({ key: "tasks", schemaVersion: 1 });
    expect(warmTenantDefault).toMatchObject({ key: "tasks", schemaVersion: 1 });
    expect(warmTenantCrm).toMatchObject({ key: "tasks", schemaVersion: 1 });
    expect(defaultAfterSync).toMatchObject({ schemaVersion: 2 });
    expect(crmAfterSync).toMatchObject({ schemaVersion: 1 });
    expect(tenantDefaultAfterSync).toMatchObject({ schemaVersion: 2 });
    expect(tenantCrmAfterSync).toMatchObject({ schemaVersion: 1 });
    expect(findCollection).toHaveBeenCalledTimes(0);
    expect(findTenantCollection).toHaveBeenCalledTimes(4);
  });

  it("enables tenant apps idempotently", async () => {
    const db = getTestDatabase();
    const tenant = await db
      .insertInto("tenants")
      .values({ name: "Catalog Tenant" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const service = new CatalogService(
      new KyselyCatalogRepository(db),
      CollectionRegistry.fromRegistrations(),
    );

    const first = await service.enableTenantApp({ tenantId: tenant.id });
    const second = await service.enableTenantApp({ tenantId: tenant.id });
    const tenantApps = await db
      .selectFrom("tenantApps")
      .select(["tenantId", "appId"])
      .where("tenantId", "=", tenant.id)
      .execute();

    expect(second.appId).toBe(first.appId);
    expect(tenantApps).toEqual([{ tenantId: tenant.id, appId: first.appId }]);
  });

  it("rejects enabling unknown tenant apps", async () => {
    const db = getTestDatabase();
    const tenant = await db
      .insertInto("tenants")
      .values({ name: "Catalog Tenant" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const service = new CatalogService(
      new KyselyCatalogRepository(db),
      CollectionRegistry.fromRegistrations(),
    );

    await expect(
      service.enableTenantApp({ tenantId: tenant.id, appKey: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("creates named catalog indexes and constraints", async () => {
    const db = getTestDatabase();

    const indexes = await sql<{ indexdef: string; indexname: string }>`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'apps_key_unique',
          'collections_app_key_unique',
          'collections_app_collection_unique',
          'documents_remote_identity_unique'
        )
      order by indexname
    `.execute(db);
    const constraints = await sql<{ conname: string }>`
      select conname
      from pg_constraint
      where conname = 'tenant_apps_pk'
    `.execute(db);

    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "apps_key_unique",
      "collections_app_collection_unique",
      "collections_app_key_unique",
      "documents_remote_identity_unique",
    ]);
    const remoteIdentityIndex = indexes.rows.find(
      (row) => row.indexname === "documents_remote_identity_unique",
    );
    expect(remoteIdentityIndex?.indexdef).toContain(
      "(tenant_id, app_id, collection_id, remote_id, remote_source)",
    );
    expect(remoteIdentityIndex?.indexdef).toContain(
      "WHERE ((remote_source IS NOT NULL) AND (remote_id IS NOT NULL))",
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      "tenant_apps_pk",
    ]);
  });

  function getTestDatabase(): ReturnType<typeof createInMemoryDb> {
    if (!database) {
      throw new Error("Test database has not been initialized");
    }

    return database;
  }
});
