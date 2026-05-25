import type {
  JsonObject,
  NormalizedListDocumentsInput,
  StoredDocument,
} from "../types";

export interface InsertManyDocumentsRecord<
  TData extends JsonObject = JsonObject,
> {
  tenantId: string;
  collection: string;
  schemaVersion: number;
  items: {
    data: TData;
    authScopeId?: string | null;
    remoteSource?: string | null;
    remoteId?: string | null;
  }[];
}

export interface UpdateDocumentRecord<TData extends JsonObject = JsonObject> {
  tenantId: string;
  collection: string;
  id: string;
  expectedVersion: number;
  schemaVersion?: number;
  data?: TData;
  authScopeId?: string | null;
  deletedAt?: Date | null;
  remoteSource?: string | null;
  remoteId?: string | null;
}

export interface UpdateManyDocumentsRecord<
  TData extends JsonObject = JsonObject,
> {
  records: UpdateDocumentRecord<TData>[];
}

export interface UpsertRemoteProjectionsRecord<
  TData extends JsonObject = JsonObject,
> {
  tenantId: string;
  collection: string;
  schemaVersion: number;
  remoteSource: string;
  projections: {
    remoteId: string;
    data: TData;
    authScopeId?: string | null;
  }[];
}

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
