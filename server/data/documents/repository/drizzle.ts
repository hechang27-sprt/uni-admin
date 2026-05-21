import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as dbSchema from "#server/db/schema";
import { documentsTable } from "#server/db/schema";
import type {
  JsonObject,
  NormalizedListDocumentsInput,
  StoredDocument,
} from "../types";
import type {
  DocumentRepository,
  InsertDocumentRecord,
  InsertManyDocumentsRecord,
  UpdateDocumentRecord,
  UpdateManyDocumentsRecord,
  UpsertRemoteProjectionsRecord,
} from "./types";
import {
  assertDocumentRow,
  assertUpsertedRemoteProjection,
  mapDocumentRow,
  type BatchUpdateRow,
} from "./mapping";
import {
  buildFieldExpression,
  buildFilterCondition,
  normalizeSort,
} from "./query";

type DrizzleDatabase = NodePgDatabase<typeof dbSchema>;

class BatchUpdateConflict extends Error {}

export class DrizzleDocumentRepository implements DocumentRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async insert<TData extends JsonObject>(
    record: InsertDocumentRecord<TData>,
  ): Promise<StoredDocument<TData>> {
    const [row] = await this.database
      .insert(documentsTable)
      .values({
        tenantId: record.tenantId,
        collection: record.collection,
        schemaVersion: record.schemaVersion,
        data: record.data,
        remoteSource: record.remoteSource ?? null,
        remoteId: record.remoteId ?? null,
      })
      .returning();

    return mapDocumentRow<TData>(assertDocumentRow(row));
  }

  async insertMany<TData extends JsonObject>(
    record: InsertManyDocumentsRecord<TData>,
  ): Promise<StoredDocument<TData>[]> {
    if (record.items.length === 0) {
      return [];
    }

    const rows = await this.database
      .insert(documentsTable)
      .values(
        record.items.map((item) => ({
          tenantId: record.tenantId,
          collection: record.collection,
          schemaVersion: record.schemaVersion,
          data: item.data,
          remoteSource: item.remoteSource ?? null,
          remoteId: item.remoteId ?? null,
        })),
      )
      .returning();

    return rows.map((row) => mapDocumentRow<TData>(row));
  }

  async findById<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    id: string;
    includeDeleted?: boolean;
  }): Promise<StoredDocument<TData> | null> {
    const rows = await this.database
      .select()
      .from(documentsTable)
      .where(
        and(
          ...buildDocumentScopeConditions(input, [
            eq(documentsTable.id, input.id),
          ]),
        ),
      )
      .limit(1);
    return rows[0] ? mapDocumentRow<TData>(rows[0]) : null;
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

  async update<TData extends JsonObject>(
    record: UpdateDocumentRecord<TData>,
  ): Promise<StoredDocument<TData> | null> {
    const nextValues: Record<string, unknown> = {
      version: record.expectedVersion + 1,
      updatedAt: new Date(),
    };

    if (record.schemaVersion !== undefined) {
      nextValues.schemaVersion = record.schemaVersion;
    }

    if (record.data !== undefined) {
      nextValues.data = record.data;
    }

    if ("deletedAt" in record) {
      nextValues.deletedAt = record.deletedAt;
    }

    if ("remoteSource" in record) {
      nextValues.remoteSource = record.remoteSource;
    }

    if ("remoteId" in record) {
      nextValues.remoteId = record.remoteId;
    }

    const [row] = await this.database
      .update(documentsTable)
      .set(nextValues)
      .where(
        and(
          eq(documentsTable.tenantId, record.tenantId),
          eq(documentsTable.collection, record.collection),
          eq(documentsTable.id, record.id),
          eq(documentsTable.version, record.expectedVersion),
        ),
      )
      .returning();

    return row ? mapDocumentRow<TData>(row) : null;
  }

  async updateMany<TData extends JsonObject>(
    record: UpdateManyDocumentsRecord<TData>,
  ): Promise<StoredDocument<TData>[] | null> {
    if (record.records.length === 0) {
      return [];
    }

    try {
      return await this.database.transaction(async (tx) => {
        const result = await tx.execute<BatchUpdateRow>(
          buildBatchUpdateQuery(record.records),
        );

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

    const now = new Date();
    const rows = await this.database
      .insert(documentsTable)
      .values(
        record.projections.map((projection) => ({
          tenantId: record.tenantId,
          collection: record.collection,
          schemaVersion: record.schemaVersion,
          data: projection.data,
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

  async hardDelete(input: {
    tenantId: string;
    collection: string;
    id: string;
  }): Promise<boolean> {
    const rows = await this.database
      .delete(documentsTable)
      .where(
        and(
          eq(documentsTable.tenantId, input.tenantId),
          eq(documentsTable.collection, input.collection),
          eq(documentsTable.id, input.id),
        ),
      )
      .returning({ id: documentsTable.id });

    return rows.length > 0;
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
