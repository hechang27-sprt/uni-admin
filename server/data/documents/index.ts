export { DocumentServiceError, isDocumentServiceError } from "./errors";
export { applyJsonPatch, type JsonPatchOperation } from "./json-patch";
export {
  createRemoteProjectionMapper,
  type RemoteAdapterContext,
  type RemoteAdapterOutputs,
  type RemoteAdapterProjection,
  type RemoteCollectionAdapter,
  type RemoteDeleteResult,
  type RemoteIdempotencyOptions,
  type RemoteProjectionResult,
  type RemoteSyncListResult,
  type RemoteSyncOneResult,
} from "./remote";
export {
  CollectionRegistry,
  createCollectionRegistry,
  type CollectionRegistration,
} from "./registry";
export {
  DrizzleDocumentRepository,
  InMemoryDocumentRepository,
  normalizeListInput,
  normalizeSort,
  type DocumentRepository,
} from "./repository";
export {
  createDocumentService,
  type CreateDocumentInput,
  type DocumentService,
  type GetDocumentInput,
  type HardDeleteDocumentInput,
  type ListDocumentServiceInput,
  type PatchDocumentInput,
  type RemoteCreateInput,
  type RemoteCreateResult,
  type RemoteDeleteDocumentResult,
  type RemoteDeleteInput,
  type RemoteUpdateInput,
  type RemoteUpdateResult,
  type SyncRemoteListInput,
  type SyncRemoteListResult,
  type SyncRemoteOneInput,
  type SyncRemoteOneResult,
  type UpdateDocumentInput,
  type VersionedDocumentInput,
} from "./service";
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
  TenantContext,
} from "./types";
