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
    const membership = await this.repository.findTenantMembership(input);
    if (!membership || membership.status !== "active") {
      throw new AuthRbacError(
        "AUTH_TENANT_MEMBERSHIP_REQUIRED",
        "Tenant membership is required",
        input,
      );
    }

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
    return (await this.repository.ensureTenantRootScope(tenantId)).scopeId;
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
    await this.repository.grantPermission({
      tenantId: input.tenantId,
      roleId: role.roleId,
      permissionKey: input.permissionKey,
    });
  }

  async grantPermissionAsActor(
    context: TenantActorContext,
    input: Omit<GrantPermissionInput, "tenantId">,
  ) {
    await this.assertAdminAccess({
      context,
      capability: "admin:role-permissions:grant",
      targetScopeId: null,
    });
    const isOwner = await this.repository.checkAccess({
      tenantId: context.tenantId,
      userId: context.actor.userId,
      capability: "admin:tenant:owner",
      targetScopeId: null,
    });
    const hasGrantedCapability = await this.repository.checkAccess({
      tenantId: context.tenantId,
      userId: context.actor.userId,
      capability: input.permissionKey,
      targetScopeId: null,
    });
    if (!isOwner && !hasGrantedCapability) {
      throw permissionDenied(context, input.permissionKey, null);
    }

    const role = await this.resolveRole({
      ...input,
      tenantId: context.tenantId,
    });
    await this.repository.grantPermission({
      tenantId: context.tenantId,
      roleId: role.roleId,
      permissionKey: input.permissionKey,
    });
  }

  async assignRole(input: AssignRoleInput) {
    const role = await this.resolveRole(input);
    await this.repository.assignRole({
      tenantId: input.tenantId,
      userId: input.userId,
      roleId: role.roleId,
      scopeId: input.scopeId,
    });
  }

  async assignRoleAsActor(
    context: TenantActorContext,
    input: Omit<AssignRoleInput, "tenantId">,
  ) {
    await this.assertAdminAccess({
      context,
      capability: "admin:role-assignments:assign",
      targetScopeId: input.scopeId,
    });
    const role = await this.resolveRole({
      ...input,
      tenantId: context.tenantId,
    });
    const isOwner = await this.repository.checkAccess({
      tenantId: context.tenantId,
      userId: context.actor.userId,
      capability: "admin:tenant:owner",
      targetScopeId: null,
    });
    if (!isOwner) {
      const permissionKeys = await this.repository.rolePermissionKeys({
        tenantId: context.tenantId,
        roleId: role.roleId,
      });
      for (const permissionKey of permissionKeys) {
        const canGrant = await this.repository.checkAccess({
          tenantId: context.tenantId,
          userId: context.actor.userId,
          capability: permissionKey,
          targetScopeId: input.scopeId,
        });
        if (!canGrant) {
          throw permissionDenied(context, permissionKey, input.scopeId);
        }
      }
    }

    await this.repository.assignRole({
      tenantId: context.tenantId,
      userId: input.userId,
      roleId: role.roleId,
      scopeId: input.scopeId,
    });
  }

  checkAccess(input: CheckAccessInput) {
    return this.repository.checkAccess({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: input.capability,
      targetScopeId: input.targetScopeId,
    });
  }

  async assertAccess(input: CheckAccessInput) {
    const allowed = await this.repository.checkAccess({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: input.capability,
      targetScopeId: input.targetScopeId,
    });
    if (!allowed) {
      throw permissionDenied(
        input.context,
        input.capability,
        input.targetScopeId,
      );
    }
  }

  listAccessibleScopeIds(input: ListAccessibleScopesInput) {
    return this.repository.listAccessibleScopeIds({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: input.capability,
    });
  }

  async listCreatableDocumentScopeIds(input: {
    context: TenantActorContext;
    capability: string;
  }) {
    const root = await this.repository.ensureTenantRootScope(
      input.context.tenantId,
    );
    const scopeIds = await this.repository.listAccessibleScopeIds({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: input.capability,
    });

    return scopeIds.map((scopeId) =>
      scopeId === root.scopeId ? null : scopeId,
    );
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
    for (const permission of builtInAdminPermissions) {
      await this.repository.grantPermission({
        tenantId: input.tenantId,
        roleId: ownerRole.roleId,
        permissionKey: permission.key,
      });
    }
    await this.repository.assignRole({
      tenantId: input.tenantId,
      userId: user.userId,
      roleId: ownerRole.roleId,
      scopeId: rootScope.scopeId,
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

  private async assertAdminAccess(input: CheckAccessInput): Promise<void> {
    const owner = await this.repository.checkAccess({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: "admin:tenant:owner",
      targetScopeId: null,
    });
    if (owner) {
      return;
    }

    const allowed = await this.repository.checkAccess({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: input.capability,
      targetScopeId: input.targetScopeId,
    });
    if (!allowed) {
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
    const role = input.roleId
      ? await this.repository.getRoleById({
          tenantId: input.tenantId,
          roleId: input.roleId,
        })
      : input.roleKey
        ? await this.repository.getRoleByKey({
            tenantId: input.tenantId,
            key: input.roleKey,
          })
        : null;

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
