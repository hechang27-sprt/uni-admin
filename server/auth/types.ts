import type { TenantActorContext } from "#server/data/documents";

export interface AuthUser {
  userId: string;
  displayName: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantMembership {
  tenantId: string;
  userId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthScope {
  scopeId: string;
  tenantId: string;
  parentId: string | null;
  type: string;
  key: string | null;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Role {
  roleId: string;
  tenantId: string;
  key: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Permission {
  permissionId: string;
  key: string;
  source: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsernamePasswordCredential {
  userId: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  displayName?: string | null;
}

export interface SetPasswordCredentialInput {
  userId: string;
  username: string;
  password: string;
}

export interface VerifyPasswordInput {
  username: string;
  password: string;
}

export interface CreateTenantMembershipInput {
  tenantId: string;
  userId: string;
}

export interface CreateScopeInput {
  tenantId: string;
  parentScopeId: string;
  type: string;
  key?: string | null;
  name?: string | null;
}

export interface CreateRoleInput {
  tenantId: string;
  key: string;
  name?: string | null;
}

export interface PermissionDefinitionInput {
  key: string;
  source: string;
  description?: string | null;
}

export interface GrantPermissionInput {
  tenantId: string;
  roleId?: string;
  roleKey?: string;
  permissionKey: string;
}

export interface AssignRoleInput {
  tenantId: string;
  userId: string;
  roleId?: string;
  roleKey?: string;
  scopeId: string;
}

export interface CheckAccessInput {
  context: TenantActorContext;
  capability: string;
  targetScopeId: string | null;
}

export interface CheckAccessManyInput {
  context: TenantActorContext;
  checks: {
    capability: string;
    targetScopeId: string | null;
  }[];
}

export interface ListAccessibleScopesInput {
  context: TenantActorContext;
  capability: string;
}

export interface BootstrapTenantOwnerInput {
  tenantId: string;
  username: string;
  password: string;
  displayName?: string | null;
  ownerRoleKey?: string;
}

export interface BootstrapTenantOwnerResult {
  user: AuthUser;
  rootScope: AuthScope;
  ownerRole: Role;
  context: TenantActorContext;
}

export interface DocumentAuthorizer {
  checkAccessMany(input: CheckAccessManyInput): Promise<boolean[]>;
  listAccessibleDocumentScopeIds(
    input: ListAccessibleScopesInput,
  ): Promise<(string | null)[]>;
}
