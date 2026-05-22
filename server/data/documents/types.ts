export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface TenantContext {
  tenantId: string;
}

export interface TenantActorContext extends TenantContext {
  actor: {
    userId: string;
  };
}

export interface StoredDocument<TData extends JsonObject = JsonObject> {
  id: string;
  tenantId: string;
  collection: string;
  schemaVersion: number;
  data: TData;
  authScopeId: string | null;
  remoteSource: string | null;
  remoteId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type DocumentErrorCode =
  | "CONFLICT_STALE_VERSION"
  | "CONFLICT_PATCH_TEST_FAILED"
  | "VALIDATION_FAILED"
  | "UNSUPPORTED_OPERATION"
  | "NOT_FOUND"
  | "UNKNOWN_COLLECTION"
  | "HARD_DELETE_NOT_CONFIRMED"
  | "AUTHORIZER_REQUIRED"
  | "AUTHORIZATION_DENIED"
  | "INVALID_AUTH_SCOPE";

export interface DocumentErrorDetails {
  collection?: string;
  tenantId?: string;
  documentId?: string;
  expectedVersion?: number;
  currentVersion?: number;
  path?: string;
  issues?: unknown;
  operation?: string;
  capability?: string;
  authScopeId?: string | null;
  userId?: string;
}

export type MetadataField =
  | "id"
  | "tenantId"
  | "collection"
  | "schemaVersion"
  | "version"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
  | "authScopeId"
  | "remoteSource"
  | "remoteId";

export type DocumentField =
  | { kind: "metadata"; name: MetadataField }
  | { kind: "data"; path: string[] };

export type FilterOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";

export type DocumentFilter =
  | { field: DocumentField; op: FilterOperator; value: JsonValue | Date }
  | { and: DocumentFilter[] }
  | { or: DocumentFilter[] };

export interface DocumentSort {
  field: DocumentField;
  direction?: "asc" | "desc";
}

export interface ListDocumentsInput {
  filter?: DocumentFilter;
  sort?: DocumentSort[];
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  authScopeIds?: (string | null)[];
}

export interface ListDocumentsResult<TData extends JsonObject = JsonObject> {
  items: StoredDocument<TData>[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface NormalizedListDocumentsInput {
  filter?: DocumentFilter;
  sort: DocumentSort[];
  limit: number;
  offset: number;
  includeDeleted: boolean;
  authScopeIds?: (string | null)[];
}
