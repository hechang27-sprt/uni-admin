/* oxlint-disable typescript/unbound-method -- Kysely expression-builder callback methods are used only to build SQL AST nodes. */
import { inject, injectable } from "inversify";
import { sql, type Selectable } from "kysely";

import type { DocumentsTable } from "#server/db/schema";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import type { JsonObject, ListDocumentsInput, StoredDocument } from "../types";
import {
  buildAccessibleScopeCondition,
  buildAuthScopeCondition,
  buildFieldExpression,
  buildFilterCondition,
  hasAccessibleScopeFilter,
  normalizeListInput,
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

type DocumentRow = Selectable<DocumentsTable>;

class BatchUpdateConflict extends Error {}

@injectable()
export class KyselyDocumentRepository implements DocumentRepository {
  constructor(
    @inject(SERVER_DI_TYPES.DatabaseClient)
    private readonly database: DatabaseClient,
  ) {}

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
    query?: ListDocumentsInput;
  }): Promise<StoredDocument<TData>[]> {
    const normalized = normalizeListInput(input.query);

    let query = this.database
      .selectFrom("documents")
      .selectAll()
      .where("tenantId", "=", input.tenantId)
      .where("collection", "=", input.collection);

    if (!normalized.includeDeleted) {
      query = query.where("deletedAt", "is", null);
    }

    const { ids, filter, authScopeIds, accessibleScopeIds } = normalized;
    if (ids) {
      if (ids.length === 0) {
        return [];
      }
      query = query.where("id", "in", ids);
    }

    if (filter) {
      query = query.where((eb) => buildFilterCondition(eb, filter));
    }

    if (hasAccessibleScopeFilter(accessibleScopeIds)) {
      query = this.applyAccessibleScopeFilter(query, accessibleScopeIds);
    }

    if (authScopeIds) {
      query = query.where((eb) => buildAuthScopeCondition(eb, authScopeIds));
    }

    for (const sort of normalized.sort) {
      query = query.orderBy(
        (eb) => buildFieldExpression(eb, sort.field),
        sort.direction,
      );
    }

    const rows = await query
      .limit(normalized.limit)
      .offset(normalized.offset)
      .execute();
    return rows.map((row) => mapDocumentRow<TData>(row));
  }
  private applyAccessibleScopeFilter<
    TQuery extends {
      where(
        callback: (
          eb: Parameters<typeof buildAccessibleScopeCondition>[0],
        ) => Exclude<ReturnType<typeof buildAccessibleScopeCondition>, null>,
      ): TQuery;
    },
  >(query: TQuery, accessibleScopeIds: string[] | null): TQuery {
    if (accessibleScopeIds === null) {
      return query;
    }

    return query.where(
      (eb) =>
        buildAccessibleScopeCondition(eb, accessibleScopeIds) as Exclude<
          ReturnType<typeof buildAccessibleScopeCondition>,
          null
        >,
    );
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

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
