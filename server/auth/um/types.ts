import { z } from "zod";

import type {
  ActorContext,
  TenantActorContext,
  TenantContext,
} from "#server/data/documents";

export const SYSTEM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
export const BOTTOM_SCOPE_ID = SYSTEM_TENANT_ID;

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

export type ResourceScopeMode = "document" | "tenant-root" | "none";

export interface Permission {
  key: string;
  appId: string | null;
  collectionId: string | null;
  capabilityId: string;
  source: string;
  description: string | null;
  resourceScope?: ResourceScopeMode | null;
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

export const resourceScopeModeSchema = z.enum([
  "document",
  "tenant-root",
  "none",
]);

export const permissionDefinitionInputSchema = z.object({
  key: z.string().optional(),
  appKey: z.string().nullable().optional(),
  collectionKey: z.string().nullable().optional(),
  capabilityId: z.string().optional(),
  source: z.string(),
  description: z.string().nullable().optional(),
  resourceScope: resourceScopeModeSchema.nullable().optional(),
});

export const resolvedPermissionDefinitionSchema =
  permissionDefinitionInputSchema
    .omit({ appKey: true, collectionKey: true })
    .required({ key: true, capabilityId: true, source: true })
    .extend({
      appId: z.string().nullable(),
      collectionId: z.string().nullable(),
    });

export type PermissionDefinitionInput = z.infer<
  typeof permissionDefinitionInputSchema
>;

export type ResolvedPermissionDefinition = z.infer<
  typeof resolvedPermissionDefinitionSchema
>;

export interface GrantPermissionInput {
  tenantId: string;
  roleId?: string;
  roleKey?: string;
  permissionKeys: string[];
}

export interface AssignRoleInput {
  tenantId: string;
  userId: string;
  roleId?: string;
  roleKey?: string;
  // Use the physical bottom-scope sentinel for `resourceScope: "none"` grants.
  scopeId: string;
}

export interface CheckAccessInput {
  context: TenantActorContext;
  targetScopeId: string;
}

export interface CapabilityAccessCheck {
  capabilities?: string[];
  roleIds?: string[];
  override?: string;
  userId?: string;
  targetScopeIds: string[];
}

export type CapabilityEvaluation = {
  userId: string;
  allowed: boolean;
  hasOverride: boolean;
  missingCaps: {
    capability: string;
    permissionKey: string | null;
    roleId?: string;
    targetScopeId: string;
  }[];
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
      targetScopeId: string;
    };

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

export interface AccessCheckEvaluation {
  allowed: boolean;
  failure: AccessCheckFailure | null;
  capabilities?: CapabilityEvaluation[];
}

export interface GrantedScopes {
  scopeId: string;
  roleId: string;
}
