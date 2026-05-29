import {
  deriveCollectionPermissionDefinitions,
  type CollectionRegistry,
  type TenantActorContext,
} from "#server/data/documents";
import { injectable } from "inversify";
import { pivotToColumns } from "../util/db";
import { AuthRbacError } from "./errors";
import { hashPassword, verifyPassword } from "./password";
import type { AuthRbacRepository } from "./repository";
import type {
  AccessCheckEvaluation,
  AccessCheckFailure,
  AssignRoleInput,
  BootstrapTenantOwnerInput,
  BootstrapTenantOwnerResult,
  CheckAccessInput,
  CheckAccessManyInput,
  CreateRoleInput,
  CreateScopeInput,
  CreateTenantMembershipInput,
  CreateUserInput,
  GrantPermissionInput,
  ListAccessibleScopesInput,
  Permission,
  PermissionDefinitionInput,
  Role,
  SetPasswordCredentialInput,
  TenantMembership,
  ValidateTenantAccessInput,
  ValidateTenantAccessResult,
  VerifyPasswordInput,
} from "./types";
import { union } from "es-toolkit/array";

export const builtInAdminPermissions: PermissionDefinitionInput[] = [
  { key: "admin:tenant:owner", source: "admin" },
  { key: "admin:users:create", source: "admin" },
  { key: "admin:users:update", source: "admin" },
  { key: "admin:users:disable", source: "admin" },
  { key: "admin:credentials:set-password", source: "admin" },
  { key: "admin:memberships:add", source: "admin" },
  { key: "admin:memberships:remove", source: "admin" },
  { key: "admin:roles:create", source: "admin" },
  { key: "admin:roles:update", source: "admin" },
  { key: "admin:roles:delete", source: "admin" },
  { key: "admin:role-permissions:grant", source: "admin" },
  { key: "admin:role-permissions:revoke", source: "admin" },
  { key: "admin:role-assignments:assign", source: "admin" },
  { key: "admin:role-assignments:revoke", source: "admin" },
  { key: "admin:scopes:create", source: "admin" },
  { key: "admin:scopes:update", source: "admin" },
  { key: "admin:scopes:delete", source: "admin" },
  { key: "admin:documents:set-scope", source: "admin" },
  { key: "admin:tenant:update", source: "admin" },
  { key: "admin:tenant:delete", source: "admin" },
];

@injectable()
export class AuthRbacService {
  constructor(private readonly repository: AuthRbacRepository) {}

  createUser(input: CreateUserInput = {}) {
    return this.repository.createUser(input);
  }

  async setUsernamePasswordCredential(input: SetPasswordCredentialInput) {
    return this.repository.setPasswordCredential({
      userId: input.userId,
      username: normalizeUsername(input.username),
      passwordHash: await hashPassword(input.password),
    });
  }

  async verifyUsernamePassword(input: VerifyPasswordInput) {
    const credential = await this.repository.findCredentialByUsername(
      normalizeUsername(input.username),
    );
    if (!credential) {
      return null;
    }

    const valid = await verifyPassword(input.password, credential.passwordHash);
    if (!valid) {
      return null;
    }

    const user = await this.repository.getUser(credential.userId);
    return user?.status === "active" ? user : null;
  }

  createTenantMembership(
    input: CreateTenantMembershipInput,
  ): Promise<TenantMembership> {
    return this.repository.createTenantMembership(input);
  }

  async resolveActor(input: {
    tenantId: string;
    userId: string;
  }): Promise<TenantActorContext> {
    const context = {
      tenantId: input.tenantId,
      actor: { userId: input.userId },
    };
    const access = await this.evaluateAccess({ ...context, checks: [] });
    throwAccessValidationFailure(context, access.failure);

    return {
      tenantId: input.tenantId,
      actor: {
        userId: input.userId,
      },
    };
  }

  ensureTenantRootScope(tenantId: string) {
    return this.repository.ensureTenantRootScope(tenantId);
  }

  async getTenantRootScopeId(tenantId: string) {
    const scope = await this.repository.ensureTenantRootScope(tenantId);
    return scope.scopeId;
  }

  createScope(input: CreateScopeInput) {
    return this.repository.createScope(input);
  }

  async createScopeAsActor(
    context: TenantActorContext,
    input: Omit<CreateScopeInput, "tenantId">,
  ) {
    await this.assertAdminAccess({
      context,
      capability: "admin:scopes:create",
      targetScopeId: input.parentScopeId,
    });

    return this.repository.createScope({
      ...input,
      tenantId: context.tenantId,
    });
  }

  createRole(input: CreateRoleInput) {
    return this.repository.createRole(input);
  }

  syncPermissions(input: PermissionDefinitionInput[]) {
    return this.repository.upsertPermissions(input);
  }

  syncBuiltInAdminPermissions(): Promise<Permission[]> {
    return this.repository.upsertPermissions(builtInAdminPermissions);
  }

  syncCollectionPermissions(registry: CollectionRegistry) {
    return this.repository.upsertPermissions(
      deriveCollectionPermissionDefinitions(registry),
    );
  }

  async grantPermission(input: GrantPermissionInput) {
    const role = await this.resolveRole(input);
    await this.validatePermissionGrant({
      tenantId: input.tenantId,
      permissionKeys: [input.permissionKey],
    });
    await this.repository.grantPermissions({
      tenantId: input.tenantId,
      roleId: role.roleId,
      permissionKeys: [input.permissionKey],
    });
  }

  async grantPermissionAsActor(
    context: TenantActorContext,
    input: Omit<GrantPermissionInput, "tenantId">,
  ) {
    const role = await this.resolveRole({
      ...input,
      tenantId: context.tenantId,
    });
    const access = await this.evaluateAccess({
      ...context,
      tenantAccess: {
        roleId: [role.roleId],
      },
      checks: [
        { capability: "admin:tenant:owner", targetScopeId: null },
        { capability: "admin:role-permissions:grant", targetScopeId: null },
        { capability: input.permissionKey, targetScopeId: null },
      ],
    });
    throwAccessValidationFailure(context, access.failure);

    const [isOwner, canGrantRolePermissions, hasGrantedCapability] =
      access.capabilities ?? [];
    if (!isOwner && !canGrantRolePermissions) {
      throw permissionDenied(context, "admin:role-permissions:grant", null);
    }
    if (!isOwner && !hasGrantedCapability) {
      throw permissionDenied(context, input.permissionKey, null);
    }

    await this.repository.grantPermissions({
      tenantId: context.tenantId,
      roleId: role.roleId,
      permissionKeys: [input.permissionKey],
    });
  }

  async assignRole(input: AssignRoleInput) {
    const role = await this.resolveRole(input);
    await this.validateRoleAssignment({
      tenantId: input.tenantId,
      userIds: [input.userId],
      scopeIds: [input.scopeId],
    });
    await this.repository.assignRoles({
      tenantId: input.tenantId,
      assignments: [
        {
          userId: input.userId,
          roleId: role.roleId,
          scopeId: input.scopeId,
        },
      ],
    });
  }

  async assignRoleAsActor(
    context: TenantActorContext,
    input: Omit<AssignRoleInput, "tenantId">,
  ) {
    const role = await this.resolveRole({
      ...input,
      tenantId: context.tenantId,
    });
    const access = await this.evaluateAccess({
      ...context,
      tenantAccess: {
        userId: [input.userId],
        roleId: [role.roleId],
        scopeId: [input.scopeId],
      },
      checks: [
        { capability: "admin:tenant:owner", targetScopeId: null },
        {
          capability: "admin:role-assignments:assign",
          targetScopeId: input.scopeId,
        },
      ],
    });
    throwAccessValidationFailure(context, access.failure);

    const [isOwner, canAssignRoles] = access.capabilities ?? [];
    if (!isOwner && !canAssignRoles) {
      throw permissionDenied(
        context,
        "admin:role-assignments:assign",
        input.scopeId,
      );
    }
    if (!isOwner) {
      const deniedCapability = await this.repository.findDeniedRolePermission({
        tenantId: context.tenantId,
        roleId: role.roleId,
        userId: context.actor.userId,
        targetScopeId: input.scopeId,
      });
      if (deniedCapability) {
        throw permissionDenied(context, deniedCapability, input.scopeId);
      }
    }

    await this.repository.assignRoles({
      tenantId: context.tenantId,
      assignments: [
        {
          userId: input.userId,
          roleId: role.roleId,
          scopeId: input.scopeId,
        },
      ],
    });
  }

  async assertAccess(input: CheckAccessInput) {
    const access = await this.evaluateAccess({
      ...input.context,
      checks: [
        {
          capability: input.capability,
          targetScopeId: input.targetScopeId,
        },
      ],
    });
    throwAccessValidationFailure(input.context, access.failure);
    const [allowed] = access.capabilities ?? [];
    if (!allowed) {
      throw permissionDenied(
        input.context,
        input.capability,
        input.targetScopeId,
      );
    }
  }

  async listAccessibleScopeIds(input: ListAccessibleScopesInput) {
    await this.validateListAccess(input);
    return this.repository.listAccessibleScopeIds({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: input.capability,
    });
  }

  async listAccessibleDocumentScopeIds(input: ListAccessibleScopesInput) {
    await this.validateListAccess(input);
    return this.repository.listAccessibleDocumentScopeIds({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: input.capability,
    });
  }

  async listCreatableDocumentScopeIds(input: {
    context: TenantActorContext;
    capability: string;
  }) {
    await this.validateListAccess(input);
    return this.repository.listAccessibleDocumentScopeIds({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: input.capability,
    });
  }

  async validateTenantAccess(
    input: ValidateTenantAccessInput,
  ): Promise<ValidateTenantAccessResult> {
    return {
      invalidScopeId: await this.repository.findInvalidScopeId({
        tenantId: input.tenantId,
        scopeIds: input.scopeIds ?? [],
      }),
    };
  }

  async bootstrapTenantOwner(
    input: BootstrapTenantOwnerInput,
  ): Promise<BootstrapTenantOwnerResult> {
    const [user, rootScope, ownerRole] = await Promise.all([
      this.repository.createUser({ displayName: input.displayName }),
      this.repository.ensureTenantRootScope(input.tenantId),
      this.repository.createRole({
        tenantId: input.tenantId,
        key: input.ownerRoleKey ?? "owner",
        name: "Owner",
      }),
    ]);
    await this.repository.createTenantMembership({
      tenantId: input.tenantId,
      userId: user.userId,
    });
    await this.repository.setPasswordCredential({
      userId: user.userId,
      username: normalizeUsername(input.username),
      passwordHash: await hashPassword(input.password),
    });
    await this.repository.upsertPermissions(builtInAdminPermissions);
    await this.repository.grantPermissions({
      tenantId: input.tenantId,
      roleId: ownerRole.roleId,
      permissionKeys: builtInAdminPermissions.map(
        (permission) => permission.key,
      ),
    });
    await this.repository.assignRoles({
      tenantId: input.tenantId,
      assignments: [
        {
          userId: user.userId,
          roleId: ownerRole.roleId,
          scopeId: rootScope.scopeId,
        },
      ],
    });

    return {
      user,
      rootScope,
      ownerRole,
      context: {
        tenantId: input.tenantId,
        actor: {
          userId: user.userId,
        },
      },
    };
  }

  async evaluateAccess(
    input: CheckAccessManyInput,
  ): Promise<AccessCheckEvaluation> {
    const { tenantId, actor, checks, tenantAccess, permissionKeys } = input;

    if (actor) {
      const membership = await this.repository.findActiveTenantMembership({
        tenantId: tenantId,
        userId: actor?.userId,
      });
      if (!membership) {
        return {
          allowed: false,
          failure: { kind: "membership", userId: actor.userId },
        };
      }
    }

    const { capability, targetScopeId } = pivotToColumns(checks ?? []);

    const [
      invalidUserId,
      invalidRoleId,
      invalidAssignmentId,
      invalidScopeId,
      invalidDocumentId,
      invalidPermissionKey,
    ] = await Promise.all([
      this.repository.findInvalidActiveMembershipUserId({
        tenantId,
        userIds: tenantAccess?.userId ?? [],
      }),
      this.repository.findInvalidRoleId({
        tenantId,
        roleIds: tenantAccess?.roleId ?? [],
      }),
      this.repository.findInvalidAssignmentId({
        tenantId,
        assignmentIds: tenantAccess?.assignmentId ?? [],
      }),
      this.repository.findInvalidScopeId({
        tenantId,
        scopeIds: union(
          tenantAccess?.scopeId ?? [],
          targetScopeId.filter((id) => id != null),
        ),
      }),
      this.repository.findInvalidDocumentId({
        tenantId,
        documentIds: tenantAccess?.documentId ?? [],
      }),
      this.repository.findInvalidPermissionKey({
        permissionKeys: union(capability, permissionKeys ?? []),
      }),
    ]);

    if (invalidUserId) {
      return {
        allowed: false,
        failure: { kind: "membership", userId: invalidUserId },
      };
    }
    if (invalidRoleId) {
      return {
        allowed: false,
        failure: { kind: "role", roleId: invalidRoleId },
      };
    }
    if (invalidAssignmentId) {
      return {
        allowed: false,
        failure: { kind: "assignment", assignmentId: invalidAssignmentId },
      };
    }
    if (invalidScopeId) {
      return {
        allowed: false,
        failure: { kind: "scope", scopeId: invalidScopeId },
      };
    }
    if (invalidDocumentId) {
      return {
        allowed: false,
        failure: { kind: "document", documentId: invalidDocumentId },
      };
    }
    if (invalidPermissionKey) {
      return {
        allowed: false,
        failure: { kind: "permission", permissionKey: invalidPermissionKey },
      };
    }

    if (actor && checks) {
      const caps = await this.repository.checkCapabilities({
        tenantId,
        userId: actor.userId,
        checks,
      });
      const deniedIndex = caps.findIndex((value) => !value);
      if (deniedIndex !== -1) {
        const denied = checks[deniedIndex]!;
        return {
          allowed: false,
          failure: {
            kind: "capability",
            capability: denied.capability,
            targetScopeId: denied.targetScopeId,
          },
          capabilities: caps,
        };
      }
    }

    return { allowed: true, failure: null };
  }

  private async validateListAccess(
    input: ListAccessibleScopesInput,
  ): Promise<void> {
    const access = await this.evaluateAccess({
      ...input.context,
      checks: [],
      permissionKeys: [input.capability],
    });
    throwAccessValidationFailure(input.context, access.failure);
  }

  private async validatePermissionGrant(input: {
    tenantId: string;
    permissionKeys: string[];
  }): Promise<void> {
    const invalidPermissionKey = await this.repository.findInvalidPermissionKey(
      {
        permissionKeys: input.permissionKeys,
      },
    );
    if (invalidPermissionKey) {
      throw new AuthRbacError(
        "AUTH_PERMISSION_NOT_FOUND",
        "Permission not found",
        {
          tenantId: input.tenantId,
          permissionKey: invalidPermissionKey,
        },
      );
    }
  }

  private async validateRoleAssignment(input: {
    tenantId: string;
    userIds: string[];
    scopeIds: string[];
  }): Promise<void> {
    const [invalidUserId, invalidScopeId] = await Promise.all([
      this.repository.findInvalidActiveMembershipUserId({
        tenantId: input.tenantId,
        userIds: input.userIds,
      }),
      this.repository.findInvalidScopeId({
        tenantId: input.tenantId,
        scopeIds: input.scopeIds,
      }),
    ]);

    if (invalidUserId) {
      throw new AuthRbacError(
        "AUTH_TENANT_MEMBERSHIP_REQUIRED",
        "Tenant membership is required",
        {
          tenantId: input.tenantId,
          userId: invalidUserId,
        },
      );
    }
    if (invalidScopeId) {
      throw new AuthRbacError("AUTH_SCOPE_NOT_FOUND", "Scope not found", {
        tenantId: input.tenantId,
        scopeId: invalidScopeId,
      });
    }
  }

  private async assertAdminAccess(input: CheckAccessInput): Promise<void> {
    const access = await this.evaluateAccess({
      ...input.context,
      checks: [
        { capability: "admin:tenant:owner", targetScopeId: null },
        {
          capability: input.capability,
          targetScopeId: input.targetScopeId,
        },
      ],
    });
    throwAccessValidationFailure(input.context, access.failure);
    const [owner, allowed] = access.capabilities ?? [];
    if (!owner && !allowed) {
      throw permissionDenied(
        input.context,
        input.capability,
        input.targetScopeId,
      );
    }
  }

  private async resolveRole(
    input: GrantPermissionInput | AssignRoleInput,
  ): Promise<Role> {
    let role: Role | null = null;

    if (input.roleId) {
      role = await this.repository.getRoleById({
        tenantId: input.tenantId,
        roleId: input.roleId,
      });
    } else if (input.roleKey) {
      role = await this.repository.getRoleByKey({
        tenantId: input.tenantId,
        key: input.roleKey,
      });
    }

    if (!role) {
      throw new AuthRbacError("AUTH_ROLE_NOT_FOUND", "Role not found", input);
    }

    return role;
  }
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function permissionDenied(
  context: CheckAccessInput["context"],
  capability: string,
  targetScopeId: string | null,
): AuthRbacError {
  return new AuthRbacError("AUTH_PERMISSION_DENIED", "Permission denied", {
    tenantId: context.tenantId,
    userId: context.actor.userId,
    capability,
    scopeId: targetScopeId,
  });
}

function throwAccessValidationFailure(
  context: CheckAccessInput["context"],
  failure: AccessCheckFailure | null,
): void {
  switch (failure?.kind) {
    case undefined:
    case "capability": {
      return;
    }
    case "membership": {
      throw new AuthRbacError(
        "AUTH_TENANT_MEMBERSHIP_REQUIRED",
        "Tenant membership is required",
        {
          tenantId: context.tenantId,
          userId: failure.userId,
        },
      );
    }
    case "role": {
      throw new AuthRbacError("AUTH_ROLE_NOT_FOUND", "Role not found", {
        tenantId: context.tenantId,
        roleId: failure.roleId,
      });
    }
    case "scope": {
      throw new AuthRbacError("AUTH_SCOPE_NOT_FOUND", "Scope not found", {
        tenantId: context.tenantId,
        scopeId: failure.scopeId,
      });
    }
    case "permission": {
      throw new AuthRbacError(
        "AUTH_PERMISSION_NOT_FOUND",
        "Permission not found",
        {
          tenantId: context.tenantId,
          permissionKey: failure.permissionKey,
        },
      );
    }
    case "assignment":
    case "document": {
      throw permissionDenied(context, "auth:tenant-access", null);
    }
  }
}
