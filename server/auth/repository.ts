import { sql, type Selectable, type Transaction } from "kysely";

import type {
  AuthScopesTable,
  Database,
  PermissionsTable,
  RolesTable,
  TenantMembershipsTable,
  UserPasswordCredentialsTable,
  UsersTable,
} from "#server/db/schema";
import type { DatabaseClient } from "#server/util/kysely";
import { AuthRbacError } from "./errors";
import type {
  AuthScope,
  AuthUser,
  Permission,
  PermissionDefinitionInput,
  Role,
  TenantMembership,
  UsernamePasswordCredential,
} from "./types";

export const tenantRootScopeKey = "__tenant_root";

type AuthTransaction = Transaction<Database>;
type AuthDatabase = DatabaseClient | AuthTransaction;

export interface AuthRbacRepository {
  createUser(input: { displayName?: string | null }): Promise<AuthUser>;
  getUser(userId: string): Promise<AuthUser | null>;
  setPasswordCredential(input: {
    userId: string;
    username: string;
    passwordHash: string;
  }): Promise<UsernamePasswordCredential>;
  findCredentialByUsername(
    username: string,
  ): Promise<UsernamePasswordCredential | null>;
  createTenantMembership(input: {
    tenantId: string;
    userId: string;
  }): Promise<TenantMembership>;
  findTenantMembership(input: {
    tenantId: string;
    userId: string;
  }): Promise<TenantMembership | null>;
  ensureTenantRootScope(tenantId: string): Promise<AuthScope>;
  getScope(input: {
    tenantId: string;
    scopeId: string;
  }): Promise<AuthScope | null>;
  createScope(input: {
    tenantId: string;
    parentScopeId: string;
    type: string;
    key?: string | null;
    name?: string | null;
  }): Promise<AuthScope>;
  createRole(input: {
    tenantId: string;
    key: string;
    name?: string | null;
  }): Promise<Role>;
  getRoleById(input: {
    tenantId: string;
    roleId: string;
  }): Promise<Role | null>;
  getRoleByKey(input: { tenantId: string; key: string }): Promise<Role | null>;
  upsertPermissions(input: PermissionDefinitionInput[]): Promise<Permission[]>;
  grantPermissions(input: {
    tenantId: string;
    roleId: string;
    permissionKeys: string[];
  }): Promise<void>;
  assignRoles(input: {
    tenantId: string;
    assignments: {
      userId: string;
      roleId: string;
      scopeId: string;
    }[];
  }): Promise<void>;
  rolePermissionKeys(input: {
    tenantId: string;
    roleId: string;
  }): Promise<string[]>;
  checkAccessMany(input: {
    tenantId: string;
    userId: string;
    checks: {
      capability: string;
      targetScopeId: string | null;
    }[];
  }): Promise<boolean[]>;
  listAccessibleScopeIds(input: {
    tenantId: string;
    userId: string;
    capability: string;
  }): Promise<string[]>;
  listAccessibleDocumentScopeIds(input: {
    tenantId: string;
    userId: string;
    capability: string;
  }): Promise<(string | null)[]>;
}

export class KyselyAuthRbacRepository implements AuthRbacRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createUser(input: { displayName?: string | null }): Promise<AuthUser> {
    const row = await this.database
      .insertInto("users")
      .values({ displayName: input.displayName ?? null })
      .returningAll()
      .executeTakeFirstOrThrow();
    return mapUser(row);
  }

  async getUser(userId: string): Promise<AuthUser | null> {
    const row = await this.database
      .selectFrom("users")
      .selectAll()
      .where("userId", "=", userId)
      .executeTakeFirst();
    return row ? mapUser(row) : null;
  }

  async setPasswordCredential(input: {
    userId: string;
    username: string;
    passwordHash: string;
  }): Promise<UsernamePasswordCredential> {
    const now = new Date();
    const row = await this.database
      .insertInto("userPasswordCredentials")
      .values({ ...input, updatedAt: now })
      .onConflict((conflict) =>
        conflict.column("userId").doUpdateSet({
          username: input.username,
          passwordHash: input.passwordHash,
          updatedAt: now,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return mapCredential(row);
  }

  async findCredentialByUsername(
    username: string,
  ): Promise<UsernamePasswordCredential | null> {
    const row = await this.database
      .selectFrom("userPasswordCredentials")
      .selectAll()
      .where("username", "=", username)
      .executeTakeFirst();
    return row ? mapCredential(row) : null;
  }

  async createTenantMembership(input: {
    tenantId: string;
    userId: string;
  }): Promise<TenantMembership> {
    const now = new Date();
    const row = await this.database
      .insertInto("tenantMemberships")
      .values({ ...input, status: "active", updatedAt: now })
      .onConflict((conflict) =>
        conflict.columns(["tenantId", "userId"]).doUpdateSet({
          status: "active",
          updatedAt: now,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return mapMembership(row);
  }

  async findTenantMembership(input: {
    tenantId: string;
    userId: string;
  }): Promise<TenantMembership | null> {
    const row = await this.database
      .selectFrom("tenantMemberships")
      .selectAll()
      .where("tenantId", "=", input.tenantId)
      .where("userId", "=", input.userId)
      .executeTakeFirst();
    return row ? mapMembership(row) : null;
  }

  async ensureTenantRootScope(tenantId: string): Promise<AuthScope> {
    const existing = await this.findTenantRootScope(tenantId);
    if (existing) {
      return existing;
    }

    return this.database.transaction().execute(async (tx) => {
      const scopeRow = await tx
        .insertInto("authScopes")
        .values({
          tenantId,
          type: "tenant",
          key: tenantRootScopeKey,
          name: "Tenant root",
          parentId: null,
        })
        .onConflict((conflict) => conflict.doNothing())
        .returningAll()
        .executeTakeFirst();
      const scope = scopeRow
        ? mapScope(scopeRow)
        : await this.findTenantRootScope(tenantId, tx);
      if (!scope) {
        throw new AuthRbacError(
          "AUTH_SCOPE_NOT_FOUND",
          "Tenant root scope was not created",
          { tenantId },
        );
      }

      await tx
        .insertInto("authScopeClosure")
        .values({
          tenantId,
          ancestorId: scope.scopeId,
          descendantId: scope.scopeId,
          depth: 0,
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
      return scope;
    });
  }

  async getScope(input: {
    tenantId: string;
    scopeId: string;
  }): Promise<AuthScope | null> {
    const row = await this.database
      .selectFrom("authScopes")
      .selectAll()
      .where("tenantId", "=", input.tenantId)
      .where("scopeId", "=", input.scopeId)
      .executeTakeFirst();
    return row ? mapScope(row) : null;
  }

  async createScope(input: {
    tenantId: string;
    parentScopeId: string;
    type: string;
    key?: string | null;
    name?: string | null;
  }): Promise<AuthScope> {
    return this.database.transaction().execute(async (tx) => {
      const parent = await this.getScopeInTransaction(
        tx,
        input.tenantId,
        input.parentScopeId,
      );
      if (!parent) {
        throw new AuthRbacError("AUTH_SCOPE_NOT_FOUND", "Scope not found", {
          tenantId: input.tenantId,
          scopeId: input.parentScopeId,
        });
      }

      const row = await tx
        .insertInto("authScopes")
        .values({
          tenantId: input.tenantId,
          parentId: input.parentScopeId,
          type: input.type,
          key: input.key ?? null,
          name: input.name ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const scope = mapScope(row);
      const ancestors = await tx
        .selectFrom("authScopeClosure")
        .selectAll()
        .where("tenantId", "=", input.tenantId)
        .where("descendantId", "=", input.parentScopeId)
        .execute();

      await tx
        .insertInto("authScopeClosure")
        .values([
          ...ancestors.map((ancestor) => ({
            tenantId: input.tenantId,
            ancestorId: ancestor.ancestorId,
            descendantId: scope.scopeId,
            depth: ancestor.depth + 1,
          })),
          {
            tenantId: input.tenantId,
            ancestorId: scope.scopeId,
            descendantId: scope.scopeId,
            depth: 0,
          },
        ])
        .execute();
      return scope;
    });
  }

  async createRole(input: {
    tenantId: string;
    key: string;
    name?: string | null;
  }): Promise<Role> {
    const now = new Date();
    const row = await this.database
      .insertInto("roles")
      .values({
        tenantId: input.tenantId,
        key: input.key,
        name: input.name ?? null,
        updatedAt: now,
      })
      .onConflict((conflict) =>
        conflict.columns(["tenantId", "key"]).doUpdateSet({
          name: input.name ?? null,
          updatedAt: now,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return mapRole(row);
  }

  async getRoleById(input: {
    tenantId: string;
    roleId: string;
  }): Promise<Role | null> {
    const row = await this.database
      .selectFrom("roles")
      .selectAll()
      .where("tenantId", "=", input.tenantId)
      .where("roleId", "=", input.roleId)
      .executeTakeFirst();
    return row ? mapRole(row) : null;
  }

  async getRoleByKey(input: {
    tenantId: string;
    key: string;
  }): Promise<Role | null> {
    const row = await this.database
      .selectFrom("roles")
      .selectAll()
      .where("tenantId", "=", input.tenantId)
      .where("key", "=", input.key)
      .executeTakeFirst();
    return row ? mapRole(row) : null;
  }

  async upsertPermissions(
    input: PermissionDefinitionInput[],
  ): Promise<Permission[]> {
    if (input.length === 0) {
      return [];
    }
    const now = new Date();
    const rows = await this.database
      .insertInto("permissions")
      .values(
        input.map((permission) => ({
          key: permission.key,
          source: permission.source,
          description: permission.description ?? null,
          updatedAt: now,
        })),
      )
      .onConflict((conflict) =>
        conflict.column("key").doUpdateSet({
          source: sql`excluded.source`,
          description: sql`excluded.description`,
          updatedAt: now,
        }),
      )
      .returningAll()
      .execute();
    return rows.map((row) => mapPermission(row));
  }

  async grantPermissions(input: {
    tenantId: string;
    roleId: string;
    permissionKeys: string[];
  }): Promise<void> {
    if (input.permissionKeys.length === 0) {
      return;
    }
    if (
      !(await this.getRoleById({
        tenantId: input.tenantId,
        roleId: input.roleId,
      }))
    ) {
      throw new AuthRbacError("AUTH_ROLE_NOT_FOUND", "Role not found", input);
    }

    const permissions = await this.database
      .selectFrom("permissions")
      .select(["key", "permissionId"])
      .where("key", "in", input.permissionKeys)
      .execute();
    const existing = new Set(permissions.map((permission) => permission.key));
    const missing = input.permissionKeys.find((key) => !existing.has(key));
    if (missing) {
      throw new AuthRbacError(
        "AUTH_PERMISSION_NOT_FOUND",
        "Permission not found",
        { ...input, permissionKey: missing },
      );
    }

    await this.database
      .insertInto("rolePermissions")
      .columns(["tenantId", "roleId", "permissionId"])
      .expression((builder) =>
        builder
          .selectFrom("permissions")
          .select([
            sql<string>`${input.tenantId}::uuid`.as("tenantId"),
            sql<string>`${input.roleId}::uuid`.as("roleId"),
            "permissionId",
          ])
          .where("key", "in", input.permissionKeys),
      )
      .onConflict((conflict) => conflict.doNothing())
      .execute();
  }

  async assignRoles(input: {
    tenantId: string;
    assignments: {
      userId: string;
      roleId: string;
      scopeId: string;
    }[];
  }): Promise<void> {
    if (input.assignments.length === 0) {
      return;
    }

    const values = input.assignments.map(
      (assignment, order) =>
        sql`(${assignment.userId}::uuid, ${assignment.roleId}::uuid, ${assignment.scopeId}::uuid, ${order}::integer)`,
    );
    const result = await sql<{
      userId: string;
      roleId: string;
      scopeId: string;
      invalidTenantMembership: boolean;
      invalidRoleId: boolean;
      invalidScopeId: boolean;
    }>`
      with assignments (user_id, role_id, scope_id, input_order) as (
        values ${sql.join(values, sql`, `)}
      )
      select
        assignments.user_id as "userId",
        assignments.role_id as "roleId",
        assignments.scope_id as "scopeId",
        membership.tenant_id is null as "invalidTenantMembership",
        role.role_id is null as "invalidRoleId",
        scope.scope_id is null as "invalidScopeId"
      from assignments
      left join tenant_memberships as membership
        on membership.tenant_id = ${input.tenantId}::uuid
        and membership.user_id = assignments.user_id
        and membership.status = 'active'
      left join roles as role
        on role.tenant_id = membership.tenant_id
        and role.role_id = assignments.role_id
      left join auth_scopes as scope
        on scope.tenant_id = membership.tenant_id
        and scope.scope_id = assignments.scope_id
      where membership.tenant_id is null
        or role.role_id is null
        or scope.scope_id is null
      order by case
        when membership.tenant_id is null then 1
        when role.role_id is null then 2
        when scope.scope_id is null then 3
      end, assignments.input_order
      limit 1
    `.execute(this.database);
    const invalid = result.rows[0];
    if (invalid?.invalidTenantMembership) {
      throw new AuthRbacError(
        "AUTH_TENANT_MEMBERSHIP_REQUIRED",
        "Tenant membership is required",
        { tenantId: input.tenantId, ...invalid },
      );
    }
    if (invalid?.invalidRoleId) {
      throw new AuthRbacError("AUTH_ROLE_NOT_FOUND", "Role not found", {
        tenantId: input.tenantId,
        ...invalid,
      });
    }
    if (invalid?.invalidScopeId) {
      throw new AuthRbacError("AUTH_SCOPE_NOT_FOUND", "Scope not found", {
        tenantId: input.tenantId,
        ...invalid,
      });
    }

    await this.database
      .insertInto("userRoleAssignments")
      .values(
        input.assignments.map((assignment) => ({
          tenantId: input.tenantId,
          ...assignment,
        })),
      )
      .onConflict((conflict) => conflict.doNothing())
      .execute();
  }

  async rolePermissionKeys(input: {
    tenantId: string;
    roleId: string;
  }): Promise<string[]> {
    const rows = await this.database
      .selectFrom("rolePermissions")
      .innerJoin(
        "permissions",
        "permissions.permissionId",
        "rolePermissions.permissionId",
      )
      .select("permissions.key")
      .where("rolePermissions.tenantId", "=", input.tenantId)
      .where("rolePermissions.roleId", "=", input.roleId)
      .execute();
    return rows.map((row) => row.key);
  }

  async checkAccessMany(input: {
    tenantId: string;
    userId: string;
    checks: { capability: string; targetScopeId: string | null }[];
  }): Promise<boolean[]> {
    if (input.checks.length === 0) {
      return [];
    }
    const rootScope = input.checks.some((check) => check.targetScopeId === null)
      ? await this.ensureTenantRootScope(input.tenantId)
      : null;
    const rootScopeId = rootScope?.scopeId ?? null;
    const checks = input.checks.map(
      (check, order) =>
        sql`(${check.capability}::text, ${check.targetScopeId ?? rootScopeId}::uuid, ${order}::integer)`,
    );
    const result = await sql<{ inputOrder: number; allowed: boolean }>`
      with checks (capability, target_scope_id, input_order) as (
        values ${sql.join(checks, sql`, `)}
      )
      select
        checks.input_order as "inputOrder",
        exists (
          select 1
          from user_role_assignments as assignment
          inner join tenant_memberships as membership
            on membership.tenant_id = assignment.tenant_id
            and membership.user_id = assignment.user_id
          inner join role_permissions as role_permission
            on role_permission.tenant_id = assignment.tenant_id
            and role_permission.role_id = assignment.role_id
          inner join permissions as permission
            on permission.permission_id = role_permission.permission_id
          inner join auth_scope_closure as closure
            on closure.tenant_id = assignment.tenant_id
            and closure.ancestor_id = assignment.scope_id
            and closure.descendant_id = checks.target_scope_id
          where assignment.tenant_id = ${input.tenantId}::uuid
            and assignment.user_id = ${input.userId}::uuid
            and membership.status = 'active'
            and permission.key = checks.capability
        ) as allowed
      from checks
      order by checks.input_order
    `.execute(this.database);
    return result.rows.map((row) => row.allowed);
  }

  async listAccessibleScopeIds(input: {
    tenantId: string;
    userId: string;
    capability: string;
  }): Promise<string[]> {
    const rows = await this.database
      .selectFrom("userRoleAssignments as assignment")
      .innerJoin("tenantMemberships as membership", (join) =>
        join
          .onRef("membership.tenantId", "=", "assignment.tenantId")
          .onRef("membership.userId", "=", "assignment.userId"),
      )
      .innerJoin("rolePermissions as rolePermission", (join) =>
        join
          .onRef("rolePermission.tenantId", "=", "assignment.tenantId")
          .onRef("rolePermission.roleId", "=", "assignment.roleId"),
      )
      .innerJoin(
        "permissions as permission",
        "permission.permissionId",
        "rolePermission.permissionId",
      )
      .innerJoin("authScopeClosure as closure", (join) =>
        join
          .onRef("closure.tenantId", "=", "assignment.tenantId")
          .onRef("closure.ancestorId", "=", "assignment.scopeId"),
      )
      .select("closure.descendantId as scopeId")
      .distinct()
      .where("assignment.tenantId", "=", input.tenantId)
      .where("assignment.userId", "=", input.userId)
      .where("membership.status", "=", "active")
      .where("permission.key", "=", input.capability)
      .execute();
    return rows.map((row) => row.scopeId);
  }

  async listAccessibleDocumentScopeIds(input: {
    tenantId: string;
    userId: string;
    capability: string;
  }): Promise<(string | null)[]> {
    const rows = await this.database
      .selectFrom("userRoleAssignments as assignment")
      .innerJoin("tenantMemberships as membership", (join) =>
        join
          .onRef("membership.tenantId", "=", "assignment.tenantId")
          .onRef("membership.userId", "=", "assignment.userId"),
      )
      .innerJoin("rolePermissions as rolePermission", (join) =>
        join
          .onRef("rolePermission.tenantId", "=", "assignment.tenantId")
          .onRef("rolePermission.roleId", "=", "assignment.roleId"),
      )
      .innerJoin(
        "permissions as permission",
        "permission.permissionId",
        "rolePermission.permissionId",
      )
      .innerJoin("authScopeClosure as closure", (join) =>
        join
          .onRef("closure.tenantId", "=", "assignment.tenantId")
          .onRef("closure.ancestorId", "=", "assignment.scopeId"),
      )
      .innerJoin("authScopes as scope", (join) =>
        join
          .onRef("scope.tenantId", "=", "closure.tenantId")
          .onRef("scope.scopeId", "=", "closure.descendantId"),
      )
      .select(
        sql<string | null>`
          case when scope.key = ${tenantRootScopeKey}
            then null else closure.descendant_id end
        `.as("scopeId"),
      )
      .distinct()
      .where("assignment.tenantId", "=", input.tenantId)
      .where("assignment.userId", "=", input.userId)
      .where("membership.status", "=", "active")
      .where("permission.key", "=", input.capability)
      .execute();
    return rows.map((row) => row.scopeId);
  }

  private async findTenantRootScope(
    tenantId: string,
    database: AuthDatabase = this.database,
  ): Promise<AuthScope | null> {
    const row = await database
      .selectFrom("authScopes")
      .selectAll()
      .where("tenantId", "=", tenantId)
      .where("key", "=", tenantRootScopeKey)
      .executeTakeFirst();
    return row ? mapScope(row) : null;
  }

  private async getScopeInTransaction(
    tx: AuthTransaction,
    tenantId: string,
    scopeId: string,
  ): Promise<AuthScope | null> {
    const row = await tx
      .selectFrom("authScopes")
      .selectAll()
      .where("tenantId", "=", tenantId)
      .where("scopeId", "=", scopeId)
      .executeTakeFirst();
    return row ? mapScope(row) : null;
  }
}

function mapUser(row: Selectable<UsersTable>): AuthUser {
  return {
    ...row,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function mapCredential(
  row: Selectable<UserPasswordCredentialsTable>,
): UsernamePasswordCredential {
  return {
    ...row,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function mapMembership(row: Selectable<TenantMembershipsTable>): TenantMembership {
  return {
    ...row,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function mapScope(row: Selectable<AuthScopesTable>): AuthScope {
  return {
    ...row,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function mapRole(row: Selectable<RolesTable>): Role {
  return {
    ...row,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function mapPermission(row: Selectable<PermissionsTable>): Permission {
  return {
    ...row,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
