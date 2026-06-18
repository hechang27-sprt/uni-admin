import type { JsonPatchOperation } from "../json-patch";
import type { CollectionOperation } from "../../collections";
import type {
  ListDocumentsInput,
  StoredDocument,
  TenantContext,
  TenantActorContext,
} from "../types";

export interface CollectionDocumentInput extends TenantContext {
  appKey?: string;
  collection: string;
}

export interface CreateDocumentInput<
  TData extends JsonObject = JsonObject,
> extends CollectionDocumentInput {
  data: TData;
  authScopeId?: string;
  remoteSource?: string | null;
  remoteId?: string | null;
}

export interface CreateManyDocumentInput<
  TData extends JsonObject = JsonObject,
> extends CollectionDocumentInput {
  items: {
    data: TData;
    authScopeId?: string;
    remoteSource?: string | null;
    remoteId?: string | null;
  }[];
}

export interface VersionedDocumentInput extends CollectionDocumentInput {
  id: string;
  expectedVersion: number;
}

export interface UpdateDocumentInput<
  TData extends JsonObject = JsonObject,
> extends VersionedDocumentInput {
  data: TData;
}

export interface UpdateManyDocumentInput<
  TData extends JsonObject = JsonObject,
> extends CollectionDocumentInput {
  items: {
    id: string;
    expectedVersion: number;
    data: TData;
  }[];
}

export interface PatchDocumentInput extends VersionedDocumentInput {
  patch: JsonPatchOperation[];
}

export interface HardDeleteDocumentInput extends CollectionDocumentInput {
  id: string;
  confirmHardDelete: true;
}

export interface ListDocumentServiceInput
  extends CollectionDocumentInput, ListDocumentsInput {
  operation?: CollectionOperation;
}
export interface SyncRemoteOneInput<
  TSyncInput = unknown,
> extends CollectionDocumentInput {
  input: TSyncInput;
}

export interface SyncRemoteListInput<
  TSyncInput = unknown,
> extends CollectionDocumentInput {
  input: TSyncInput;
}

export interface RemoteCreateInput<
  TCreateInput = unknown,
> extends CollectionDocumentInput {
  input: TCreateInput;
  authScopeId?: string;
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

export interface SetDocumentAuthScopeInput extends CollectionDocumentInput {
  id: string;
  expectedVersion: number;
  authScopeId: string;
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
