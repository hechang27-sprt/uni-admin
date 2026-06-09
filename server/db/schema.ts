import type { ColumnType, Generated } from "kysely";

import type { JsonObject } from "../data/documents/types";

type Timestamp = ColumnType<Date | string, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<
  Date | string | null,
  Date | string | null | undefined,
  Date | string | null
>;

export const DEFAULT_APP_KEY = "default";

export interface TenantsTable {
  id: Generated<string>;
  name: string | null;
}

export interface UsersTable {
  userId: Generated<string>;
  displayName: string | null;
  status: Generated<string>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserPasswordCredentialsTable {
  userId: string;
  username: string;
  passwordHash: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TenantMembershipsTable {
  tenantId: string;
  userId: string;
  status: Generated<string>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AuthScopesTable {
  scopeId: Generated<string>;
  tenantId: string;
  parentId: string | null;
  type: string;
  key: string | null;
  name: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AuthScopeClosureTable {
  tenantId: string;
  ancestorId: string;
  descendantId: string;
  depth: number;
}

export interface RolesTable {
  roleId: Generated<string>;
  tenantId: string;
  key: string;
  name: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AppsTable {
  appId: Generated<string>;
  key: string;
  name: string | null;
  config: JsonObject | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TenantAppsTable {
  tenantId: string;
  appId: string;
  config: JsonObject | null;
  enabledAt: Timestamp;
}

export interface CollectionsTable {
  collectionId: Generated<string>;
  appId: string;
  key: string;
  definitionKey: string;
  name: string | null;
  schemaVersion: number;
  config: JsonObject | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PermissionsTable {
  key: string;
  appId: string | null;
  collectionId: string | null;
  capabilityId: string;
  source: string;
  description: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RolePermissionsTable {
  tenantId: string;
  roleId: string;
  permissionKey: string;
  createdAt: Timestamp;
}

export interface UserRoleAssignmentsTable {
  assignmentId: Generated<string>;
  tenantId: string;
  userId: string;
  roleId: string;
  scopeId: string;
  createdAt: Timestamp;
}

export interface DocumentsTable {
  id: Generated<string>;
  tenantId: string;
  appId: string;
  collectionId: string;
  collection: string;
  schemaVersion: number;
  data: JsonObject;
  authScopeId: string | null;
  remoteSource: string | null;
  remoteId: string | null;
  version: Generated<number>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: NullableTimestamp;
}

export interface Database {
  tenants: TenantsTable;
  users: UsersTable;
  userPasswordCredentials: UserPasswordCredentialsTable;
  tenantMemberships: TenantMembershipsTable;
  authScopes: AuthScopesTable;
  authScopeClosure: AuthScopeClosureTable;
  roles: RolesTable;
  apps: AppsTable;
  tenantApps: TenantAppsTable;
  collections: CollectionsTable;
  permissions: PermissionsTable;
  rolePermissions: RolePermissionsTable;
  userRoleAssignments: UserRoleAssignmentsTable;
  documents: DocumentsTable;
}
