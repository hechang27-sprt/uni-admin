import type { ColumnType, Generated } from "kysely";

import type { JsonObject } from "../data/documents/types";

type Timestamp = ColumnType<Date | string, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<
  Date | string | null,
  Date | string | null | undefined,
  Date | string | null
>;

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

export interface PermissionsTable {
  permissionId: Generated<string>;
  key: string;
  source: string;
  description: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RolePermissionsTable {
  tenantId: string;
  roleId: string;
  permissionId: string;
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
  permissions: PermissionsTable;
  rolePermissions: RolePermissionsTable;
  userRoleAssignments: UserRoleAssignmentsTable;
  documents: DocumentsTable;
}
