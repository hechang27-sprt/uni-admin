import { sql, type RawBuilder, type Selectable } from "kysely";

import type { DocumentsTable } from "#server/db/schema";
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
  UpdateDocumentRecord,
  UpdateManyDocumentsRecord,
  UpsertRemoteProjectionsRecord,
} from "./types";

type DocumentRow = Selectable<DocumentsTable>;
type BatchUpdateRow = DocumentRow & { inputOrder: number };

class BatchUpdateConflict extends Error {}

export class KyselyDocumentRepository implements DocumentRepository {
  constructor(private readonly database: DatabaseClient) {}

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
      .insertInto("documents")
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
      .selectFrom("documents")
      .selectAll()
      .where("tenantId", "=", input.tenantId)
      .where("collection", "=", input.collection)
      .where("id", "in", input.ids);
    if (!input.includeDeleted) {
      query = query.where("deletedAt", "is", null);
    }
    const rows = await query.execute();
    const rowsById = new Map(
      rows.map((row): [string, StoredDocument<TData>] => [
        row.id,
        mapDocumentRow<TData>(row),
      ]),
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
      return await this.database.transaction().execute(async (tx) => {
        const result = await buildBatchUpdateQuery(record.records).execute(tx);
        if (result.rows.length !== record.records.length) {
          throw new BatchUpdateConflict();
        }
        return result.rows.map((row) => mapDocumentRow<TData>(row));
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
      .insertInto("documents")
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
      .onConflict((conflict) =>
        conflict
          .columns(["tenantId", "collection", "remoteSource", "remoteId"])
          .where(sql<boolean>`remote_source is not null and remote_id is not null`)
          .doUpdateSet({
            schemaVersion: sql`excluded.schema_version`,
            data: sql`excluded.data`,
            authScopeId: sql`coalesce(excluded.auth_scope_id, documents.auth_scope_id)`,
            deletedAt: null,
            version: sql`documents.version + 1`,
            updatedAt: now,
          }),
      )
      .returningAll()
      .execute();

    const rowsByRemoteId = new Map(
      rows.map((row): [string | null, StoredDocument<TData>] => [
        row.remoteId,
        mapDocumentRow<TData>(row),
      ]),
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
      .deleteFrom("documents")
      .where("tenantId", "=", input.tenantId)
      .where("collection", "=", input.collection)
      .where("id", "in", input.ids)
      .returning("id")
      .execute();
    const deletedIds = new Set(rows.map((row) => row.id));
    return input.ids.filter((id) => deletedIds.has(id));
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
      sql<boolean>`documents.auth_scope_id in (${sql.join(scopedIds.map((scopeId) => sql`${scopeId}`), sql`, `)})`,
    );
  }
  return conditions.length === 1
    ? conditions[0]
    : sql<boolean>`(${sql.join(conditions, sql` or `)})`;
}

async function assertAuthScopesBelongToTenant(
  database: DatabaseClient,
  tenantId: string | undefined,
  authScopeIds: (string | null)[],
): Promise<void> {
  if (!tenantId) {
    return;
  }
  const scopedIds = [
    ...new Set(
      authScopeIds.filter((scopeId): scopeId is string => scopeId !== null),
    ),
  ];
  if (scopedIds.length === 0) {
    return;
  }

  const values = scopedIds.map(
    (scopeId, inputOrder) => sql`(${scopeId}::uuid, ${inputOrder}::integer)`,
  );
  const result = await sql<{ scopeId: string }>`
    select requested_scope.scope_id as "scopeId"
    from (values ${sql.join(values, sql`, `)})
      as requested_scope(scope_id, input_order)
    where not exists (
      select 1 from auth_scopes
      where tenant_id = ${tenantId}::uuid
        and scope_id = requested_scope.scope_id
    )
    order by requested_scope.input_order
    limit 1
  `.execute(database);
  const invalidScopeId = result.rows[0]?.scopeId;
  if (invalidScopeId) {
    throw new DocumentServiceError(
      "INVALID_AUTH_SCOPE",
      "Document auth scope does not belong to the tenant",
      { tenantId, authScopeId: invalidScopeId },
    );
  }
}

function buildBatchUpdateQuery<TData extends JsonObject>(
  records: UpdateDocumentRecord<TData>[],
): RawBuilder<BatchUpdateRow> {
  const values = records.map(
    (record, index) => sql`
      (
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
      )
    `,
  );

  return sql<BatchUpdateRow>`
    with updates (
      id, tenant_id, collection, expected_version, schema_version, data,
      set_data, auth_scope_id, set_auth_scope_id, deleted_at, set_deleted_at,
      remote_source, set_remote_source, remote_id, set_remote_id, input_order
    ) as (
      values ${sql.join(values, sql`, `)}
    ),
    updated as (
      update documents as document
      set
        schema_version = coalesce(updates.schema_version, document.schema_version),
        data = case when updates.set_data then updates.data else document.data end,
        auth_scope_id = case when updates.set_auth_scope_id then updates.auth_scope_id else document.auth_scope_id end,
        deleted_at = case when updates.set_deleted_at then updates.deleted_at else document.deleted_at end,
        remote_source = case when updates.set_remote_source then updates.remote_source else document.remote_source end,
        remote_id = case when updates.set_remote_id then updates.remote_id else document.remote_id end,
        version = document.version + 1,
        updated_at = now()
      from updates
      where document.id = updates.id
        and document.tenant_id = updates.tenant_id
        and document.collection = updates.collection
        and document.version = updates.expected_version
      returning document.*, updates.input_order
    )
    select * from updated order by input_order
  `;
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

function assertUpsertedRemoteProjection<TData extends JsonObject>(
  document: StoredDocument<TData> | undefined,
  remoteId: string,
): StoredDocument<TData> {
  if (!document) {
    throw new Error(`Remote projection was not returned for ${remoteId}`);
  }
  return document;
}
