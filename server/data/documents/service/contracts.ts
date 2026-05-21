import type { CollectionRegistry } from "../registry";
import type { JsonPatchOperation } from "../json-patch";
import type { DocumentRepository } from "../repository";
import type {
  JsonObject,
  ListDocumentsInput,
  ListDocumentsResult,
  StoredDocument,
  TenantContext,
} from "../types";

export interface CreateDocumentInput<
  TData extends JsonObject = JsonObject,
> extends TenantContext {
  collection: string;
  data: TData;
  remoteSource?: string | null;
  remoteId?: string | null;
}

export interface CreateManyDocumentInput<
  TData extends JsonObject = JsonObject,
> extends TenantContext {
  collection: string;
  items: {
    data: TData;
    remoteSource?: string | null;
    remoteId?: string | null;
  }[];
}

export interface VersionedDocumentInput extends TenantContext {
  collection: string;
  id: string;
  expectedVersion: number;
}

export interface GetDocumentInput extends TenantContext {
  collection: string;
  id: string;
  includeDeleted?: boolean;
}

export interface GetDocumentsByIdsInput extends TenantContext {
  collection: string;
  ids: string[];
  includeDeleted?: boolean;
}

export interface UpdateDocumentInput<
  TData extends JsonObject = JsonObject,
> extends VersionedDocumentInput {
  data: TData;
}

export interface UpdateManyDocumentInput<
  TData extends JsonObject = JsonObject,
> extends TenantContext {
  collection: string;
  items: {
    id: string;
    expectedVersion: number;
    data: TData;
  }[];
}

export interface PatchDocumentInput extends VersionedDocumentInput {
  patch: JsonPatchOperation[];
}

export interface HardDeleteDocumentInput extends TenantContext {
  collection: string;
  id: string;
  confirmHardDelete: true;
}

export interface ListDocumentServiceInput
  extends TenantContext, ListDocumentsInput {
  collection: string;
}

export interface SyncRemoteOneInput<
  TSyncInput = unknown,
> extends TenantContext {
  collection: string;
  input: TSyncInput;
}

export interface SyncRemoteListInput<
  TSyncInput = unknown,
> extends TenantContext {
  collection: string;
  input: TSyncInput;
}

export interface RemoteCreateInput<
  TCreateInput = unknown,
> extends TenantContext {
  collection: string;
  input: TCreateInput;
}

export interface RemoteUpdateInput<
  TUpdateInput = unknown,
> extends VersionedDocumentInput {
  input: TUpdateInput;
}

export interface RemoteDeleteInput<
  TDeleteInput = unknown,
> extends VersionedDocumentInput {
  input: TDeleteInput;
}

export interface SyncRemoteOneResult<
  TData extends JsonObject = JsonObject,
  TOutput = unknown,
> {
  document: StoredDocument<TData> | null;
  output?: TOutput;
}

export interface SyncRemoteListResult<
  TData extends JsonObject = JsonObject,
  TOutput = unknown,
> {
  documents: StoredDocument<TData>[];
  output?: TOutput;
}

export interface RemoteCreateResult<
  TData extends JsonObject = JsonObject,
  TOutput = unknown,
> {
  document: StoredDocument<TData>;
  output?: TOutput;
}

export interface RemoteUpdateResult<
  TData extends JsonObject = JsonObject,
  TOutput = unknown,
> {
  document: StoredDocument<TData>;
  output?: TOutput;
}

export interface RemoteDeleteDocumentResult<TOutput = unknown> {
  document: StoredDocument;
  output?: TOutput;
}

export interface DocumentService {
  create<TData extends JsonObject>(
    input: CreateDocumentInput<TData>,
  ): Promise<StoredDocument<TData>>;
  createMany<TData extends JsonObject>(
    input: CreateManyDocumentInput<TData>,
  ): Promise<StoredDocument<TData>[]>;
  getById<TData extends JsonObject>(
    input: GetDocumentInput,
  ): Promise<StoredDocument<TData> | null>;
  getByIds<TData extends JsonObject>(
    input: GetDocumentsByIdsInput,
  ): Promise<(StoredDocument<TData> | null)[]>;
  list<TData extends JsonObject>(
    input: ListDocumentServiceInput,
  ): Promise<ListDocumentsResult<TData>>;
  update<TData extends JsonObject>(
    input: UpdateDocumentInput<TData>,
  ): Promise<StoredDocument<TData>>;
  updateMany<TData extends JsonObject>(
    input: UpdateManyDocumentInput<TData>,
  ): Promise<StoredDocument<TData>[]>;
  patch<TData extends JsonObject>(
    input: PatchDocumentInput,
  ): Promise<StoredDocument<TData>>;
  softDelete(input: VersionedDocumentInput): Promise<StoredDocument>;
  restore(input: VersionedDocumentInput): Promise<StoredDocument>;
  hardDelete(input: HardDeleteDocumentInput): Promise<void>;
  syncRemoteOne<
    TData extends JsonObject,
    TSyncInput = unknown,
    TOutput = unknown,
  >(
    input: SyncRemoteOneInput<TSyncInput>,
  ): Promise<SyncRemoteOneResult<TData, TOutput>>;
  syncRemoteList<
    TData extends JsonObject,
    TSyncInput = unknown,
    TOutput = unknown,
  >(
    input: SyncRemoteListInput<TSyncInput>,
  ): Promise<SyncRemoteListResult<TData, TOutput>>;
  remoteCreate<
    TData extends JsonObject,
    TCreateInput = unknown,
    TOutput = unknown,
  >(
    input: RemoteCreateInput<TCreateInput>,
  ): Promise<RemoteCreateResult<TData, TOutput>>;
  remoteUpdate<
    TData extends JsonObject,
    TUpdateInput = unknown,
    TOutput = unknown,
  >(
    input: RemoteUpdateInput<TUpdateInput>,
  ): Promise<RemoteUpdateResult<TData, TOutput>>;
  remoteDelete<TDeleteInput = unknown, TOutput = unknown>(
    input: RemoteDeleteInput<TDeleteInput>,
  ): Promise<RemoteDeleteDocumentResult<TOutput>>;
}

export interface CreateDocumentServiceOptions {
  registry: CollectionRegistry;
  repository: DocumentRepository;
}
