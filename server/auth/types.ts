import type {
  ActorContext,
  TenantActorContext,
  TenantContext,
} from "#server/data/documents";

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

export type CapabilityAccessCheck = {
  capabilities?: string[];
  roleIds?: string[];
  override?: string;
  userId?: string;
  targetScopeId: string | null;
};

export type CapabilityEvaluation = {
  userId: string;
  targetScopeId: string;
  capabilities: string[];
  allowed: boolean;
  hasCaps: boolean[];
  hasOverride: boolean;
};

export interface CheckAccessManyInput
  extends TenantContext, Partial<ActorContext> {
  checks?: CapabilityAccessCheck[];
  tenantAccess?: {
    userId?: string[];
    roleId?: string[];
    assignmentId?: string[];
    scopeId?: string[];
    documentId?: string[];
  };
  permissionKeys?: string[];

  throw?: boolean;
}

export interface ListAccessibleScopesInput {
  context: TenantActorContext;
  capability: string;
}

export interface ValidateTenantAccessInput {
  tenantId: string;
  scopeIds?: string[];
}

export interface ValidateTenantAccessResult {
  invalidScopeId: string | null;
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

export type AccessCheckFailure =
  | { kind: "membership"; userId: string }
  | { kind: "role"; roleId: string }
  | { kind: "assignment"; assignmentId: string }
  | { kind: "scope"; scopeId: string }
  | { kind: "document"; documentId: string }
  | { kind: "permission"; permissionKey: string }
  | {
      kind: "capability";
      capability: string;
      targetScopeId: string | null;
    };

export interface AccessCheckEvaluation {
  allowed: boolean;
  failure: AccessCheckFailure | null;
  capabilities?: CapabilityEvaluation[];
}
