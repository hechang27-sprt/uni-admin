import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type InferSelectModel,
  type SQL,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as dbSchema from "../../db/schema";
import { documentsTable } from "../../db/schema";
import type {
  DocumentField,
  DocumentFilter,
  DocumentSort,
  JsonObject,
  JsonValue,
  ListDocumentsInput,
  NormalizedListDocumentsInput,
  StoredDocument,
} from "./types";

type DocumentRow = InferSelectModel<typeof documentsTable>;
type DrizzleDatabase = NodePgDatabase<typeof dbSchema>;

export interface InsertDocumentRecord<TData extends JsonObject = JsonObject> {
  tenantId: string;
  collection: string;
  schemaVersion: number;
  data: TData;
  remoteSource?: string | null;
  remoteId?: string | null;
}

export interface UpdateDocumentRecord<TData extends JsonObject = JsonObject> {
  tenantId: string;
  collection: string;
  id: string;
  expectedVersion: number;
  schemaVersion?: number;
  data?: TData;
  deletedAt?: Date | null;
  remoteSource?: string | null;
  remoteId?: string | null;
}

export interface DocumentRepository {
  insert<TData extends JsonObject>(
    record: InsertDocumentRecord<TData>,
  ): Promise<StoredDocument<TData>>;
  findById<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    id: string;
    includeDeleted?: boolean;
  }): Promise<StoredDocument<TData> | null>;
  findByRemoteIdentity<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    remoteSource: string;
    remoteId: string;
    includeDeleted?: boolean;
  }): Promise<StoredDocument<TData> | null>;
  list<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    query: NormalizedListDocumentsInput;
  }): Promise<StoredDocument<TData>[]>;
  update<TData extends JsonObject>(
    record: UpdateDocumentRecord<TData>,
  ): Promise<StoredDocument<TData> | null>;
  hardDelete(input: {
    tenantId: string;
    collection: string;
    id: string;
  }): Promise<boolean>;
}

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

  async findById<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    id: string;
    includeDeleted?: boolean;
  }): Promise<StoredDocument<TData> | null> {
    const conditions = [
      eq(documentsTable.tenantId, input.tenantId),
      eq(documentsTable.collection, input.collection),
      eq(documentsTable.id, input.id),
    ];

    if (!input.includeDeleted) {
      conditions.push(isNull(documentsTable.deletedAt));
    }

    const rows = await this.database
      .select()
      .from(documentsTable)
      .where(and(...conditions))
      .limit(1);
    return rows[0] ? mapDocumentRow<TData>(rows[0]) : null;
  }

  async findByRemoteIdentity<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    remoteSource: string;
    remoteId: string;
    includeDeleted?: boolean;
  }): Promise<StoredDocument<TData> | null> {
    const conditions = [
      eq(documentsTable.tenantId, input.tenantId),
      eq(documentsTable.collection, input.collection),
      eq(documentsTable.remoteSource, input.remoteSource),
      eq(documentsTable.remoteId, input.remoteId),
    ];

    if (!input.includeDeleted) {
      conditions.push(isNull(documentsTable.deletedAt));
    }

    const rows = await this.database
      .select()
      .from(documentsTable)
      .where(and(...conditions))
      .limit(1);
    return rows[0] ? mapDocumentRow<TData>(rows[0]) : null;
  }

  async list<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    query: NormalizedListDocumentsInput;
  }): Promise<StoredDocument<TData>[]> {
    const conditions = [
      eq(documentsTable.tenantId, input.tenantId),
      eq(documentsTable.collection, input.collection),
    ];

    if (!input.query.includeDeleted) {
      conditions.push(isNull(documentsTable.deletedAt));
    }

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

export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly records = new Map<string, StoredDocument>();

  async insert<TData extends JsonObject>(
    record: InsertDocumentRecord<TData>,
  ): Promise<StoredDocument<TData>> {
    const now = new Date();
    const document: StoredDocument<TData> = {
      id: crypto.randomUUID(),
      tenantId: record.tenantId,
      collection: record.collection,
      schemaVersion: record.schemaVersion,
      data: cloneJsonObject(record.data),
      remoteSource: record.remoteSource ?? null,
      remoteId: record.remoteId ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    this.records.set(document.id, document);
    return cloneDocument(document);
  }

  async findById<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    id: string;
    includeDeleted?: boolean;
  }): Promise<StoredDocument<TData> | null> {
    const document = this.records.get(input.id);

    if (
      !document ||
      document.tenantId !== input.tenantId ||
      document.collection !== input.collection ||
      (!input.includeDeleted && document.deletedAt)
    ) {
      return null;
    }

    return cloneDocument(document) as StoredDocument<TData>;
  }

  async findByRemoteIdentity<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    remoteSource: string;
    remoteId: string;
    includeDeleted?: boolean;
  }): Promise<StoredDocument<TData> | null> {
    const document = [...this.records.values()].find((record) => {
      return (
        record.tenantId === input.tenantId &&
        record.collection === input.collection &&
        record.remoteSource === input.remoteSource &&
        record.remoteId === input.remoteId &&
        (input.includeDeleted || !record.deletedAt)
      );
    });

    return document ? (cloneDocument(document) as StoredDocument<TData>) : null;
  }

  async list<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    query: NormalizedListDocumentsInput;
  }): Promise<StoredDocument<TData>[]> {
    const filtered = [...this.records.values()].filter((document) => {
      return (
        document.tenantId === input.tenantId &&
        document.collection === input.collection &&
        (input.query.includeDeleted || !document.deletedAt) &&
        (!input.query.filter || matchesFilter(document, input.query.filter))
      );
    });

    filtered.sort((left, right) =>
      compareDocuments(left, right, normalizeSort(input.query.sort)),
    );

    return filtered
      .slice(input.query.offset, input.query.offset + input.query.limit)
      .map((document) => cloneDocument(document) as StoredDocument<TData>);
  }

  async update<TData extends JsonObject>(
    record: UpdateDocumentRecord<TData>,
  ): Promise<StoredDocument<TData> | null> {
    const document = this.records.get(record.id);

    if (
      !document ||
      document.tenantId !== record.tenantId ||
      document.collection !== record.collection ||
      document.version !== record.expectedVersion
    ) {
      return null;
    }

    const updated: StoredDocument<TData> = {
      ...document,
      schemaVersion: record.schemaVersion ?? document.schemaVersion,
      data:
        record.data !== undefined
          ? cloneJsonObject(record.data)
          : (cloneJsonObject(document.data) as TData),
      deletedAt:
        "deletedAt" in record ? (record.deletedAt ?? null) : document.deletedAt,
      remoteSource:
        "remoteSource" in record
          ? (record.remoteSource ?? null)
          : document.remoteSource,
      remoteId:
        "remoteId" in record ? (record.remoteId ?? null) : document.remoteId,
      version: document.version + 1,
      updatedAt: new Date(),
    };

    this.records.set(record.id, updated);
    return cloneDocument(updated);
  }

  async hardDelete(input: {
    tenantId: string;
    collection: string;
    id: string;
  }): Promise<boolean> {
    const document = this.records.get(input.id);

    if (
      !document ||
      document.tenantId !== input.tenantId ||
      document.collection !== input.collection
    ) {
      return false;
    }

    return this.records.delete(input.id);
  }
}

export function normalizeListInput(
  input: ListDocumentsInput = {},
): NormalizedListDocumentsInput {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);

  return {
    filter: input.filter,
    sort: normalizeSort(input.sort),
    limit,
    offset,
    includeDeleted: input.includeDeleted ?? false,
  };
}

export function normalizeSort(sort: DocumentSort[] = []): DocumentSort[] {
  const normalized = sort.map((entry) => ({
    ...entry,
    direction: entry.direction ?? "asc",
  }));
  const hasIdTieBreaker = normalized.some(
    (entry) => entry.field.kind === "metadata" && entry.field.name === "id",
  );

  if (!hasIdTieBreaker) {
    normalized.push({
      field: { kind: "metadata", name: "id" },
      direction: "asc",
    });
  }

  return normalized;
}

function buildFilterCondition(filter: DocumentFilter): SQL | undefined {
  if ("and" in filter) {
    return and(...filter.and.map(buildFilterCondition));
  }

  if ("or" in filter) {
    return or(...filter.or.map(buildFilterCondition));
  }

  const field = buildFieldExpression(filter.field);

  switch (filter.op) {
    case "eq":
      return filter.value === null ? isNull(field) : eq(field, filter.value);
    case "ne":
      return filter.value === null ? isNotNull(field) : ne(field, filter.value);
    case "gt":
      return gt(field, filter.value);
    case "gte":
      return gte(field, filter.value);
    case "lt":
      return lt(field, filter.value);
    case "lte":
      return lte(field, filter.value);
  }
}

function buildFieldExpression(field: DocumentField): SQL {
  if (field.kind === "data") {
    return sql`jsonb_extract_path_text(${documentsTable.data}, ${sql.join(
      field.path.map((segment) => sql`${segment}`),
      sql`, `,
    )})`;
  }

  switch (field.name) {
    case "id":
      return sql`${documentsTable.id}`;
    case "tenantId":
      return sql`${documentsTable.tenantId}`;
    case "collection":
      return sql`${documentsTable.collection}`;
    case "schemaVersion":
      return sql`${documentsTable.schemaVersion}`;
    case "version":
      return sql`${documentsTable.version}`;
    case "createdAt":
      return sql`${documentsTable.createdAt}`;
    case "updatedAt":
      return sql`${documentsTable.updatedAt}`;
    case "deletedAt":
      return sql`${documentsTable.deletedAt}`;
    case "remoteSource":
      return sql`${documentsTable.remoteSource}`;
    case "remoteId":
      return sql`${documentsTable.remoteId}`;
  }
}

function matchesFilter(
  document: StoredDocument,
  filter: DocumentFilter,
): boolean {
  if ("and" in filter) {
    return filter.and.every((child) => matchesFilter(document, child));
  }

  if ("or" in filter) {
    return filter.or.some((child) => matchesFilter(document, child));
  }

  const actual = getFieldValue(document, filter.field);

  switch (filter.op) {
    case "eq":
      return compareValues(actual, filter.value) === 0;
    case "ne":
      return compareValues(actual, filter.value) !== 0;
    case "gt":
      return compareValues(actual, filter.value) > 0;
    case "gte":
      return compareValues(actual, filter.value) >= 0;
    case "lt":
      return compareValues(actual, filter.value) < 0;
    case "lte":
      return compareValues(actual, filter.value) <= 0;
  }
}

function compareDocuments(
  left: StoredDocument,
  right: StoredDocument,
  sort: DocumentSort[],
): number {
  for (const sortEntry of sort) {
    const direction = sortEntry.direction === "desc" ? -1 : 1;
    const comparison = compareValues(
      getFieldValue(left, sortEntry.field),
      getFieldValue(right, sortEntry.field),
    );

    if (comparison !== 0) {
      return comparison * direction;
    }
  }

  return 0;
}

function getFieldValue(
  document: StoredDocument,
  field: DocumentField,
): JsonValue | Date | undefined {
  if (field.kind === "metadata") {
    return document[field.name];
  }

  let current: JsonValue | undefined = document.data;

  for (const segment of field.path) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function compareValues(
  left: JsonValue | Date | undefined,
  right: JsonValue | Date | undefined,
): number {
  if (left === right) {
    return 0;
  }

  if (left === undefined || left === null) {
    return -1;
  }

  if (right === undefined || right === null) {
    return 1;
  }

  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue;
  }

  return String(leftValue).localeCompare(String(rightValue));
}

function mapDocumentRow<TData extends JsonObject>(
  row: DocumentRow,
): StoredDocument<TData> {
  return {
    id: row.id,
    tenantId: row.tenantId,
    collection: row.collection,
    schemaVersion: row.schemaVersion,
    data: row.data as TData,
    remoteSource: row.remoteSource,
    remoteId: row.remoteId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function assertDocumentRow(row: DocumentRow | undefined): DocumentRow {
  if (!row) {
    throw new Error("Document insert did not return a row");
  }

  return row;
}

function cloneDocument<TData extends JsonObject>(
  document: StoredDocument<TData>,
): StoredDocument<TData> {
  return {
    ...document,
    data: cloneJsonObject(document.data),
    createdAt: new Date(document.createdAt),
    updatedAt: new Date(document.updatedAt),
    deletedAt: document.deletedAt ? new Date(document.deletedAt) : null,
  };
}

function cloneJsonObject<TData extends JsonObject>(data: TData): TData {
  return JSON.parse(JSON.stringify(data)) as TData;
}
