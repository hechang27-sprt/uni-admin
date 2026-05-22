import {
  deriveCollectionPermissionDefinitions,
  type CollectionRegistry,
} from "#server/data/documents";
import { AuthRbacError } from "./errors";
import { hashPassword, verifyPassword } from "./password";
import type { AuthRbacRepository } from "./repository";
import type {
  AssignRoleInput,
  AuthRbacService,
  BootstrapTenantOwnerInput,
  BootstrapTenantOwnerResult,
  CheckAccessInput,
  CreateRoleInput,
  CreateScopeInput,
  CreateTenantMembershipInput,
  CreateUserInput,
  GrantPermissionInput,
  ListAccessibleScopesInput,
  Permission,
  PermissionDefinitionInput,
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

export interface CreateAuthRbacServiceOptions {
  repository: AuthRbacRepository;
}

export function createAuthRbacService(
  options: CreateAuthRbacServiceOptions,
): AuthRbacService {
  const { repository } = options;

  return {
    createUser(input: CreateUserInput = {}) {
      return repository.createUser(input);
    },

    async setUsernamePasswordCredential(input: SetPasswordCredentialInput) {
      return repository.setPasswordCredential({
        userId: input.userId,
        username: normalizeUsername(input.username),
        passwordHash: await hashPassword(input.password),
      });
    },

    async verifyUsernamePassword(input: VerifyPasswordInput) {
      const credential = await repository.findCredentialByUsername(
        normalizeUsername(input.username),
      );
      if (!credential) {
        return null;
      }

      const valid = await verifyPassword(
        input.password,
        credential.passwordHash,
      );
      if (!valid) {
        return null;
      }

      const user = await repository.getUser(credential.userId);
      return user?.status === "active" ? user : null;
    },

    createTenantMembership(
      input: CreateTenantMembershipInput,
    ): Promise<TenantMembership> {
      return repository.createTenantMembership(input);
    },

    async resolveActor(input) {
      const membership = await repository.findTenantMembership(input);
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
    },

    ensureTenantRootScope(tenantId: string) {
      return repository.ensureTenantRootScope(tenantId);
    },

    async getTenantRootScopeId(tenantId: string) {
      return (await repository.ensureTenantRootScope(tenantId)).scopeId;
    },

    createScope(input: CreateScopeInput) {
      return repository.createScope(input);
    },

    async createScopeAsActor(context, input) {
      await assertAdminAccess(repository, {
        context,
        capability: "admin:scopes:create",
        targetScopeId: input.parentScopeId,
      });

      return repository.createScope({
        ...input,
        tenantId: context.tenantId,
      });
    },

    createRole(input: CreateRoleInput) {
      return repository.createRole(input);
    },

    syncPermissions(input: PermissionDefinitionInput[]) {
      return repository.upsertPermissions(input);
    },

    syncBuiltInAdminPermissions(): Promise<Permission[]> {
      return repository.upsertPermissions(builtInAdminPermissions);
    },

    syncCollectionPermissions(registry: CollectionRegistry) {
      return repository.upsertPermissions(
        deriveCollectionPermissionDefinitions(registry),
      );
    },

    async grantPermission(input: GrantPermissionInput) {
      const role = await resolveRole(repository, input);
      await repository.grantPermission({
        tenantId: input.tenantId,
        roleId: role.roleId,
        permissionKey: input.permissionKey,
      });
    },

    async grantPermissionAsActor(context, input) {
      await assertAdminAccess(repository, {
        context,
        capability: "admin:role-permissions:grant",
        targetScopeId: null,
      });
      const isOwner = await repository.checkAccess({
        tenantId: context.tenantId,
        userId: context.actor.userId,
        capability: "admin:tenant:owner",
        targetScopeId: null,
      });
      const hasGrantedCapability = await repository.checkAccess({
        tenantId: context.tenantId,
        userId: context.actor.userId,
        capability: input.permissionKey,
        targetScopeId: null,
      });
      if (!isOwner && !hasGrantedCapability) {
        throw permissionDenied(context, input.permissionKey, null);
      }

      const role = await resolveRole(repository, {
        ...input,
        tenantId: context.tenantId,
      });
      await repository.grantPermission({
        tenantId: context.tenantId,
        roleId: role.roleId,
        permissionKey: input.permissionKey,
      });
    },

    async assignRole(input: AssignRoleInput) {
      const role = await resolveRole(repository, input);
      await repository.assignRole({
        tenantId: input.tenantId,
        userId: input.userId,
        roleId: role.roleId,
        scopeId: input.scopeId,
      });
    },

    async assignRoleAsActor(context, input) {
      await assertAdminAccess(repository, {
        context,
        capability: "admin:role-assignments:assign",
        targetScopeId: input.scopeId,
      });
      const role = await resolveRole(repository, {
        ...input,
        tenantId: context.tenantId,
      });
      const isOwner = await repository.checkAccess({
        tenantId: context.tenantId,
        userId: context.actor.userId,
        capability: "admin:tenant:owner",
        targetScopeId: null,
      });
      if (!isOwner) {
        const permissionKeys = await repository.rolePermissionKeys({
          tenantId: context.tenantId,
          roleId: role.roleId,
        });
        for (const permissionKey of permissionKeys) {
          const canGrant = await repository.checkAccess({
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

      await repository.assignRole({
        tenantId: context.tenantId,
        userId: input.userId,
        roleId: role.roleId,
        scopeId: input.scopeId,
      });
    },

    checkAccess(input: CheckAccessInput) {
      return repository.checkAccess({
        tenantId: input.context.tenantId,
        userId: input.context.actor.userId,
        capability: input.capability,
        targetScopeId: input.targetScopeId,
      });
    },

    async assertAccess(input: CheckAccessInput) {
      const allowed = await repository.checkAccess({
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
    },

    listAccessibleScopeIds(input: ListAccessibleScopesInput) {
      return repository.listAccessibleScopeIds({
        tenantId: input.context.tenantId,
        userId: input.context.actor.userId,
        capability: input.capability,
      });
    },

    async listCreatableDocumentScopeIds(input) {
      const root = await repository.ensureTenantRootScope(
        input.context.tenantId,
      );
      const scopeIds = await repository.listAccessibleScopeIds({
        tenantId: input.context.tenantId,
        userId: input.context.actor.userId,
        capability: input.capability,
      });

      return scopeIds.map((scopeId) =>
        scopeId === root.scopeId ? null : scopeId,
      );
    },

    async bootstrapTenantOwner(
      input: BootstrapTenantOwnerInput,
    ): Promise<BootstrapTenantOwnerResult> {
      const [user, rootScope, ownerRole] = await Promise.all([
        repository.createUser({ displayName: input.displayName }),
        repository.ensureTenantRootScope(input.tenantId),
        repository.createRole({
          tenantId: input.tenantId,
          key: input.ownerRoleKey ?? "owner",
          name: "Owner",
        }),
      ]);
      await repository.createTenantMembership({
        tenantId: input.tenantId,
        userId: user.userId,
      });
      await repository.setPasswordCredential({
        userId: user.userId,
        username: normalizeUsername(input.username),
        passwordHash: await hashPassword(input.password),
      });
      await repository.upsertPermissions(builtInAdminPermissions);
      for (const permission of builtInAdminPermissions) {
        await repository.grantPermission({
          tenantId: input.tenantId,
          roleId: ownerRole.roleId,
          permissionKey: permission.key,
        });
      }
      await repository.assignRole({
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
    },
  };
}

async function assertAdminAccess(
  repository: AuthRbacRepository,
  input: CheckAccessInput,
): Promise<void> {
  const owner = await repository.checkAccess({
    tenantId: input.context.tenantId,
    userId: input.context.actor.userId,
    capability: "admin:tenant:owner",
    targetScopeId: null,
  });
  if (owner) {
    return;
  }

  const allowed = await repository.checkAccess({
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

async function resolveRole(
  repository: AuthRbacRepository,
  input: GrantPermissionInput | AssignRoleInput,
) {
  const role = input.roleId
    ? await repository.getRoleById({
        tenantId: input.tenantId,
        roleId: input.roleId,
      })
    : input.roleKey
      ? await repository.getRoleByKey({
          tenantId: input.tenantId,
          key: input.roleKey,
        })
      : null;

  if (!role) {
    throw new AuthRbacError("AUTH_ROLE_NOT_FOUND", "Role not found", input);
  }

  return role;
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
