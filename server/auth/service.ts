import {
  deriveCollectionPermissionDefinitions,
  type CollectionRegistry,
  type TenantActorContext,
} from "#server/data/documents";
import { AuthRbacError } from "./errors";
import { hashPassword, verifyPassword } from "./password";
import type { AuthRbacRepository } from "./repository";
import type {
  AssignRoleInput,
  BootstrapTenantOwnerInput,
  BootstrapTenantOwnerResult,
  CheckAccessInput,
  CheckAccessManyInput,
  CreateRoleInput,
  CreateScopeInput,
  CreateTenantMembershipInput,
  CreateUserInput,
  DocumentAuthorizer,
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

export interface AuthRbacServiceConfig {
  repository: AuthRbacRepository;
}

type AccessCheckFailure =
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

interface AccessCheckEvaluation {
  allowed: boolean[];
  failure: AccessCheckFailure | null;
}

export class AuthRbacService implements DocumentAuthorizer {
  private readonly repository: AuthRbacRepository;

  constructor(options: AuthRbacServiceConfig) {
    this.repository = options.repository;
  }

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
    const context = { tenantId: input.tenantId, actor: { userId: input.userId } };
    const access = await this.evaluateAccess({ context, checks: [] });
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
      context,
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
      access.allowed;
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
      context,
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

    const [isOwner, canAssignRoles] = access.allowed;
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

  async checkAccess(input: CheckAccessInput) {
    const [allowed] = await this.checkAccessMany({
      context: input.context,
      checks: [
        {
          capability: input.capability,
          targetScopeId: input.targetScopeId,
        },
      ],
    });
    return allowed ?? false;
  }

  async checkAccessMany(input: CheckAccessManyInput) {
    const access = await this.evaluateAccess(input);
    return access.allowed;
  }

  async assertAccess(input: CheckAccessInput) {
    const access = await this.evaluateAccess({
      context: input.context,
      checks: [
        {
          capability: input.capability,
          targetScopeId: input.targetScopeId,
        },
      ],
    });
    throwAccessValidationFailure(input.context, access.failure);
    const [allowed] = access.allowed;
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

  private async evaluateAccess(
    input: CheckAccessManyInput,
  ): Promise<AccessCheckEvaluation> {
    const membership = await this.repository.findActiveTenantMembership({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
    });
    if (!membership) {
      return {
        allowed: input.checks.map(() => false),
        failure: { kind: "membership", userId: input.context.actor.userId },
      };
    }

    const targetScopeIds = input.checks.flatMap((check) =>
      check.targetScopeId === null ? [] : [check.targetScopeId],
    );
    const [
      invalidUserId,
      invalidRoleId,
      invalidAssignmentId,
      invalidScopeId,
      invalidDocumentId,
      invalidPermissionKey,
    ] = await Promise.all([
      this.repository.findInvalidActiveMembershipUserId({
        tenantId: input.context.tenantId,
        userIds: input.tenantAccess?.userId ?? [],
      }),
      this.repository.findInvalidRoleId({
        tenantId: input.context.tenantId,
        roleIds: input.tenantAccess?.roleId ?? [],
      }),
      this.repository.findInvalidAssignmentId({
        tenantId: input.context.tenantId,
        assignmentIds: input.tenantAccess?.assignmentId ?? [],
      }),
      this.repository.findInvalidScopeId({
        tenantId: input.context.tenantId,
        scopeIds: [...(input.tenantAccess?.scopeId ?? []), ...targetScopeIds],
      }),
      this.repository.findInvalidDocumentId({
        tenantId: input.context.tenantId,
        documentIds: input.tenantAccess?.documentId ?? [],
      }),
      this.repository.findInvalidPermissionKey({
        permissionKeys: [
          ...input.checks.map((check) => check.capability),
          ...(input.permissionKeys ?? []),
        ],
      }),
    ]);

    if (invalidUserId) {
      return {
        allowed: input.checks.map(() => false),
        failure: { kind: "membership", userId: invalidUserId },
      };
    }
    if (invalidRoleId) {
      return {
        allowed: input.checks.map(() => false),
        failure: { kind: "role", roleId: invalidRoleId },
      };
    }
    if (invalidAssignmentId) {
      return {
        allowed: input.checks.map(() => false),
        failure: { kind: "assignment", assignmentId: invalidAssignmentId },
      };
    }
    if (invalidScopeId) {
      return {
        allowed: input.checks.map(() => false),
        failure: { kind: "scope", scopeId: invalidScopeId },
      };
    }
    if (invalidDocumentId) {
      return {
        allowed: input.checks.map(() => false),
        failure: { kind: "document", documentId: invalidDocumentId },
      };
    }
    if (invalidPermissionKey) {
      return {
        allowed: input.checks.map(() => false),
        failure: { kind: "permission", permissionKey: invalidPermissionKey },
      };
    }

    const allowed = await this.repository.checkCapabilities({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      checks: input.checks,
    });
    const deniedIndex = allowed.findIndex((value) => !value);
    if (deniedIndex !== -1) {
      const denied = input.checks[deniedIndex]!;
      return {
        allowed,
        failure: {
          kind: "capability",
          capability: denied.capability,
          targetScopeId: denied.targetScopeId,
        },
      };
    }

    return { allowed, failure: null };
  }

  private async validateListAccess(
    input: ListAccessibleScopesInput,
  ): Promise<void> {
    const access = await this.evaluateAccess({
      context: input.context,
      checks: [],
      permissionKeys: [input.capability],
    });
    throwAccessValidationFailure(input.context, access.failure);
  }

  private async validatePermissionGrant(input: {
    tenantId: string;
    permissionKeys: string[];
  }): Promise<void> {
    const invalidPermissionKey =
      await this.repository.findInvalidPermissionKey({
        permissionKeys: input.permissionKeys,
      });
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
      context: input.context,
      checks: [
        { capability: "admin:tenant:owner", targetScopeId: null },
        {
          capability: input.capability,
          targetScopeId: input.targetScopeId,
        },
      ],
    });
    throwAccessValidationFailure(input.context, access.failure);
    const [owner, allowed] = access.allowed;
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
