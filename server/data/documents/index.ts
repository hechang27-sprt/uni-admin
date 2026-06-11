export { DocumentServiceError, isDocumentServiceError } from "./errors";
export { applyJsonPatch, type JsonPatchOperation } from "./json-patch";
export { createRemoteProjectionMapper } from "./remote";
export type {
  RemoteAdapterContext,
  RemoteAdapterOutputs,
  RemoteAdapterProjection,
  RemoteCollectionAdapter,
  RemoteDeleteResult,
  RemoteIdempotencyOptions,
  RemoteProjectionResult,
  RemoteSyncListResult,
  RemoteSyncOneResult,
} from "./remote";
export {
  KyselyDocumentRepository,
  normalizeListInput,
  normalizeSort,
  type DocumentRepository,
} from "./repository";
export type {
  CreateManyDocumentInput,
  CreateDocumentInput,
  DocumentServiceOptions,
  HardDeleteDocumentInput,
  ListDocumentServiceInput,
  PatchDocumentInput,
  RemoteCreateInput,
  RemoteCreateResult,
  RemoteDeleteDocumentResult,
  RemoteDeleteInput,
  RemoteUpdateInput,
  RemoteUpdateResult,
  SyncRemoteListInput,
  SyncRemoteListResult,
  SyncRemoteOneInput,
  SyncRemoteOneResult,
  UpdateManyDocumentInput,
  UpdateDocumentInput,
  VersionedDocumentInput,
  SetDocumentAuthScopeInput,
} from "./service";
export { DocumentService } from "./service";
export type {
  DocumentErrorCode,
  DocumentErrorDetails,
  DocumentField,
  DocumentFilter,
  DocumentSort,
  ListDocumentsInput,
  ListDocumentsResult,
  MetadataField,
  NormalizedListDocumentsInput,
  StoredDocument,
  ActorContext,
  TenantActorContext,
  TenantContext,
} from "./types";
