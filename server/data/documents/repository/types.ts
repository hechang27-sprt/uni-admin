import { z } from "zod";

import type {
  JsonObject,
  JsonValue,
  NormalizedListDocumentsInput,
  StoredDocument,
} from "../types";

const repositoryJsonObjectSchema = z.custom<JsonObject>(isJsonObject);

function isJsonObject(value: unknown): value is JsonObject {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(isJsonValue)
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isJsonObject(value);
}

export const insertManyDocumentsItemSchema = z.object({
  data: repositoryJsonObjectSchema,
  authScopeId: z.string().nullable().optional(),
  remoteSource: z.string().nullable().optional(),
  remoteId: z.string().nullable().optional(),
});

export const insertManyDocumentsRecordSchema = z.object({
  tenantId: z.string(),
  collection: z.string(),
  schemaVersion: z.number(),
  items: z.array(insertManyDocumentsItemSchema),
});

type InsertManyDocumentsItem = z.infer<typeof insertManyDocumentsItemSchema>;
type InsertManyDocumentsRecordBase = z.infer<
  typeof insertManyDocumentsRecordSchema
>;

export type InsertManyDocumentsRecord<
  TData extends JsonObject = JsonObject,
> = Omit<InsertManyDocumentsRecordBase, "items"> & {
  items: Array<Omit<InsertManyDocumentsItem, "data"> & { data: TData }>;
};

export const updateDocumentRecordSchema = z.object({
  collection: z.string(),
  id: z.string(),
  expectedVersion: z.number(),
  schemaVersion: z.number().optional(),
  data: repositoryJsonObjectSchema.optional(),
  authScopeId: z.string().nullable().optional(),
  deletedAt: z.date().nullable().optional(),
  remoteSource: z.string().nullable().optional(),
  remoteId: z.string().nullable().optional(),
});

export type UpdateDocumentRecordBase = z.infer<typeof updateDocumentRecordSchema>;

export type UpdateDocumentRecord<TData extends JsonObject = JsonObject> = Omit<
  UpdateDocumentRecordBase,
  "data"
> & {
  data?: TData;
};

export const updateManyDocumentsRecordSchema = z.object({
  tenantId: z.string(),
  records: z.array(updateDocumentRecordSchema),
});

type UpdateManyDocumentsRecordBase = z.infer<
  typeof updateManyDocumentsRecordSchema
>;

export type UpdateManyDocumentsRecord<
  TData extends JsonObject = JsonObject,
> = Omit<UpdateManyDocumentsRecordBase, "records"> & {
  records: UpdateDocumentRecord<TData>[];
};

export const upsertRemoteProjectionSchema = z.object({
  remoteId: z.string(),
  data: repositoryJsonObjectSchema,
  authScopeId: z.string().nullable().optional(),
});

export const upsertRemoteProjectionsRecordSchema = z.object({
  tenantId: z.string(),
  collection: z.string(),
  schemaVersion: z.number(),
  remoteSource: z.string(),
  projections: z.array(upsertRemoteProjectionSchema),
});

type UpsertRemoteProjection = z.infer<typeof upsertRemoteProjectionSchema>;
type UpsertRemoteProjectionsRecordBase = z.infer<
  typeof upsertRemoteProjectionsRecordSchema
>;

export type UpsertRemoteProjectionsRecord<
  TData extends JsonObject = JsonObject,
> = Omit<UpsertRemoteProjectionsRecordBase, "projections"> & {
  projections: Array<Omit<UpsertRemoteProjection, "data"> & { data: TData }>;
};

export interface DocumentRepository {
  insertMany<TData extends JsonObject>(
    record: InsertManyDocumentsRecord<TData>,
  ): Promise<StoredDocument<TData>[]>;
  findByIds<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    ids: string[];
    includeDeleted?: boolean;
  }): Promise<(StoredDocument<TData> | null)[]>;
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
  updateMany<TData extends JsonObject>(
    record: UpdateManyDocumentsRecord<TData>,
  ): Promise<StoredDocument<TData>[] | null>;
  upsertRemoteProjections<TData extends JsonObject>(
    record: UpsertRemoteProjectionsRecord<TData>,
  ): Promise<StoredDocument<TData>[]>;
  hardDeleteMany(input: {
    tenantId: string;
    collection: string;
    ids: string[];
  }): Promise<string[]>;
}
