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
    await this.assertAdminAccess({
      context,
      capability: "admin:role-permissions:grant",
      targetScopeId: null,
    });
    const [isOwner, hasGrantedCapability] =
      await this.repository.checkAccessMany({
        tenantId: context.tenantId,
        userId: context.actor.userId,
        checks: [
          { capability: "admin:tenant:owner", targetScopeId: null },
          { capability: input.permissionKey, targetScopeId: null },
        ],
      });
    if (!isOwner && !hasGrantedCapability) {
      throw permissionDenied(context, input.permissionKey, null);
    }

    const role = await this.resolveRole({
      ...input,
      tenantId: context.tenantId,
    });
    await this.repository.grantPermissions({
      tenantId: context.tenantId,
      roleId: role.roleId,
      permissionKeys: [input.permissionKey],
    });
  }

  async assignRole(input: AssignRoleInput) {
    const role = await this.resolveRole(input);
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
    await this.assertAdminAccess({
      context,
      capability: "admin:role-assignments:assign",
      targetScopeId: input.scopeId,
    });
    const role = await this.resolveRole({
      ...input,
      tenantId: context.tenantId,
    });
    const [isOwner] = await this.repository.checkAccessMany({
      tenantId: context.tenantId,
      userId: context.actor.userId,
      checks: [{ capability: "admin:tenant:owner", targetScopeId: null }],
    });
    if (!isOwner) {
      const permissionKeys = await this.repository.rolePermissionKeys({
        tenantId: context.tenantId,
        roleId: role.roleId,
      });
      const accessResults = await this.repository.checkAccessMany({
        tenantId: context.tenantId,
        userId: context.actor.userId,
        checks: permissionKeys.map((capability) => ({
          capability,
          targetScopeId: input.scopeId,
        })),
      });
      const deniedIndex = accessResults.findIndex((allowed) => !allowed);
      if (deniedIndex !== -1) {
        throw permissionDenied(
          context,
          permissionKeys[deniedIndex]!,
          input.scopeId,
        );
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

  checkAccessMany(input: CheckAccessManyInput) {
    return this.repository.checkAccessMany({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      checks: input.checks,
    });
  }

  async assertAccess(input: CheckAccessInput) {
    const allowed = await this.checkAccess(input);
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

  listAccessibleDocumentScopeIds(input: ListAccessibleScopesInput) {
    return this.repository.listAccessibleDocumentScopeIds({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: input.capability,
    });
  }

  listCreatableDocumentScopeIds(input: {
    context: TenantActorContext;
    capability: string;
  }) {
    return this.repository.listAccessibleDocumentScopeIds({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      capability: input.capability,
    });
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

  private async assertAdminAccess(input: CheckAccessInput): Promise<void> {
    const [owner, allowed] = await this.repository.checkAccessMany({
      tenantId: input.context.tenantId,
      userId: input.context.actor.userId,
      checks: [
        { capability: "admin:tenant:owner", targetScopeId: null },
        {
          capability: input.capability,
          targetScopeId: input.targetScopeId,
        },
      ],
    });
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
