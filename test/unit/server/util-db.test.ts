import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { z } from "zod";

import { migrateToLatest } from "#server/db/migrate";
import { CatalogService, KyselyCatalogRepository } from "#server/data/catalog";
import { createCollectionRegistry } from "#server/data/collections";
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
    const registry = createCollectionRegistry([
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

    const defaultApp = await service.ensureDefaultApp();
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

    expect(defaultApp).toMatchObject({ key: "default", name: "Default" });
    expect(firstSync).toHaveLength(2);
    expect(secondSync.map((collection) => collection.collectionId).toSorted()).toEqual(
      firstSync.map((collection) => collection.collectionId).toSorted(),
    );
    expect(defaultTasks).toMatchObject({
      appKey: "default",
      appId: defaultApp.appId,
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

  it("enables tenant apps idempotently", async () => {
    const db = getTestDatabase();
    const tenant = await db
      .insertInto("tenants")
      .values({ name: "Catalog Tenant" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const service = new CatalogService(
      new KyselyCatalogRepository(db),
      createCollectionRegistry(),
    );

    const first = await service.enableDefaultAppForTenant(tenant.id);
    const second = await service.enableDefaultAppForTenant(tenant.id);
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
      createCollectionRegistry(),
    );

    await expect(
      service.enableTenantApp({ tenantId: tenant.id, appKey: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("creates named catalog indexes and constraints", async () => {
    const db = getTestDatabase();

    const indexes = await sql<{ indexname: string }>`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'apps_key_unique',
          'collections_app_key_unique',
          'collections_app_collection_unique'
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
    ]);
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
