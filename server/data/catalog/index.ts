/* oxlint-disable typescript/unbound-method -- Kysely callback methods are used only to build SQL AST nodes. */
import { inject, injectable } from "inversify";
import type { Selectable } from "kysely";

import type { AppsTable, CollectionsTable } from "#server/db/schema";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import {
  DEFAULT_APP_KEY,
  type CollectionRegistry,
  type JsonObject,
} from "#server/data/documents";

export interface CatalogApp {
  appId: string;
  key: string;
  name: string | null;
  config: JsonObject | null;
}

export interface CatalogCollection {
  collectionId: string;
  appId: string;
  appKey: string;
  key: string;
  definitionKey: string;
  name: string | null;
  schemaVersion: number;
  config: JsonObject | null;
}

export interface EnsureCatalogAppInput {
  key: string;
  name?: string | null;
  config?: JsonObject | null;
}

export interface EnableTenantAppInput {
  tenantId: string;
  appKey: string;
  config?: JsonObject | null;
}

export interface FindCatalogCollectionInput {
  appKey: string;
  collectionKey: string;
}

export interface FindTenantCatalogCollectionInput
  extends FindCatalogCollectionInput {
  tenantId: string;
}

export interface CatalogRepository {
  ensureApp(input: EnsureCatalogAppInput): Promise<CatalogApp>;
  enableTenantApp(input: EnableTenantAppInput): Promise<CatalogApp>;
  syncCollections(registry: CollectionRegistry): Promise<CatalogCollection[]>;
  findCollection(
    input: FindCatalogCollectionInput,
  ): Promise<CatalogCollection | null>;
  findTenantCollection(
    input: FindTenantCatalogCollectionInput,
  ): Promise<CatalogCollection | null>;
}

@injectable()
export class KyselyCatalogRepository implements CatalogRepository {
  constructor(
    @inject(SERVER_DI_TYPES.DatabaseClient)
    private readonly database: DatabaseClient,
  ) {}

  async ensureApp(input: EnsureCatalogAppInput): Promise<CatalogApp> {
    const now = new Date();
    const row = await this.database
      .insertInto("apps")
      .values({
        key: input.key,
        name: input.name ?? null,
        config: input.config ?? null,
        updatedAt: now,
      })
      .onConflict((conflict) =>
        conflict.column("key").doUpdateSet({
          name: input.name ?? null,
          config: input.config ?? null,
          updatedAt: now,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return mapApp(row);
  }

  async enableTenantApp(input: EnableTenantAppInput): Promise<CatalogApp> {
    const app = await this.ensureApp({ key: input.appKey });

    await this.database
      .insertInto("tenantApps")
      .values({
        tenantId: input.tenantId,
        appId: app.appId,
        config: input.config ?? null,
      })
      .onConflict((conflict) =>
        conflict.columns(["tenantId", "appId"]).doUpdateSet({
          config: input.config ?? null,
        }),
      )
      .execute();

    return app;
  }

  async syncCollections(
    registry: CollectionRegistry,
  ): Promise<CatalogCollection[]> {
    return Promise.all(
      registry.list().map(async (registration) => {
        const app = await this.ensureApp({ key: registration.appKey });
        const now = new Date();
        const row = await this.database
          .insertInto("collections")
          .values({
            appId: app.appId,
            key: registration.name,
            definitionKey: registration.definitionKey,
            name: registration.name,
            schemaVersion: registration.schemaVersion,
            config: null,
            updatedAt: now,
          })
          .onConflict((conflict) =>
            conflict.columns(["appId", "key"]).doUpdateSet({
              definitionKey: registration.definitionKey,
              name: registration.name,
              schemaVersion: registration.schemaVersion,
              updatedAt: now,
            }),
          )
          .returningAll()
          .executeTakeFirstOrThrow();

        return mapCollection(row, app.key);
      }),
    );
  }

  async findCollection(
    input: FindCatalogCollectionInput,
  ): Promise<CatalogCollection | null> {
    const row = await this.database
      .selectFrom("collections")
      .innerJoin("apps", "apps.appId", "collections.appId")
      .select([
        "collections.collectionId",
        "collections.appId",
        "apps.key as appKey",
        "collections.key",
        "collections.definitionKey",
        "collections.name",
        "collections.schemaVersion",
        "collections.config",
      ])
      .where("apps.key", "=", input.appKey)
      .where("collections.key", "=", input.collectionKey)
      .executeTakeFirst();

    return row ?? null;
  }

  async findTenantCollection(
    input: FindTenantCatalogCollectionInput,
  ): Promise<CatalogCollection | null> {
    const row = await this.database
      .selectFrom("collections")
      .innerJoin("apps", "apps.appId", "collections.appId")
      .innerJoin("tenantApps", "tenantApps.appId", "apps.appId")
      .select([
        "collections.collectionId",
        "collections.appId",
        "apps.key as appKey",
        "collections.key",
        "collections.definitionKey",
        "collections.name",
        "collections.schemaVersion",
        "collections.config",
      ])
      .where("tenantApps.tenantId", "=", input.tenantId)
      .where("apps.key", "=", input.appKey)
      .where("collections.key", "=", input.collectionKey)
      .executeTakeFirst();

    return row ?? null;
  }
}

@injectable()
export class CatalogService {
  constructor(
    @inject(SERVER_DI_TYPES.CatalogRepository)
    private readonly repository: CatalogRepository,
    @inject(SERVER_DI_TYPES.CollectionRegistry)
    private readonly registry: CollectionRegistry,
  ) {}

  ensureDefaultApp(): Promise<CatalogApp> {
    return this.repository.ensureApp({
      key: DEFAULT_APP_KEY,
      name: "Default",
      config: { builtin: true },
    });
  }

  syncRegistryCollections(): Promise<CatalogCollection[]> {
    return this.repository.syncCollections(this.registry);
  }

  enableDefaultAppForTenant(tenantId: string): Promise<CatalogApp> {
    return this.repository.enableTenantApp({
      tenantId,
      appKey: DEFAULT_APP_KEY,
    });
  }

  enableTenantApp(input: EnableTenantAppInput): Promise<CatalogApp> {
    return this.repository.enableTenantApp(input);
  }

  findCollectionIdentity(
    input: FindCatalogCollectionInput,
  ): Promise<CatalogCollection | null> {
    return this.repository.findCollection(input);
  }

  findTenantCollectionIdentity(
    input: FindTenantCatalogCollectionInput,
  ): Promise<CatalogCollection | null> {
    return this.repository.findTenantCollection(input);
  }
}

function mapApp(row: Selectable<AppsTable>): CatalogApp {
  return {
    appId: row.appId,
    key: row.key,
    name: row.name,
    config: row.config,
  };
}

function mapCollection(
  row: Selectable<CollectionsTable>,
  appKey: string,
): CatalogCollection {
  return {
    collectionId: row.collectionId,
    appId: row.appId,
    appKey,
    key: row.key,
    definitionKey: row.definitionKey,
    name: row.name,
    schemaVersion: row.schemaVersion,
    config: row.config,
  };
}
