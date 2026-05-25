import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type InferSelectModel,
  type SQL,
} from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

import type * as dbSchema from "#server/db/schema";
import { authScopesTable, documentsTable } from "#server/db/schema";
import { DocumentServiceError } from "../errors";
import type {
  JsonObject,
  NormalizedListDocumentsInput,
  StoredDocument,
} from "../types";
import type {
  DocumentRepository,
  InsertManyDocumentsRecord,
  UpdateDocumentRecord,
  UpdateManyDocumentsRecord,
  UpsertRemoteProjectionsRecord,
} from "./types";
import {
  buildFieldExpression,
  buildFilterCondition,
  normalizeSort,
} from "./query";

type DocumentRow = InferSelectModel<typeof documentsTable>;
type MappableDocumentRow = Omit<
  DocumentRow,
  "createdAt" | "updatedAt" | "deletedAt"
> & {
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
};
type BatchUpdateRow = MappableDocumentRow & { inputOrder: number };
type DrizzleDatabase = PgDatabase<any, typeof dbSchema>;

class BatchUpdateConflict extends Error {}

export class DrizzleDocumentRepository implements DocumentRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async insertMany<TData extends JsonObject>(
    record: InsertManyDocumentsRecord<TData>,
  ): Promise<StoredDocument<TData>[]> {
    if (record.items.length === 0) {
      return [];
    }
    await assertAuthScopesBelongToTenant(
      this.database,
      record.tenantId,
      record.items.map((item) => item.authScopeId ?? null),
    );

    const rows = await this.database
      .insert(documentsTable)
      .values(
        record.items.map((item) => ({
          tenantId: record.tenantId,
          collection: record.collection,
          schemaVersion: record.schemaVersion,
          data: item.data,
          authScopeId: item.authScopeId ?? null,
          remoteSource: item.remoteSource ?? null,
          remoteId: item.remoteId ?? null,
        })),
      )
      .returning();

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

    const rows = await this.database
      .select()
      .from(documentsTable)
      .where(
        and(
          ...buildDocumentScopeConditions(input, [
            inArray(documentsTable.id, input.ids),
          ]),
        ),
      );
    const rowsById = new Map(
      rows.map((row) => [row.id, mapDocumentRow<TData>(row)]),
    );

    return input.ids.map((id) => rowsById.get(id) ?? null);
  }

  async findByRemoteIdentity<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    remoteSource: string;
    remoteId: string;
    includeDeleted?: boolean;
  }): Promise<StoredDocument<TData> | null> {
    const rows = await this.database
      .select()
      .from(documentsTable)
      .where(
        and(
          ...buildDocumentScopeConditions(input, [
            eq(documentsTable.remoteSource, input.remoteSource),
            eq(documentsTable.remoteId, input.remoteId),
          ]),
        ),
      )
      .limit(1);
    return rows[0] ? mapDocumentRow<TData>(rows[0]) : null;
  }

  async list<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    query: NormalizedListDocumentsInput;
  }): Promise<StoredDocument<TData>[]> {
    const conditions = buildDocumentScopeConditions({
      tenantId: input.tenantId,
      collection: input.collection,
      includeDeleted: input.query.includeDeleted,
    });

    const filterCondition = input.query.filter
      ? buildFilterCondition(input.query.filter)
      : undefined;
    if (filterCondition) {
      conditions.push(filterCondition);
    }
    const authScopeCondition = buildAuthScopeCondition(
      input.query.authScopeIds,
    );
    if (authScopeCondition) {
      conditions.push(authScopeCondition);
    }

    const orderBy = normalizeSort(input.query.sort).map((sort) => {
      const expression = buildFieldExpression(sort.field);
      return sort.direction === "desc" ? desc(expression) : asc(expression);
    });

    const rows = await this.database
      .select()
      .from(documentsTable)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(input.query.limit)
      .offset(input.query.offset);

    return rows.map((row) => mapDocumentRow<TData>(row));
  }

  async updateMany<TData extends JsonObject>(
    record: UpdateManyDocumentsRecord<TData>,
  ): Promise<StoredDocument<TData>[] | null> {
    if (record.records.length === 0) {
      return [];
    }
    await assertAuthScopesBelongToTenant(
      this.database,
      record.records[0]?.tenantId,
      record.records
        .filter((item) => "authScopeId" in item)
        .map((item) => item.authScopeId ?? null),
    );

    try {
      return await this.database.transaction(async (tx) => {
        const result = await tx.execute<BatchUpdateRow>(
          buildBatchUpdateQuery(record.records),
        );

        if (result.rows.length !== record.records.length) {
          throw new BatchUpdateConflict();
        }

        return result.rows.map((row: BatchUpdateRow) =>
          mapDocumentRow<TData>(row),
        );
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
    await assertAuthScopesBelongToTenant(
      this.database,
      record.tenantId,
      record.projections.map((projection) => projection.authScopeId ?? null),
    );

    const now = new Date();
    const rows = await this.database
      .insert(documentsTable)
      .values(
        record.projections.map((projection) => ({
          tenantId: record.tenantId,
          collection: record.collection,
          schemaVersion: record.schemaVersion,
          data: projection.data,
          authScopeId: projection.authScopeId ?? null,
          remoteSource: record.remoteSource,
          remoteId: projection.remoteId,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [
          documentsTable.tenantId,
          documentsTable.collection,
          documentsTable.remoteSource,
          documentsTable.remoteId,
        ],
        targetWhere: sql`${documentsTable.remoteSource} is not null and ${documentsTable.remoteId} is not null`,
        set: {
          schemaVersion: sql`excluded.schema_version`,
          data: sql`excluded.data`,
          authScopeId: sql`coalesce(excluded.auth_scope_id, ${documentsTable.authScopeId})`,
          deletedAt: null,
          version: sql`${documentsTable.version} + 1`,
          updatedAt: now,
        },
      })
      .returning();

    const rowsByRemoteId = new Map(
      rows.map((row) => [row.remoteId, mapDocumentRow<TData>(row)]),
    );

    return record.projections.map((projection) =>
      assertUpsertedRemoteProjection(
        rowsByRemoteId.get(projection.remoteId),
        projection.remoteId,
      ),
    );
  }

  async hardDeleteMany(input: {
    tenantId: string;
    collection: string;
    ids: string[];
  }): Promise<string[]> {
    if (input.ids.length === 0) {
      return [];
    }

    const rows = await this.database
      .delete(documentsTable)
      .where(
        and(
          eq(documentsTable.tenantId, input.tenantId),
          eq(documentsTable.collection, input.collection),
          inArray(documentsTable.id, input.ids),
        ),
      )
      .returning({ id: documentsTable.id });

    const deletedIds = new Set(rows.map((row) => row.id));
    return input.ids.filter((id) => deletedIds.has(id));
  }
}

function buildDocumentScopeConditions(
  input: {
    tenantId: string;
    collection: string;
    includeDeleted?: boolean;
  },
  extra: SQL[] = [],
): SQL[] {
  const conditions = [
    eq(documentsTable.tenantId, input.tenantId),
    eq(documentsTable.collection, input.collection),
    ...extra,
  ];

  if (!input.includeDeleted) {
    conditions.push(isNull(documentsTable.deletedAt));
  }

  return conditions;
}

function buildAuthScopeCondition(
  authScopeIds?: (string | null)[],
): SQL | undefined {
  if (!authScopeIds) {
    return undefined;
  }

  if (authScopeIds.length === 0) {
    return sql`false`;
  }

  const scopedIds = authScopeIds.filter((scopeId) => scopeId !== null);
  const conditions: SQL[] = [];

  if (authScopeIds.includes(null)) {
    conditions.push(isNull(documentsTable.authScopeId));
  }

  if (scopedIds.length > 0) {
    conditions.push(inArray(documentsTable.authScopeId, scopedIds));
  }

  return conditions.length === 1 ? conditions[0] : or(...conditions);
}

async function assertAuthScopesBelongToTenant(
  database: DrizzleDatabase,
  tenantId: string | undefined,
  authScopeIds: (string | null)[],
): Promise<void> {
  if (!tenantId) {
    return;
  }

  const scopedIds = [...new Set(authScopeIds)].filter(
    (authScopeId): authScopeId is string => authScopeId !== null,
  );
  if (scopedIds.length === 0) {
    return;
  }

  const rows = await database
    .select({ scopeId: authScopesTable.scopeId })
    .from(authScopesTable)
    .where(
      and(
        eq(authScopesTable.tenantId, tenantId),
        inArray(authScopesTable.scopeId, scopedIds),
      ),
    );
  const validScopeIds = new Set(rows.map((row) => row.scopeId));
  const invalidScopeId = scopedIds.find(
    (scopeId) => !validScopeIds.has(scopeId),
  );

  if (invalidScopeId) {
    throw new DocumentServiceError(
      "INVALID_AUTH_SCOPE",
      "Document auth scope does not belong to the tenant",
      {
        tenantId,
        authScopeId: invalidScopeId,
      },
    );
  }
}

function buildBatchUpdateQuery<TData extends JsonObject>(
  records: UpdateDocumentRecord<TData>[],
): SQL {
  const values = records.map((record, index) => {
    return sql`(
      ${record.id}::uuid,
      ${record.tenantId}::uuid,
      ${record.collection}::text,
      ${record.expectedVersion}::integer,
      ${record.schemaVersion ?? null}::integer,
      ${record.data ?? null}::jsonb,
      ${record.data !== undefined}::boolean,
      ${"authScopeId" in record ? (record.authScopeId ?? null) : null}::uuid,
      ${"authScopeId" in record}::boolean,
      ${"deletedAt" in record ? (record.deletedAt ?? null) : null}::timestamp with time zone,
      ${"deletedAt" in record}::boolean,
      ${"remoteSource" in record ? (record.remoteSource ?? null) : null}::text,
      ${"remoteSource" in record}::boolean,
      ${"remoteId" in record ? (record.remoteId ?? null) : null}::text,
      ${"remoteId" in record}::boolean,
      ${index}::integer
    )`;
  });

  return sql`
    with updates (
      id,
      tenant_id,
      collection,
      expected_version,
      schema_version,
      data,
      set_data,
      auth_scope_id,
      set_auth_scope_id,
      deleted_at,
      set_deleted_at,
      remote_source,
      set_remote_source,
      remote_id,
      set_remote_id,
      input_order
    ) as (
      values ${sql.join(values, sql`, `)}
    ),
    updated as (
      update ${documentsTable} as document
      set
        schema_version = coalesce(updates.schema_version, document.schema_version),
        data = case when updates.set_data then updates.data else document.data end,
        auth_scope_id = case
          when updates.set_auth_scope_id then updates.auth_scope_id
          else document.auth_scope_id
        end,
        deleted_at = case
          when updates.set_deleted_at then updates.deleted_at
          else document.deleted_at
        end,
        remote_source = case
          when updates.set_remote_source then updates.remote_source
          else document.remote_source
        end,
        remote_id = case
          when updates.set_remote_id then updates.remote_id
          else document.remote_id
        end,
        version = document.version + 1,
        updated_at = now()
      from updates
      where
        document.id = updates.id
        and document.tenant_id = updates.tenant_id
        and document.collection = updates.collection
        and document.version = updates.expected_version
      returning
        document.id,
        document.tenant_id as "tenantId",
        document.collection,
        document.schema_version as "schemaVersion",
        document.data,
        document.auth_scope_id as "authScopeId",
        document.remote_source as "remoteSource",
        document.remote_id as "remoteId",
        document.version,
        document.created_at as "createdAt",
        document.updated_at as "updatedAt",
        document.deleted_at as "deletedAt",
        updates.input_order as "inputOrder"
    )
    select *
    from updated
    order by "inputOrder"
  `;
}

function mapDocumentRow<TData extends JsonObject>(
  row: MappableDocumentRow,
): StoredDocument<TData> {
  return {
    id: row.id,
    tenantId: row.tenantId,
    collection: row.collection,
    schemaVersion: row.schemaVersion,
    data: row.data as TData,
    authScopeId: row.authScopeId,
    remoteSource: row.remoteSource,
    remoteId: row.remoteId,
    version: row.version,
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
    deletedAt: row.deletedAt === null ? null : asDate(row.deletedAt),
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function assertUpsertedRemoteProjection<TData extends JsonObject>(
  document: StoredDocument<TData> | undefined,
  remoteId: string,
): StoredDocument<TData> {
  if (!document) {
    throw new Error(`Remote projection upsert did not return row: ${remoteId}`);
  }

  return document;
}
