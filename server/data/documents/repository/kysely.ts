/* oxlint-disable typescript/unbound-method -- Kysely expression-builder callback methods are used only to build SQL AST nodes. */
import {
  sql,
  type RawBuilder,
  type Selectable,
  type Transaction,
} from "kysely";

import type { Database, DocumentsTable } from "#server/db/schema";
import type { DatabaseClient } from "#server/util/kysely";
import { DocumentServiceError } from "../errors";
import type {
  JsonObject,
  NormalizedListDocumentsInput,
  StoredDocument,
} from "../types";
import {
  buildFieldExpression,
  buildFilterCondition,
  normalizeSort,
} from "./query";
import type {
  DocumentRepository,
  InsertManyDocumentsRecord,
  UpdateManyDocumentsRecord,
  UpsertRemoteProjectionsRecord,
} from "./types";
import {
  insertManyDocumentsItemSchema,
  updateDocumentRecordSchema,
  upsertRemoteProjectionSchema,
} from "./types";
import { pivotToColumns } from "#server/util/db";

type DocumentRow = Selectable<DocumentsTable>;
type NullableDocumentRow = {
  [K in keyof DocumentRow]: DocumentRow[K] | null;
};
type DocumentDatabase = DatabaseClient | Transaction<Database>;

class BatchUpdateConflict extends Error {}

export class KyselyDocumentRepository implements DocumentRepository {
  constructor(private readonly database: DatabaseClient) {}

  async insertMany<TData extends JsonObject>(
    input: InsertManyDocumentsRecord<TData>,
  ): Promise<StoredDocument<TData>[]> {
    if (input.items.length === 0) {
      return [];
    }

    const { data, authScopeId, remoteId, remoteSource } = pivotToColumns(
      input.items,
      insertManyDocumentsItemSchema,
    );

    await assertAuthScopesBelongToTenant(
      this.database,
      input.tenantId,
      authScopeId ?? [],
    );

    type InsertInput = {
      data: TData;
      authScopeId: string | null;
      remoteSource: string | null;
      remoteId: string | null;
    };

    const rows = await this.database
      .insertInto("documents")
      .columns([
        "tenantId",
        "collection",
        "schemaVersion",
        "data",
        "authScopeId",
        "remoteId",
        "remoteSource",
      ])
      .expression(({ selectFrom, val }) =>
        selectFrom(
          sql<InsertInput>`unnest(${data}::jsonb[], ${authScopeId}::uuid[], ${remoteId}::text[], ${remoteSource}::text[])`.as<"input">(
            sql`input(data, auth_scope_id, remote_id, remote_source)`,
          ),
        ).select([
          val(input.tenantId).as("tenantId"),
          val(input.collection).as("collection"),
          val(input.schemaVersion).as("schemaVersion"),
          "input.data",
          "input.authScopeId",
          "input.remoteId",
          "input.remoteSource",
        ]),
      )
      .returningAll()
      .execute();

    return rows.map((row) => mapDocumentRow<TData>(row));
  }

  async findByIds<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    ids: string[];
    includeDeleted?: boolean;
  }): Promise<(StoredDocument<TData> | null)[]> {
    if (input.ids.length === 0) {
      return [];
    }

    let query = this.database
      .selectFrom(({ selectFrom }) =>
        selectFrom(
          sql<{
            id: string;
            inputOrder: number;
          }>`unnest(${input.ids}::uuid[]) with ordinality`.as(
            sql`t(id, input_order)`,
          ),
        )
          .selectAll()
          .as("input"),
      )
      .leftJoin("documents", (join) =>
        join
          .onRef("documents.id", "=", "input.id")
          .on("documents.tenantId", "=", input.tenantId)
          .on("documents.collection", "=", input.collection),
      )
      .selectAll("documents")
      .orderBy("input.inputOrder");
    if (!input.includeDeleted) {
      query = query.where("documents.deletedAt", "is", null);
    }
    const rows = await query.execute();
    return rows.map((row) =>
      mapNullableDocumentRow<TData>(row as NullableDocumentRow),
    );
  }

  async findByRemoteIdentity<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    remoteSource: string;
    remoteId: string;
    includeDeleted?: boolean;
  }): Promise<StoredDocument<TData> | null> {
    let query = this.database
      .selectFrom("documents")
      .selectAll()
      .where("tenantId", "=", input.tenantId)
      .where("collection", "=", input.collection)
      .where("remoteSource", "=", input.remoteSource)
      .where("remoteId", "=", input.remoteId);
    if (!input.includeDeleted) {
      query = query.where("deletedAt", "is", null);
    }
    const row = await query.executeTakeFirst();
    return row ? mapDocumentRow<TData>(row) : null;
  }

  async list<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    query: NormalizedListDocumentsInput;
  }): Promise<StoredDocument<TData>[]> {
    let query = this.database
      .selectFrom("documents")
      .selectAll()
      .where("tenantId", "=", input.tenantId)
      .where("collection", "=", input.collection);

    if (!input.query.includeDeleted) {
      query = query.where("deletedAt", "is", null);
    }
    if (input.query.filter) {
      query = query.where(buildFilterCondition(input.query.filter));
    }
    const authScopeCondition = buildAuthScopeCondition(
      input.query.authScopeIds,
    );
    if (authScopeCondition) {
      query = query.where(authScopeCondition);
    }
    for (const sort of normalizeSort(input.query.sort)) {
      query = query.orderBy(buildFieldExpression(sort.field), sort.direction);
    }

    const rows = await query
      .limit(input.query.limit)
      .offset(input.query.offset)
      .execute();
    return rows.map((row) => mapDocumentRow<TData>(row));
  }

  async updateMany<TData extends JsonObject>(
    input: UpdateManyDocumentsRecord<TData>,
  ): Promise<StoredDocument<TData>[] | null> {
    if (input.records.length === 0) {
      return [];
    }

    const columns = pivotToColumns(
      input.records,
      updateDocumentRecordSchema,
      "set",
    );
    type UpdateInput = {
      [K in keyof typeof columns]: (typeof columns)[K][number];
    };

    try {
      return await this.database.transaction().execute(async (tx) => {
        await assertAuthScopesBelongToTenant(
          tx,
          input.tenantId,
          columns.authScopeId,
        );

        const result = await tx
          .updateTable("documents")
          .from(
            sql<UpdateInput>`
              unnest(
                ${columns.id}::uuid[],
                ${columns.collection}::text[],
                ${columns.expectedVersion}::int[],
                ${columns.schemaVersion}::int[],
                ${columns.data}::jsonb[],
                ${columns.setData}::boolean[],
                ${columns.authScopeId}::uuid[],
                ${columns.setAuthScopeId}::boolean[],
                ${columns.deletedAt}::timestamp with time zone[],
                ${columns.setDeletedAt}::boolean[],
                ${columns.remoteSource}::text[],
                ${columns.setRemoteSource}::boolean[],
                ${columns.remoteId}::text[],
                ${columns.setRemoteId}::boolean[]
              )
            `.as<"updates">(
              sql`
                updates(
                  id, collection, expected_version, schema_version,
                  data, set_data,
                  auth_scope_id, set_auth_scope_id,
                  deleted_at, set_deleted_at,
                  remote_source, set_remote_source,
                  remote_id, set_remote_id
                )
              `,
            ),
          )
          .whereRef("documents.id", "=", "updates.id")
          .where("documents.tenantId", "=", input.tenantId)
          .whereRef("documents.collection", "=", "updates.collection")
          .whereRef("documents.version", "=", "updates.expectedVersion")
          .set(({ eb, fn }) => ({
            version: eb("documents.version", "+", 1),
            schemaVersion: fn.coalesce(
              "updates.schemaVersion",
              "documents.schemaVersion",
            ),
            updatedAt: sql`now()`,
            data: sql<JsonObject>`
              case
                when updates.set_data then updates.data
                else documents.data
              end
            `,
            authScopeId: sql<string | null>`
              case
                when updates.set_auth_scope_id then updates.auth_scope_id
                else documents.auth_scope_id
              end
            `,
            deletedAt: sql<Date | string | null>`
              case
                when updates.set_deleted_at then updates.deleted_at
                else documents.deleted_at
              end
            `,
            remoteId: sql<string | null>`
              case
                when updates.set_remote_id then updates.remote_id
                else documents.remote_id
              end
            `,
            remoteSource: sql<string | null>`
              case
                when updates.set_remote_source then updates.remote_source
                else documents.remote_source
              end
            `,
          }))
          .returningAll(["documents"])
          .execute();

        if (result.length !== input.records.length) {
          throw new BatchUpdateConflict();
        }
        return result.map((row) => mapDocumentRow<TData>(row));
      });
    } catch (error) {
      if (error instanceof BatchUpdateConflict) {
        return null;
      }
      throw error;
    }
  }

  async upsertRemoteProjections<TData extends JsonObject>(
    record: UpsertRemoteProjectionsRecord<TData>,
  ): Promise<StoredDocument<TData>[]> {
    if (record.projections.length === 0) {
      return [];
    }

    const { remoteId, data, authScopeId } = pivotToColumns(
      record.projections,
      upsertRemoteProjectionSchema,
    );

    await assertAuthScopesBelongToTenant(
      this.database,
      record.tenantId,
      authScopeId ?? [],
    );

    type ProjectionInput = {
      data: TData;
      authScopeId: string | null;
      remoteId: string;
    };

    const rows = await this.database
      .insertInto("documents")
      .columns([
        "tenantId",
        "collection",
        "schemaVersion",
        "data",
        "authScopeId",
        "remoteSource",
        "remoteId",
        "updatedAt",
      ])
      .expression(({ selectFrom, val }) =>
        selectFrom(
          sql<ProjectionInput>`unnest(${data}::jsonb[], ${authScopeId}::uuid[], ${remoteId}::text[])`.as<"input">(
            sql`input(data, auth_scope_id, remote_id)`,
          ),
        ).select([
          val(record.tenantId).as("tenantId"),
          val(record.collection).as("collection"),
          val(record.schemaVersion).as("schemaVersion"),
          "input.data",
          "input.authScopeId",
          val(record.remoteSource).as("remoteSource"),
          "input.remoteId",
          sql`now()`.as("updatedAt"),
        ]),
      )
      .onConflict((conflict) =>
        conflict
          .columns(["tenantId", "collection", "remoteId", "remoteSource"])
          .where("remoteSource", "is not", null)
          .where("remoteId", "is not", null)
          .doUpdateSet(({ ref, fn, eb }) => ({
            schemaVersion: ref("excluded.schemaVersion"),
            data: ref("excluded.data"),
            authScopeId: fn.coalesce(
              "excluded.authScopeId",
              "documents.authScopeId",
            ),
            deletedAt: null,
            version: eb("documents.version", "+", 1),
            updatedAt: sql`now()`,
          })),
      )
      .returningAll()
      .execute();

    return rows.map((row) => mapDocumentRow<TData>(row));
  }

  async hardDeleteMany(input: {
    tenantId: string;
    collection: string;
    ids: string[];
  }): Promise<string[]> {
    if (input.ids.length === 0) {
      return [];
    }

    const result = await this.database
      .with("input", (db) =>
        db
          .selectFrom(
            sql<{
              id: string;
              inputOrder: number;
            }>`unnest(${input.ids}::uuid[]) with ordinality`.as(
              sql`t(id, input_order)`,
            ),
          )
          .selectAll(),
      )
      .with("deleted", (db) =>
        db
          .deleteFrom("documents")
          .where("tenantId", "=", input.tenantId)
          .where("collection", "=", input.collection)
          .where("id", "in", db.selectFrom("input").select("id"))
          .returning("id"),
      )
      .selectFrom("input")
      .innerJoin("deleted", "deleted.id", "input.id")
      .select(
        sql<
          string[]
        >`coalesce(array_agg(input.id order by input.input_order), array[]::uuid[])`.as(
          "ids",
        ),
      )
      .executeTakeFirstOrThrow();
    return result.ids;
  }
}

function buildAuthScopeCondition(
  authScopeIds?: (string | null)[],
): RawBuilder<boolean> | undefined {
  if (!authScopeIds) {
    return undefined;
  }
  if (authScopeIds.length === 0) {
    return sql<boolean>`false`;
  }

  const scopedIds = authScopeIds.filter(
    (scopeId): scopeId is string => scopeId !== null,
  );
  const conditions: RawBuilder<boolean>[] = [];
  if (authScopeIds.includes(null)) {
    conditions.push(sql<boolean>`documents.auth_scope_id is null`);
  }
  if (scopedIds.length > 0) {
    conditions.push(
      sql<boolean>`documents.auth_scope_id in (${sql.join(
        scopedIds.map((scopeId) => sql`${scopeId}`),
        sql`, `,
      )})`,
    );
  }
  return conditions.length === 1
    ? conditions[0]
    : sql<boolean>`(${sql.join(conditions, sql` or `)})`;
}

async function assertAuthScopesBelongToTenant(
  database: DocumentDatabase,
  tenantId: string | undefined,
  authScopeIds: (string | null)[],
): Promise<void> {
  if (!tenantId || authScopeIds.length === 0) {
    return;
  }

  const invalid = await database
    .selectFrom(({ selectFrom }) =>
      selectFrom(
        sql<{
          authScopeId: string | null;
          inputOrder: number;
        }>`unnest(${authScopeIds}::uuid[]) with ordinality`.as(
          sql`t(auth_scope_id, input_order)`,
        ),
      )
        .selectAll()
        .as("input"),
    )
    .leftJoin("authScopes", (join) =>
      join
        .on("authScopes.tenantId", "=", tenantId)
        .onRef("authScopes.scopeId", "=", "input.authScopeId"),
    )
    .select("input.authScopeId")
    .where("input.authScopeId", "is not", null)
    .where("authScopes.scopeId", "is", null)
    .orderBy("input.inputOrder")
    .executeTakeFirst();
  const invalidScopeId = invalid?.authScopeId;
  if (invalidScopeId) {
    throw new DocumentServiceError(
      "INVALID_AUTH_SCOPE",
      "Document auth scope does not belong to the tenant",
      { tenantId, authScopeId: invalidScopeId },
    );
  }
}

function mapDocumentRow<TData extends JsonObject>(
  row: DocumentRow,
): StoredDocument<TData> {
  return {
    id: row.id,
    tenantId: row.tenantId,
    collection: row.collection,
    schemaVersion: row.schemaVersion,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Document JSON is schema-validated before repository writes.
    data: row.data as TData,
    authScopeId: row.authScopeId,
    remoteSource: row.remoteSource,
    remoteId: row.remoteId,
    version: row.version,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: row.deletedAt ? toDate(row.deletedAt) : null,
  };
}

function mapNullableDocumentRow<TData extends JsonObject>(
  row: NullableDocumentRow,
): StoredDocument<TData> | null {
  if (!row.id) {
    return null;
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The left join is fully populated whenever the document primary key exists.
  return mapDocumentRow<TData>(row as DocumentRow);
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
