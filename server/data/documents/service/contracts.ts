import type { CollectionRegistry } from "../registry";
import type { JsonPatchOperation } from "../json-patch";
import type { DocumentRepository } from "../repository";
import type {
  JsonObject,
  ListDocumentsInput,
  StoredDocument,
  TenantContext,
  TenantActorContext,
} from "../types";
import type { DocumentAuthorizer } from "#server/auth";

export interface CreateDocumentInput<
  TData extends JsonObject = JsonObject,
> extends TenantContext {
  collection: string;
  data: TData;
  authScopeId?: string | null;
  remoteSource?: string | null;
  remoteId?: string | null;
}

export interface CreateManyDocumentInput<
  TData extends JsonObject = JsonObject,
> extends TenantContext {
  collection: string;
  items: {
    data: TData;
    authScopeId?: string | null;
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
  authScopeId?: string | null;
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

export interface DocumentServiceOptions {
  actor?: TenantActorContext["actor"];
}

export interface SetDocumentAuthScopeInput extends TenantContext {
  collection: string;
  id: string;
  expectedVersion: number;
  authScopeId: string | null;
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

export interface DocumentServiceConfig {
  registry: CollectionRegistry;
  repository: DocumentRepository;
  authorizer?: DocumentAuthorizer;
}
