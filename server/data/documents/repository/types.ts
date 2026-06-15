import { z } from "zod";

import { jsonObjectSchema } from "#server/utils/zod";
import type { ListDocumentsInput, StoredDocument } from "../types";

export const insertManyDocumentsItemSchema = z.object({
  data: jsonObjectSchema,
  authScopeId: z.string().nullable().optional(),
  remoteSource: z.string().nullable().optional(),
  remoteId: z.string().nullable().optional(),
});

export const insertManyDocumentsRecordSchema = z.object({
  tenantId: z.string(),
  appId: z.string(),
  collectionId: z.string(),
  schemaVersion: z.number(),
  items: z.array(insertManyDocumentsItemSchema),
});

type InsertManyDocumentsItem = z.infer<typeof insertManyDocumentsItemSchema>;
type InsertManyDocumentsRecordBase = z.infer<
  typeof insertManyDocumentsRecordSchema
>;

export type InsertManyDocumentsRecord<TData extends JsonObject = JsonObject> =
  Omit<InsertManyDocumentsRecordBase, "items"> & {
    items: Array<Omit<InsertManyDocumentsItem, "data"> & { data: TData }>;
  };

export const updateDocumentRecordSchema = z.object({
  appId: z.string(),
  collectionId: z.string(),
  id: z.string(),
  expectedVersion: z.number(),
  schemaVersion: z.number().optional(),
  data: jsonObjectSchema.optional(),
  authScopeId: z.string().nullable().optional(),
  deletedAt: z.date().nullable().optional(),
  remoteSource: z.string().nullable().optional(),
  remoteId: z.string().nullable().optional(),
});

export type UpdateDocumentRecordBase = z.infer<
  typeof updateDocumentRecordSchema
>;

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

export type UpdateManyDocumentsRecord<TData extends JsonObject = JsonObject> =
  Omit<UpdateManyDocumentsRecordBase, "records"> & {
    records: UpdateDocumentRecord<TData>[];
  };

export const upsertRemoteProjectionSchema = z.object({
  remoteId: z.string(),
  data: jsonObjectSchema,
  authScopeId: z.string().nullable().optional(),
});

export const upsertRemoteProjectionsRecordSchema = z.object({
  tenantId: z.string(),
  appId: z.string(),
  collectionId: z.string(),
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
  findByRemoteIdentity<TData extends JsonObject>(input: {
    tenantId: string;
    appId: string;
    collectionId: string;
    remoteSource: string;
    remoteId: string;
    includeDeleted?: boolean;
  }): Promise<StoredDocument<TData> | null>;
  list<TData extends JsonObject>(input: {
    tenantId: string;
    appId: string;
    collectionId: string;
    query?: ListDocumentsInput;
  }): Promise<StoredDocument<TData>[]>;
  updateMany<TData extends JsonObject>(
    record: UpdateManyDocumentsRecord<TData>,
  ): Promise<StoredDocument<TData>[] | null>;
  upsertRemoteProjections<TData extends JsonObject>(
    record: UpsertRemoteProjectionsRecord<TData>,
  ): Promise<StoredDocument<TData>[]>;
  hardDeleteMany(input: {
    tenantId: string;
    appId: string;
    collectionId: string;
    ids: string[];
  }): Promise<string[]>;
}
