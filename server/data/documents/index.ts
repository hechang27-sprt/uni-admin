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
  CollectionRegistry,
  createCollectionRegistry,
  deriveCollectionPermissionDefinitions,
  resolveCollectionActionAuth,
  resolveCollectionOperationAuth,
} from "./registry";
export type {
  CollectionActionAuthDeclaration,
  CollectionAuthDeclaration,
  CollectionOperation,
  CollectionOperationAuthDeclaration,
  CollectionOperationAuthInput,
  CollectionRegistration,
  CollectionResourceScopeMode,
  PermissionDefinition,
  ResolvedCollectionOperationAuth,
} from "./registry";
export {
  KyselyDocumentRepository,
  normalizeListInput,
  normalizeSort,
  type DocumentRepository,
} from "./repository";
export type {
  CreateManyDocumentInput,
  CreateDocumentInput,
  DocumentServiceConfig,
  DocumentServiceOptions,
  GetDocumentsByIdsInput,
  GetDocumentInput,
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
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ListDocumentsInput,
  ListDocumentsResult,
  MetadataField,
  NormalizedListDocumentsInput,
  StoredDocument,
  TenantActorContext,
  TenantContext,
} from "./types";
