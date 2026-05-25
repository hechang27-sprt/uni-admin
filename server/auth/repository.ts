import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

import {
  authScopeClosureTable,
  authScopesTable,
  permissionsTable,
  rolePermissionsTable,
  rolesTable,
  tenantMembershipsTable,
  userPasswordCredentialsTable,
  userRoleAssignmentsTable,
  usersTable,
} from "#server/db/schema";
import type * as dbSchema from "#server/db/schema";
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

type DrizzleDatabase = PgDatabase<any, typeof dbSchema>;
type Transaction = Parameters<Parameters<DrizzleDatabase["transaction"]>[0]>[0];

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

export class DrizzleAuthRbacRepository implements AuthRbacRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async createUser(input: { displayName?: string | null }): Promise<AuthUser> {
    const [row] = await this.database
      .insert(usersTable)
      .values({
        displayName: input.displayName ?? null,
      })
      .returning();

    return mapUser(assertRow(row, "User insert did not return a row"));
  }

  async getUser(userId: string): Promise<AuthUser | null> {
    const rows = await this.database
      .select()
      .from(usersTable)
      .where(eq(usersTable.userId, userId))
      .limit(1);

    return rows[0] ? mapUser(rows[0]) : null;
  }

  async setPasswordCredential(input: {
    userId: string;
    username: string;
    passwordHash: string;
  }): Promise<UsernamePasswordCredential> {
    const now = new Date();
    const [row] = await this.database
      .insert(userPasswordCredentialsTable)
      .values({
        userId: input.userId,
        username: input.username,
        passwordHash: input.passwordHash,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userPasswordCredentialsTable.userId,
        set: {
          username: input.username,
          passwordHash: input.passwordHash,
          updatedAt: now,
        },
      })
      .returning();

    return mapCredential(
      assertRow(row, "Password credential upsert did not return a row"),
    );
  }

  async findCredentialByUsername(
    username: string,
  ): Promise<UsernamePasswordCredential | null> {
    const rows = await this.database
      .select()
      .from(userPasswordCredentialsTable)
      .where(eq(userPasswordCredentialsTable.username, username))
      .limit(1);

    return rows[0] ? mapCredential(rows[0]) : null;
  }

  async createTenantMembership(input: {
    tenantId: string;
    userId: string;
  }): Promise<TenantMembership> {
    const now = new Date();
    const [row] = await this.database
      .insert(tenantMembershipsTable)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        status: "active",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          tenantMembershipsTable.tenantId,
          tenantMembershipsTable.userId,
        ],
        set: {
          status: "active",
          updatedAt: now,
        },
      })
      .returning();

    return mapMembership(
      assertRow(row, "Tenant membership upsert did not return a row"),
    );
  }

  async findTenantMembership(input: {
    tenantId: string;
    userId: string;
  }): Promise<TenantMembership | null> {
    const rows = await this.database
      .select()
      .from(tenantMembershipsTable)
      .where(
        and(
          eq(tenantMembershipsTable.tenantId, input.tenantId),
          eq(tenantMembershipsTable.userId, input.userId),
        ),
      )
      .limit(1);

    return rows[0] ? mapMembership(rows[0]) : null;
  }

  async ensureTenantRootScope(tenantId: string): Promise<AuthScope> {
    const existing = await this.findTenantRootScope(tenantId);
    if (existing) {
      return existing;
    }

    return this.database.transaction(async (tx) => {
      const [scopeRow] = await tx
        .insert(authScopesTable)
        .values({
          tenantId,
          type: "tenant",
          key: tenantRootScopeKey,
          name: "Tenant root",
        })
        .onConflictDoNothing()
        .returning();

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
        .insert(authScopeClosureTable)
        .values({
          tenantId,
          ancestorId: scope.scopeId,
          descendantId: scope.scopeId,
          depth: 0,
        })
        .onConflictDoNothing();

      return scope;
    });
  }

  async getScope(input: {
    tenantId: string;
    scopeId: string;
  }): Promise<AuthScope | null> {
    const rows = await this.database
      .select()
      .from(authScopesTable)
      .where(
        and(
          eq(authScopesTable.tenantId, input.tenantId),
          eq(authScopesTable.scopeId, input.scopeId),
        ),
      )
      .limit(1);

    return rows[0] ? mapScope(rows[0]) : null;
  }

  async createScope(input: {
    tenantId: string;
    parentScopeId: string;
    type: string;
    key?: string | null;
    name?: string | null;
  }): Promise<AuthScope> {
    return this.database.transaction(async (tx) => {
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

      const [scopeRow] = await tx
        .insert(authScopesTable)
        .values({
          tenantId: input.tenantId,
          parentId: input.parentScopeId,
          type: input.type,
          key: input.key ?? null,
          name: input.name ?? null,
        })
        .returning();
      const scope = mapScope(assertRow(scopeRow, "Scope insert failed"));
      const ancestorRows = await tx
        .select()
        .from(authScopeClosureTable)
        .where(
          and(
            eq(authScopeClosureTable.tenantId, input.tenantId),
            eq(authScopeClosureTable.descendantId, input.parentScopeId),
          ),
        );

      await tx.insert(authScopeClosureTable).values([
        ...ancestorRows.map((ancestor) => ({
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
      ]);

      return scope;
    });
  }

  async createRole(input: {
    tenantId: string;
    key: string;
    name?: string | null;
  }): Promise<Role> {
    const now = new Date();
    const [row] = await this.database
      .insert(rolesTable)
      .values({
        tenantId: input.tenantId,
        key: input.key,
        name: input.name ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [rolesTable.tenantId, rolesTable.key],
        set: {
          name: input.name ?? null,
          updatedAt: now,
        },
      })
      .returning();

    return mapRole(assertRow(row, "Role upsert did not return a row"));
  }

  async getRoleById(input: {
    tenantId: string;
    roleId: string;
  }): Promise<Role | null> {
    const rows = await this.database
      .select()
      .from(rolesTable)
      .where(
        and(
          eq(rolesTable.tenantId, input.tenantId),
          eq(rolesTable.roleId, input.roleId),
        ),
      )
      .limit(1);

    return rows[0] ? mapRole(rows[0]) : null;
  }

  async getRoleByKey(input: {
    tenantId: string;
    key: string;
  }): Promise<Role | null> {
    const rows = await this.database
      .select()
      .from(rolesTable)
      .where(
        and(
          eq(rolesTable.tenantId, input.tenantId),
          eq(rolesTable.key, input.key),
        ),
      )
      .limit(1);

    return rows[0] ? mapRole(rows[0]) : null;
  }

  async upsertPermissions(
    input: PermissionDefinitionInput[],
  ): Promise<Permission[]> {
    if (input.length === 0) {
      return [];
    }

    const now = new Date();
    const rows = await this.database
      .insert(permissionsTable)
      .values(
        input.map((permission) => ({
          key: permission.key,
          source: permission.source,
          description: permission.description ?? null,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: permissionsTable.key,
        set: {
          source: sql`excluded.source`,
          description: sql`excluded.description`,
          updatedAt: now,
        },
      })
      .returning();

    return rows.map(mapPermission);
  }

  async grantPermissions(input: {
    tenantId: string;
    roleId: string;
    permissionKeys: string[];
  }): Promise<void> {
    if (input.permissionKeys.length === 0) {
      return;
    }

    const role = await this.getRoleById({
      tenantId: input.tenantId,
      roleId: input.roleId,
    });
    if (!role) {
      throw new AuthRbacError("AUTH_ROLE_NOT_FOUND", "Role not found", input);
    }

    const permissionKeys = [...new Set(input.permissionKeys)];
    const permissions = await this.database
      .select()
      .from(permissionsTable)
      .where(inArray(permissionsTable.key, permissionKeys));
    const permissionsByKey = new Map(
      permissions.map((permission) => [permission.key, permission]),
    );
    const missingPermissionKey = permissionKeys.find(
      (permissionKey) => !permissionsByKey.has(permissionKey),
    );
    if (missingPermissionKey) {
      throw new AuthRbacError(
        "AUTH_PERMISSION_NOT_FOUND",
        "Permission not found",
        { ...input, permissionKey: missingPermissionKey },
      );
    }

    await this.database
      .insert(rolePermissionsTable)
      .values(
        permissionKeys.map((permissionKey) => ({
          tenantId: input.tenantId,
          roleId: input.roleId,
          permissionId: permissionsByKey.get(permissionKey)!.permissionId,
        })),
      )
      .onConflictDoNothing();
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

    const userIds = [...new Set(input.assignments.map((item) => item.userId))];
    const roleIds = [...new Set(input.assignments.map((item) => item.roleId))];
    const scopeIds = [
      ...new Set(input.assignments.map((item) => item.scopeId)),
    ];
    const [memberships, roles, scopes] = await Promise.all([
      this.database
        .select()
        .from(tenantMembershipsTable)
        .where(
          and(
            eq(tenantMembershipsTable.tenantId, input.tenantId),
            inArray(tenantMembershipsTable.userId, userIds),
          ),
        ),
      this.database
        .select()
        .from(rolesTable)
        .where(
          and(
            eq(rolesTable.tenantId, input.tenantId),
            inArray(rolesTable.roleId, roleIds),
          ),
        ),
      this.database
        .select()
        .from(authScopesTable)
        .where(
          and(
            eq(authScopesTable.tenantId, input.tenantId),
            inArray(authScopesTable.scopeId, scopeIds),
          ),
        ),
    ]);
    const activeMembershipIds = new Set(
      memberships
        .filter((membership) => membership.status === "active")
        .map((membership) => membership.userId),
    );
    const foundRoleIds = new Set(roles.map((role) => role.roleId));
    const foundScopeIds = new Set(scopes.map((scope) => scope.scopeId));
    const missingMembership = input.assignments.find(
      (assignment) => !activeMembershipIds.has(assignment.userId),
    );
    const missingRole = input.assignments.find(
      (assignment) => !foundRoleIds.has(assignment.roleId),
    );
    const missingScope = input.assignments.find(
      (assignment) => !foundScopeIds.has(assignment.scopeId),
    );

    if (missingMembership) {
      throw new AuthRbacError(
        "AUTH_TENANT_MEMBERSHIP_REQUIRED",
        "Tenant membership is required",
        { tenantId: input.tenantId, ...missingMembership },
      );
    }
    if (missingRole) {
      throw new AuthRbacError("AUTH_ROLE_NOT_FOUND", "Role not found", {
        tenantId: input.tenantId,
        ...missingRole,
      });
    }
    if (missingScope) {
      throw new AuthRbacError("AUTH_SCOPE_NOT_FOUND", "Scope not found", {
        tenantId: input.tenantId,
        ...missingScope,
      });
    }

    await this.database
      .insert(userRoleAssignmentsTable)
      .values(
        input.assignments.map((assignment) => ({
          tenantId: input.tenantId,
          ...assignment,
        })),
      )
      .onConflictDoNothing();
  }

  async rolePermissionKeys(input: {
    tenantId: string;
    roleId: string;
  }): Promise<string[]> {
    const rows = await this.database
      .select({ key: permissionsTable.key })
      .from(rolePermissionsTable)
      .innerJoin(
        permissionsTable,
        eq(rolePermissionsTable.permissionId, permissionsTable.permissionId),
      )
      .where(
        and(
          eq(rolePermissionsTable.tenantId, input.tenantId),
          eq(rolePermissionsTable.roleId, input.roleId),
        ),
      );

    return rows.map((row) => row.key);
  }

  async checkAccessMany(input: {
    tenantId: string;
    userId: string;
    checks: {
      capability: string;
      targetScopeId: string | null;
    }[];
  }): Promise<boolean[]> {
    if (input.checks.length === 0) {
      return [];
    }

    const rootScopeId = input.checks.some(
      (check) => check.targetScopeId === null,
    )
      ? (await this.ensureTenantRootScope(input.tenantId)).scopeId
      : null;
    const values = input.checks.map(
      (check, index) =>
        sql`(${check.capability}::text, ${check.targetScopeId ?? rootScopeId}::uuid, ${index}::integer)`,
    );
    const result = await this.database.execute<{
      inputOrder: number;
      allowed: boolean;
    }>(sql`
      with checks (capability, target_scope_id, input_order) as (
        values ${sql.join(values, sql`, `)}
      )
      select
        checks.input_order as "inputOrder",
        exists (
          select 1
          from ${userRoleAssignmentsTable} as assignment
          inner join ${tenantMembershipsTable} as membership
            on membership.tenant_id = assignment.tenant_id
            and membership.user_id = assignment.user_id
          inner join ${rolePermissionsTable} as role_permission
            on role_permission.tenant_id = assignment.tenant_id
            and role_permission.role_id = assignment.role_id
          inner join ${permissionsTable} as permission
            on permission.permission_id = role_permission.permission_id
          inner join ${authScopeClosureTable} as closure
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
    `);

    return result.rows.map((row: { allowed: boolean }) => row.allowed);
  }

  async listAccessibleScopeIds(input: {
    tenantId: string;
    userId: string;
    capability: string;
  }): Promise<string[]> {
    const rows = await this.database
      .selectDistinct({ scopeId: authScopeClosureTable.descendantId })
      .from(userRoleAssignmentsTable)
      .innerJoin(
        tenantMembershipsTable,
        and(
          eq(
            tenantMembershipsTable.tenantId,
            userRoleAssignmentsTable.tenantId,
          ),
          eq(tenantMembershipsTable.userId, userRoleAssignmentsTable.userId),
        ),
      )
      .innerJoin(
        rolePermissionsTable,
        and(
          eq(rolePermissionsTable.tenantId, userRoleAssignmentsTable.tenantId),
          eq(rolePermissionsTable.roleId, userRoleAssignmentsTable.roleId),
        ),
      )
      .innerJoin(
        permissionsTable,
        eq(permissionsTable.permissionId, rolePermissionsTable.permissionId),
      )
      .innerJoin(
        authScopeClosureTable,
        and(
          eq(authScopeClosureTable.tenantId, userRoleAssignmentsTable.tenantId),
          eq(
            authScopeClosureTable.ancestorId,
            userRoleAssignmentsTable.scopeId,
          ),
        ),
      )
      .where(
        and(
          eq(userRoleAssignmentsTable.tenantId, input.tenantId),
          eq(userRoleAssignmentsTable.userId, input.userId),
          eq(tenantMembershipsTable.status, "active"),
          eq(permissionsTable.key, input.capability),
        ),
      );

    return rows.map((row) => row.scopeId);
  }

  async listAccessibleDocumentScopeIds(input: {
    tenantId: string;
    userId: string;
    capability: string;
  }): Promise<(string | null)[]> {
    const rows = await this.database
      .selectDistinct({
        scopeId: sql<string | null>`case
          when ${authScopesTable.key} = ${tenantRootScopeKey} then null
          else ${authScopeClosureTable.descendantId}
        end`,
      })
      .from(userRoleAssignmentsTable)
      .innerJoin(
        tenantMembershipsTable,
        and(
          eq(
            tenantMembershipsTable.tenantId,
            userRoleAssignmentsTable.tenantId,
          ),
          eq(tenantMembershipsTable.userId, userRoleAssignmentsTable.userId),
        ),
      )
      .innerJoin(
        rolePermissionsTable,
        and(
          eq(rolePermissionsTable.tenantId, userRoleAssignmentsTable.tenantId),
          eq(rolePermissionsTable.roleId, userRoleAssignmentsTable.roleId),
        ),
      )
      .innerJoin(
        permissionsTable,
        eq(permissionsTable.permissionId, rolePermissionsTable.permissionId),
      )
      .innerJoin(
        authScopeClosureTable,
        and(
          eq(authScopeClosureTable.tenantId, userRoleAssignmentsTable.tenantId),
          eq(
            authScopeClosureTable.ancestorId,
            userRoleAssignmentsTable.scopeId,
          ),
        ),
      )
      .innerJoin(
        authScopesTable,
        and(
          eq(authScopesTable.tenantId, authScopeClosureTable.tenantId),
          eq(authScopesTable.scopeId, authScopeClosureTable.descendantId),
        ),
      )
      .where(
        and(
          eq(userRoleAssignmentsTable.tenantId, input.tenantId),
          eq(userRoleAssignmentsTable.userId, input.userId),
          eq(tenantMembershipsTable.status, "active"),
          eq(permissionsTable.key, input.capability),
        ),
      );

    return rows.map((row) => row.scopeId);
  }

  private async findTenantRootScope(
    tenantId: string,
    tx: Transaction | DrizzleDatabase = this.database,
  ): Promise<AuthScope | null> {
    const rows = await tx
      .select()
      .from(authScopesTable)
      .where(
        and(
          eq(authScopesTable.tenantId, tenantId),
          eq(authScopesTable.key, tenantRootScopeKey),
        ),
      )
      .limit(1);

    return rows[0] ? mapScope(rows[0]) : null;
  }

  private async getScopeInTransaction(
    tx: Transaction,
    tenantId: string,
    scopeId: string,
  ): Promise<AuthScope | null> {
    const rows = await tx
      .select()
      .from(authScopesTable)
      .where(
        and(
          eq(authScopesTable.tenantId, tenantId),
          eq(authScopesTable.scopeId, scopeId),
        ),
      )
      .limit(1);

    return rows[0] ? mapScope(rows[0]) : null;
  }
}

function mapUser(row: typeof usersTable.$inferSelect): AuthUser {
  return row;
}

function mapCredential(
  row: typeof userPasswordCredentialsTable.$inferSelect,
): UsernamePasswordCredential {
  return row;
}

function mapMembership(
  row: typeof tenantMembershipsTable.$inferSelect,
): TenantMembership {
  return row;
}

function mapScope(row: typeof authScopesTable.$inferSelect): AuthScope {
  return row;
}

function mapRole(row: typeof rolesTable.$inferSelect): Role {
  return row;
}

function mapPermission(row: typeof permissionsTable.$inferSelect): Permission {
  return row;
}

function assertRow<TRow>(row: TRow | undefined, message: string): TRow {
  if (!row) {
    throw new Error(message);
  }

  return row;
}
