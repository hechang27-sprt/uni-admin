import type { CollectionRegistry } from "#server/data/collections";
import type {
  ActorContext,
  TenantActorContext,
  TenantContext,
} from "#server/data/documents";
import { inject, injectable } from "inversify";
import { AuthRbacError } from "./errors";
import { hashPassword, verifyPassword } from "./password";
import {
  ADMIN_TENANT_OVERRIDE_KEY,
  type AuthRbacRepository,
} from "./repository";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import type { CatalogService } from "#server/data/catalog";
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
  VerifyPasswordInput,
} from "./types";
import { uniq, flatten, flatMap, isNotNil } from "es-toolkit";
import type { Param0 } from "tsafe";

export const builtInAdminPermissions: Array<
  PermissionDefinitionInput & { key: string }
> = [
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

type ThrowError = {
  throwError: boolean | undefined;
};

@injectable()
export class AuthRbacService {
  constructor(
    @inject(SERVER_DI_TYPES.AuthRbacRepository)
    private readonly repository: AuthRbacRepository,
    @inject(SERVER_DI_TYPES.CatalogService)
    private readonly catalog: CatalogService,
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

  async syncCollectionPermissions(registry: CollectionRegistry) {
    await this.catalog.syncRegistryCollections(registry);
    return this.repository.upsertPermissions(
      registry.derivePermissionDefinitions(),
    );
  }

  async assignPermissionToRole(input: AssignPermissionInput) {
    const role = await this.resolveRole(input);
    await this.evaluateAccess({
      tenantId: input.tenantId,
      permissionKeys: [input.permissionKey],
      throw: true,
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
    const rootScopeId = await this.getTenantRootScopeId(tenantId);

    await this.evaluateAccess({
      tenantId,
      tenantAccess: {
        roleId: [role.roleId],
      },
      checks: [
        {
          userId,
          capabilities: ["admin:role-permissions:grant"],
          targetScopeIds: [rootScopeId],
        },
        {
          userId,
          capabilities: [input.permissionKey],
          override: ADMIN_TENANT_OVERRIDE_KEY,
          targetScopeIds: [rootScopeId],
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
      tenantAccess: {
        userId: [input.userId],
        scopeId: [input.scopeId].filter(isNotNil),
      },
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
        scopeId: [input.scopeId].filter(isNotNil),
      },
      checks: [
        {
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

  async listGrantedScopeIdsForCapability(input: ListAccessibleScopesInput) {
    await this.evaluateAccess({
      ...input.context,
      checks: [],
      permissionKeys: [input.capability],
      throw: true,
    });

    return this.repository.listGrantedScopeIdsForCapability({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: input.capability,
    });
  }
  async listCreatableDocumentScopeIds(input: {
    context: TenantActorContext;
    capability: string;
  }) {
    return this.listGrantedScopeIdsForCapability(input);
  }

  async bootstrapTenantOwner(input: BootstrapTenantOwnerInput): Promise<BootstrapTenantOwnerResult> {
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
    const {
      tenantId,
      actor,
      tenantAccess,
      permissionKeys,
      throw: throwError,
    } = input;
    const checks = input.checks ?? [];

    if (actor) {
      await this.assertTenantMembership({
        tenantId,
        userIds: [actor.userId],
        throwError,
      });
    }

    const capabilities = flatMap(checks, (check) => check.capabilities ?? []);

    const permissionKeysToValidate = uniq(
      flatMap([...capabilities, permissionKeys], (arr) => arr ?? []),
    );

    const scopeIds = tenantAccess?.scopeId ?? [];
    const scopeIdsToValidate = uniq(
      flatten([flatMap(checks, (check) => check.targetScopeIds), scopeIds]),
    ).filter(isNotNil);
    const results = await Promise.allSettled([
      this.assertTenantMembership({
        tenantId,
        userIds: tenantAccess?.userId ?? [],
        throwError,
      }),
      this.assertTenantRoles({
        tenantId,
        roleIds: tenantAccess?.roleId ?? [],
        throwError,
      }),
      this.assertTenantRoleAssignments({
        tenantId,
        assignmentIds: tenantAccess?.assignmentId ?? [],
        throwError,
      }),
      this.assertTenantScopes({
        tenantId,
        scopeIds: scopeIdsToValidate,
        throwError,
      }),
      this.assertTenantDocuments({
        tenantId,
        documentIds: tenantAccess?.documentId ?? [],
        throwError,
      }),
      this.assertValidPermissionKeys({
        permissionKeys: permissionKeysToValidate,
        throwError,
      }),
    ]);

    for (const res of results) {
      if (res.status === "rejected") {
        throw res.reason;
      } else if (!res.value.allowed) {
        return res.value;
      }
    }

    return await this.assertCapabilities({
      tenantId,
      checks,
      userId: actor?.userId,
      throwError,
    });
  }

  private async assertTenantMembership(
    input: Param0<AuthRbacRepository["findInvalidActiveMembershipUserId"]> &
      ThrowError,
  ): Promise<AccessCheckEvaluation> {
    const invalid =
      await this.repository.findInvalidActiveMembershipUserId(input);

    if (invalid) {
      if (input.throwError) {
        throw new AuthRbacError(
          "AUTH_TENANT_MEMBERSHIP_REQUIRED",
          "Tenant membership is required",
          {
            tenantId: input.tenantId,
            userId: invalid,
          },
        );
      }

      return {
        allowed: false,
        failure: { kind: "membership", userId: invalid },
      };
    }

    return { allowed: true, failure: null };
  }

  private async assertTenantRoles(
    input: Param0<AuthRbacRepository["findInvalidRoleId"]> & ThrowError,
  ): Promise<AccessCheckEvaluation> {
    const invalid = await this.repository.findInvalidRoleId(input);

    if (invalid) {
      if (input.throwError) {
        throw new AuthRbacError("AUTH_ROLE_NOT_FOUND", "Role not found", {
          tenantId: input.tenantId,
          roleId: invalid,
        });
      }

      return {
        allowed: false,
        failure: { kind: "role", roleId: invalid },
      };
    }

    return { allowed: true, failure: null };
  }

  private async assertTenantRoleAssignments(
    input: Param0<AuthRbacRepository["findInvalidAssignmentId"]> & ThrowError,
  ): Promise<AccessCheckEvaluation> {
    const invalid = await this.repository.findInvalidAssignmentId(input);

    if (invalid) {
      if (input.throwError) {
        throw permissionDenied(
          { tenantId: input.tenantId },
          "auth:tenant-access",
          null,
        );
      }

      return {
        allowed: false,
        failure: { kind: "assignment", assignmentId: invalid },
      };
    }

    return { allowed: true, failure: null };
  }

  private async assertTenantScopes(
    input: Param0<AuthRbacRepository["findInvalidScopeId"]> & ThrowError,
  ): Promise<AccessCheckEvaluation> {
    const invalid = await this.repository.findInvalidScopeId(input);

    if (invalid) {
      if (input.throwError) {
        throw new AuthRbacError("AUTH_SCOPE_NOT_FOUND", "Scope not found", {
          tenantId: input.tenantId,
          scopeId: invalid,
        });
      }

      return {
        allowed: false,
        failure: { kind: "scope", scopeId: invalid },
      };
    }

    return { allowed: true, failure: null };
  }

  private async assertTenantDocuments(
    input: Param0<AuthRbacRepository["findInvalidDocumentId"]> & ThrowError,
  ): Promise<AccessCheckEvaluation> {
    const invalid = await this.repository.findInvalidDocumentId(input);

    if (invalid) {
      if (input.throwError) {
        throw permissionDenied(
          { tenantId: input.tenantId },
          "auth:tenant-access",
          null,
        );
      }

      return {
        allowed: false,
        failure: { kind: "document", documentId: invalid },
      };
    }

    return { allowed: true, failure: null };
  }

  private async assertValidPermissionKeys(
    input: Param0<AuthRbacRepository["findInvalidPermissionKey"]> & ThrowError,
  ): Promise<AccessCheckEvaluation> {
    const invalid = await this.repository.findInvalidPermissionKey(input);

    if (invalid) {
      if (input.throwError) {
        throw new AuthRbacError(
          "AUTH_PERMISSION_NOT_FOUND",
          "Permission not found",
          {
            permissionKey: invalid,
          },
        );
      }

      return {
        allowed: false,
        failure: { kind: "permission", permissionKey: invalid },
      };
    }

    return { allowed: true, failure: null };
  }

  private async assertCapabilities(
    input: Param0<AuthRbacRepository["checkCapabilities"]> & ThrowError,
  ): Promise<AccessCheckEvaluation> {
    const { tenantId, userId, throwError } = input;
    const accessEvals = await this.repository.checkCapabilities(input);
    const denied = accessEvals.find((check) => !check.allowed);
    const missingCap = denied?.missingCaps[0];

    if (denied && missingCap) {
      const capability = missingCap?.capability ?? "auth:access";
      const targetScopeId = missingCap.targetScopeId;
      if (throwError) {
        throw permissionDenied(
          { tenantId, actor: userId ? { userId } : undefined },
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
