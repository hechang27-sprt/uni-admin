export { DocumentServiceError, isDocumentServiceError } from "./errors";
export { applyJsonPatch, type JsonPatchOperation } from "./json-patch";
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
