import {
  deriveCollectionPermissionDefinitions,
  type ActorContext,
  type CollectionRegistry,
  type TenantContext,
  type TenantActorContext,
} from "#server/data/documents";
import { inject, injectable } from "inversify";
import { AuthRbacError } from "./errors";
import { hashPassword, verifyPassword } from "./password";
import {
  ADMIN_TENANT_OVERRIDE_KEY,
  type AuthRbacRepository,
} from "./repository";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import type {
  AccessCheckEvaluation,
  AssignRoleInput,
  BootstrapTenantOwnerInput,
  BootstrapTenantOwnerResult,
  CheckAccessManyInput,
  CreateRoleInput,
  CreateScopeInput,
  CreateTenantMembershipInput,
  CreateUserInput,
  GrantPermissionInput as AssignPermissionInput,
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
  { key: ADMIN_TENANT_OVERRIDE_KEY, source: "admin" },
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
  constructor(
    @inject(SERVER_DI_TYPES.AuthRbacRepository)
    private readonly repository: AuthRbacRepository,
  ) {}

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
    await this.evaluateAccess({
      ...context,
      checks: [],
      throw: true,
    });

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
    await this.evaluateAccess({
      ...context,
      checks: [
        {
          userId: context.actor.userId,
          targetScopeIds: [input.parentScopeId],
          capabilities: ["admin:scopes:create"],
        },
      ],
      throw: true,
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

  async assignPermissionToRole(input: AssignPermissionInput) {
    const role = await this.resolveRole(input);
    await this.evaluateAccess({
      tenantId: input.tenantId,
      permissionKeys: [input.permissionKey],
    });

    await this.repository.assignPermissionsToRole({
      tenantId: input.tenantId,
      roleId: role.roleId,
      permissionKeys: [input.permissionKey],
    });
  }

  async assignPermissionToRoleAsActor(
    { tenantId, actor: { userId } }: TenantActorContext,
    input: Omit<AssignPermissionInput, "tenantId">,
  ) {
    const role = await this.resolveRole({
      ...input,
      tenantId,
    });
    await this.evaluateAccess({
      tenantId,
      tenantAccess: {
        roleId: [role.roleId],
      },
      checks: [
        {
          userId,
          capabilities: ["admin:role-permissions:grant"],
          targetScopeIds: [null],
        },
        {
          userId,
          capabilities: [input.permissionKey],
          override: "admin:tenant:owner",
          targetScopeIds: [null], // Must own permission at ROOT to assign to role, to be relaxed
        },
      ],
      throw: true,
    });

    await this.repository.assignPermissionsToRole({
      tenantId,
      roleId: role.roleId,
      permissionKeys: [input.permissionKey],
    });
  }

  async assignRole(input: AssignRoleInput) {
    const role = await this.resolveRole(input);
    await this.evaluateAccess({
      tenantId: input.tenantId,
      tenantAccess: { userId: [input.userId], scopeId: [input.scopeId] },
      throw: true,
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
    const { tenantId, actor } = context;

    const role = await this.resolveRole({
      ...input,
      tenantId: context.tenantId,
    });

    await this.evaluateAccess({
      tenantId,
      actor,
      tenantAccess: {
        userId: [input.userId],
        roleId: [role.roleId],
        scopeId: [input.scopeId],
      },
      checks: [
        {
          userId: actor.userId,
          capabilities: ["admin:role-assignments:assign"],
          roleIds: [role.roleId],
          override: ADMIN_TENANT_OVERRIDE_KEY,
          targetScopeIds: [input.scopeId],
        },
      ],
      throw: true,
    });

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

  async listAccessibleScopeIds(input: ListAccessibleScopesInput) {
    await this.evaluateAccess({
      ...input.context,
      checks: [],
      permissionKeys: [input.capability],
      throw: true,
    });

    return this.repository.listAccessibleScopeIds({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: input.capability,
    });
  }

  async listAccessibleDocumentScopeIds(input: ListAccessibleScopesInput) {
    const [scopeIds, tenantRootScope] = await Promise.all([
      this.listAccessibleScopeIds(input),
      this.repository.ensureTenantRootScope(input.context.tenantId),
    ]);

    return scopeIds.map((scopeId) =>
      scopeId === tenantRootScope.scopeId ? null : scopeId,
    );
  }

  async listCreatableDocumentScopeIds(input: {
    context: TenantActorContext;
    capability: string;
  }) {
    return this.listAccessibleDocumentScopeIds(input);
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
    await this.repository.assignPermissionsToRole({
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
    const accessChecks = (checks ?? []).map((check) => ({
      ...check,
      userId: check.userId ?? actor?.userId,
    }));

    if (actor) {
      const membership = await this.repository.findActiveTenantMembership({
        tenantId: tenantId,
        userId: actor?.userId,
      });
      if (!membership) {
        if (input.throw) {
          throw new AuthRbacError(
            "AUTH_TENANT_MEMBERSHIP_REQUIRED",
            "Tenant membership is required",
            {
              tenantId,
              userId: actor.userId,
            },
          );
        }

        return {
          allowed: false,
          failure: { kind: "membership", userId: actor.userId },
        };
      }
    }

    const columns = pivotToColumns(accessChecks);
    const capabilities = columns.capabilities ?? [];
    const targetScopeIds = columns.targetScopeIds ?? [];
    const permissionKeysToValidate = [
      ...new Set([
        ...capabilities.flatMap((arr) => arr ?? []),
        ...(permissionKeys ?? []),
      ]),
    ];

    const scopeIds = tenantAccess?.scopeId ?? [];
    const scopeIdsToValidate = new Set([...targetScopeIds.flat(), ...scopeIds]);
    scopeIdsToValidate.delete(null);

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
        scopeIds: scopeIdsToValidate.values().toArray() as string[],
      }),
      this.repository.findInvalidDocumentId({
        tenantId,
        documentIds: tenantAccess?.documentId ?? [],
      }),
      this.repository.findInvalidPermissionKey({
        permissionKeys: permissionKeysToValidate,
      }),
    ]);

    if (invalidUserId) {
      if (input.throw) {
        throw new AuthRbacError(
          "AUTH_TENANT_MEMBERSHIP_REQUIRED",
          "Tenant membership is required",
          {
            tenantId,
            userId: invalidUserId,
          },
        );
      }

      return {
        allowed: false,
        failure: { kind: "membership", userId: invalidUserId },
      };
    }

    if (invalidRoleId) {
      if (input.throw) {
        throw new AuthRbacError("AUTH_ROLE_NOT_FOUND", "Role not found", {
          tenantId,
          roleId: invalidRoleId,
        });
      }

      return {
        allowed: false,
        failure: { kind: "role", roleId: invalidRoleId },
      };
    }

    if (invalidAssignmentId) {
      if (input.throw) {
        throw permissionDenied({ tenantId, actor }, "auth:tenant-access", null);
      }

      return {
        allowed: false,
        failure: { kind: "assignment", assignmentId: invalidAssignmentId },
      };
    }

    if (invalidScopeId) {
      if (input.throw) {
        throw new AuthRbacError("AUTH_SCOPE_NOT_FOUND", "Scope not found", {
          tenantId,
          scopeId: invalidScopeId,
        });
      }

      return {
        allowed: false,
        failure: { kind: "scope", scopeId: invalidScopeId },
      };
    }

    if (invalidDocumentId) {
      if (input.throw) {
        throw permissionDenied({ tenantId, actor }, "auth:tenant-access", null);
      }

      return {
        allowed: false,
        failure: { kind: "document", documentId: invalidDocumentId },
      };
    }

    if (invalidPermissionKey) {
      if (input.throw) {
        throw new AuthRbacError(
          "AUTH_PERMISSION_NOT_FOUND",
          "Permission not found",
          {
            tenantId,
            permissionKey: invalidPermissionKey,
          },
        );
      }

      return {
        allowed: false,
        failure: { kind: "permission", permissionKey: invalidPermissionKey },
      };
    }

    if (actor && accessChecks.length > 0) {
      const accessEvals = await this.repository.checkCapabilities({
        tenantId,
        checks: accessChecks,
      });
      const denied = accessEvals.find((check) => !check.allowed);
      if (denied) {
        const missingCap = denied.missingCaps[0];
        const capability = missingCap?.capability ?? "auth:access";
        const targetScopeId = missingCap
          ? missingCap.isRootScope
            ? null
            : missingCap.targetScopeId
          : null;
        if (input.throw) {
          throw permissionDenied(
            { tenantId, actor },
            capability,
            targetScopeId,
          );
        }

        return {
          allowed: false,
          failure: {
            kind: "capability",
            capability,
            targetScopeId,
          },
          capabilities: accessEvals,
        };
      }

      return { allowed: true, failure: null, capabilities: accessEvals };
    }

    return { allowed: true, failure: null };
  }

  private async resolveRole(
    input: AssignPermissionInput | AssignRoleInput,
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
  context: TenantContext & Partial<ActorContext>,
  capability: string,
  targetScopeId: string | null,
): AuthRbacError {
  return new AuthRbacError("AUTH_PERMISSION_DENIED", "Permission denied", {
    tenantId: context.tenantId,
    userId: context.actor?.userId,
    capability,
    scopeId: targetScopeId,
  });
}
