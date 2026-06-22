import type { GrantedScopes } from "#server/auth/um";
export interface TenantContext {
  tenantId: string;
}

export interface ActorContext {
  actor: {
    userId: string;
  };
}

export interface TenantActorContext extends TenantContext, ActorContext {}

export interface StoredDocument<TData extends JsonObject = JsonObject> {
  id: string;
  tenantId: string;
  schemaVersion: number;
  data: TData;
  authScopeId: string;
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
  appKey?: string;
  tenantId?: string;
  documentId?: string;
  expectedVersion?: number;
  currentVersion?: number;
  path?: string;
  issues?: unknown;
  operation?: string;
  capability?: string;
  authScopeId?: string;
  userId?: string;
}

export type MetadataField =
  | "id"
  | "tenantId"
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
  ids?: string[];
  filter?: DocumentFilter;
  sort?: DocumentSort[];
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  authScopeIds?: string[];
  grantedScopes?: GrantedScopes[];
  grantedPermissionKey?: string;
}

export interface ListDocumentsResult<TData extends JsonObject = JsonObject> {
  items: StoredDocument<TData>[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface NormalizedListDocumentsInput {
  ids?: string[];
  filter?: DocumentFilter;
  sort: DocumentSort[];
  limit: number;
  offset: number;
  includeDeleted: boolean;
  authScopeIds?: string[];
  grantedScopes?: GrantedScopes[];
  grantedPermissionKey?: string;
}
