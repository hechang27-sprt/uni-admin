import type { InferSelectModel } from "drizzle-orm";

import { documentsTable } from "#server/db/schema";
import type { JsonObject, StoredDocument } from "../types";
import type { UpdateDocumentRecord } from "./types";

export type DocumentRow = InferSelectModel<typeof documentsTable>;
export type BatchUpdateRow = DocumentRow & { inputOrder: number };

export function mapDocumentRow<TData extends JsonObject>(
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

export function assertDocumentRow(row: DocumentRow | undefined): DocumentRow {
  if (!row) {
    throw new Error("Document insert did not return a row");
  }

  return row;
}

export function assertUpsertedRemoteProjection<TData extends JsonObject>(
  document: StoredDocument<TData> | undefined,
  remoteId: string,
): StoredDocument<TData> {
  if (!document) {
    throw new Error(`Remote projection upsert did not return row: ${remoteId}`);
  }

  return document;
}

export function applyDocumentUpdate<TData extends JsonObject>(
  document: StoredDocument,
  record: UpdateDocumentRecord<TData>,
): StoredDocument<TData> {
  return {
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
}

export function cloneDocument<TData extends JsonObject>(
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

export function cloneJsonObject<TData extends JsonObject>(data: TData): TData {
  return JSON.parse(JSON.stringify(data)) as TData;
}
