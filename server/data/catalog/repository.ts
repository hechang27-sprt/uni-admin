/* oxlint-disable typescript/unbound-method -- Kysely callback methods are used only to build SQL AST nodes. */
import { inject, injectable } from "inversify";
import type { Selectable } from "kysely";

import { jsonObjectSchema } from "#server/utils/zod";
import type { AppsTable, CollectionsTable } from "#server/db/schema";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import {
  collectionRegistrationBaseSchema,
  type CollectionRegistry,
} from "#server/data/collections";
import { keyBy, uniqBy } from "es-toolkit";
import z from "zod";

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

const ensureCatalogAppInputSchema = z.object({
  key: z.string(),
  name: z.string().optional(),
  config: jsonObjectSchema.optional(),
});

const enableTenantAppInputSchema = z.object({
  tenantId: z.string(),
  appKey: z.string(),
  config: jsonObjectSchema.optional(),
});

export type EnsureCatalogAppInput = z.infer<typeof ensureCatalogAppInputSchema>;

export type EnableTenantAppInput = z.infer<typeof enableTenantAppInputSchema>;

export interface FindCatalogCollectionInput {
  appKey: string;
  collectionKey: string;
}

export interface FindTenantCatalogCollectionInput extends FindCatalogCollectionInput {
  tenantId: string;
}

export interface CatalogRepository {
  ensureApps(
    input: EnsureCatalogAppInput[],
  ): Promise<Record<string, CatalogApp>>;
  findApp(key: string): Promise<CatalogApp | null>;
  enableTenantApps(input: EnableTenantAppInput[]): Promise<void>;
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

  async ensureApps(
    input: EnsureCatalogAppInput[],
  ): Promise<Record<string, CatalogApp>> {
    input = uniqBy(input, ({ key }) => key);

    const { key, name, setName, config, setConfig } = pivotToColumns(
      input,
      ensureCatalogAppInputSchema,
      "set",
    );

    const now = new Date();

    const rows = await this.database
      .mergeInto("apps")
      .using(
        unnest(
          "input",
          { key, name, setName, config, setConfig },
          { jsonb: ["config"] },
        ),
        "input.key",
        "apps.key",
      )
      .whenMatchedAnd((eb) =>
        eb.or([
          eb("input.setName", "=", true),
          eb("input.setConfig", "=", true),
        ]),
      )
      .thenUpdate((ub) =>
        ub
          .set("name", (eb) =>
            eb
              .case()
              .when("input.setName", "=", true)
              .thenRef("input.name")
              .elseRef("apps.name")
              .end(),
          )
          .set("config", (eb) =>
            eb
              .case()
              .when("input.setConfig", "=", true)
              .thenRef("input.config")
              .elseRef("apps.config")
              .end(),
          )
          .set("updatedAt", now),
      )
      // required for `RETURNING`
      .whenMatched()
      .thenUpdateSet("updatedAt", ({ ref }) => ref("apps.updatedAt"))
      .whenNotMatched()
      .thenInsertValues(({ ref }) => ({
        key: ref("input.key"),
        name: ref("input.name"),
        config: ref("input.config"),
      }))
      .returningAll("apps")
      .execute();

    return keyBy(
      rows.map((row) => mapApp(row)),
      (app) => app.key,
    );
  }

  async findApp(key: string): Promise<CatalogApp | null> {
    const row = await this.database
      .selectFrom("apps")
      .selectAll()
      .where("key", "=", key)
      .executeTakeFirst();

    return row ? mapApp(row) : null;
  }

  async enableTenantApps(input: EnableTenantAppInput[]): Promise<void> {
    const { tenantId, appKey, config, setConfig } = pivotToColumns(
      input,
      enableTenantAppInputSchema,
      "set",
    );

    await this.database
      .mergeInto("tenantApps")
      .using(
        ({ selectFrom }) =>
          selectFrom(
            unnest(
              "t",
              { tenantId, appKey, config, setConfig },
              { types: { tenantId: "uuid" }, jsonb: ["config"] },
            ),
          )
            .innerJoin("apps", "apps.key", "t.appKey")
            .innerJoin("tenants", "tenants.id", "t.tenantId")
            .selectAll("t")
            .select("apps.appId")
            .as("input"),
        (join) =>
          join
            .onRef("input.appId", "=", "tenantApps.appId")
            .onRef("input.tenantId", "=", "tenantApps.tenantId")
            .on("input.appId", "is not", null),
      )
      .whenMatchedAnd("input.setConfig", "=", true)
      .thenUpdateSet("config", (eb) =>
        eb
          .case()
          .when("input.setConfig", "=", true)
          .thenRef("input.config")
          .elseRef("tenantApps.config")
          .end(),
      )
      .whenNotMatched()
      .thenInsertValues(({ ref }) => ({
        tenantId: ref("input.tenantId"),
        appId: ref("input.appId").$notNull(),
        config: ref("input.config"),
      }))
      .execute();
  }

  async syncCollections(
    registry: CollectionRegistry,
  ): Promise<CatalogCollection[]> {
    const registeredCollectionBaseSchema =
      collectionRegistrationBaseSchema.required();

    const collections = registry
      .list()
      .map((obj) => registeredCollectionBaseSchema.parse(obj));
    const {
      key: collectionKey,
      appKey,
      definitionKey,
      setDefinitionKey,
      name,
      setName,
      schemaVersion,
      setSchemaVersion,
    } = pivotToColumns(collections, registeredCollectionBaseSchema, "set");

    const apps = await this.ensureApps(
      new Set(appKey)
        .values()
        .map((ak) => ({ key: ak }))
        .toArray(),
    );
    const appId = appKey.map((ak) => apps[ak]?.appId ?? null);

    const now = new Date();
    const rows = await this.database
      .mergeInto("collections")
      .using(
        unnest(
          "reg",
          {
            appId,
            appKey,
            key: collectionKey,
            definitionKey,
            setDefinitionKey,
            name,
            setName,
            schemaVersion,
            setSchemaVersion,
          },
          { types: { appId: "uuid", appKey: "text" } },
        ),
        (join) =>
          join
            .onRef("reg.appId", "=", "collections.appId")
            .onRef("reg.key", "=", "collections.key")
            .on("reg.appId", "is not", null),
      )
      .whenMatchedAnd((eb) =>
        eb.or([
          eb("reg.setDefinitionKey", "=", true),
          eb("reg.setName", "=", true),
          eb("reg.setSchemaVersion", "=", true),
        ]),
      )
      .thenUpdate((ub) =>
        ub
          .set("definitionKey", (eb) =>
            eb
              .case()
              .when("reg.setDefinitionKey", "=", true)
              .thenRef("reg.definitionKey")
              .elseRef("collections.definitionKey")
              .end(),
          )
          .set("name", (eb) =>
            eb
              .case()
              .when("reg.setName", "=", true)
              .thenRef("reg.name")
              .elseRef("collections.name")
              .end(),
          )
          .set("schemaVersion", (eb) =>
            eb
              .case()
              .when("reg.setSchemaVersion", "=", true)
              .thenRef("reg.schemaVersion")
              .elseRef("collections.schemaVersion")
              .end(),
          )
          .set("updatedAt", now),
      )
      .whenMatched()
      .thenUpdateSet("updatedAt", ({ ref }) =>
        ref("collections.updatedAt"),
      )
      .whenNotMatched()
      .thenInsertValues(({ ref }) => ({
        appId: ref("reg.appId").$notNull(),
        key: ref("reg.key"),
        definitionKey: ref("reg.definitionKey"),
        name: ref("reg.name"),
        schemaVersion: ref("reg.schemaVersion"),
      }))
      .returningAll("collections")
      .returning("reg.appKey")
      .execute();

    return rows.map((row) => mapCollection(row, row.appKey));
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
