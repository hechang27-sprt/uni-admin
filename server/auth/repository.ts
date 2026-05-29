/* oxlint-disable typescript/unbound-method -- Kysely expression-builder callback methods are used only to build SQL AST nodes. */
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
import { pivotToColumns } from "../util/db";

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
  findActiveTenantMembership(input: {
    tenantId: string;
    userId: string;
  }): Promise<TenantMembership | null>;
  findInvalidActiveMembershipUserId(input: {
    tenantId: string;
    userIds: string[];
  }): Promise<string | null>;
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
  findDeniedRolePermission(input: {
    tenantId: string;
    roleId: string;
    userId: string;
    targetScopeId: string;
  }): Promise<string | null>;
  findInvalidRoleId(input: {
    tenantId: string;
    roleIds: string[];
  }): Promise<string | null>;
  findInvalidAssignmentId(input: {
    tenantId: string;
    assignmentIds: string[];
  }): Promise<string | null>;
  findInvalidScopeId(input: {
    tenantId: string;
    scopeIds: string[];
  }): Promise<string | null>;
  findInvalidDocumentId(input: {
    tenantId: string;
    documentIds: string[];
  }): Promise<string | null>;
  findInvalidPermissionKey(input: {
    permissionKeys: string[];
  }): Promise<string | null>;
  checkCapabilities(input: {
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

  async findActiveTenantMembership(input: {
    tenantId: string;
    userId: string;
  }): Promise<TenantMembership | null> {
    const row = await this.database
      .selectFrom("tenantMemberships")
      .selectAll()
      .where("tenantId", "=", input.tenantId)
      .where("userId", "=", input.userId)
      .where("status", "=", "active")
      .executeTakeFirst();
    return row ? mapMembership(row) : null;
  }

  async findInvalidActiveMembershipUserId(input: {
    tenantId: string;
    userIds: string[];
  }): Promise<string | null> {
    if (input.userIds.length === 0) {
      return null;
    }

    const invalid = await this.database
      .selectFrom(
        sql<{
          userId: string;
          inputOrder: number;
        }>`unnest(${input.userIds}::uuid[]) with ordinality`.as<"input">(
          sql`input(user_id, input_order)`,
        ),
      )
      .leftJoin("tenantMemberships", (join) =>
        join
          .on("tenantMemberships.tenantId", "=", input.tenantId)
          .onRef("tenantMemberships.userId", "=", "input.userId")
          .on("tenantMemberships.status", "=", "active"),
      )
      .select("input.userId")
      .where("tenantMemberships.userId", "is", null)
      .orderBy("input.inputOrder")
      .executeTakeFirst();

    return invalid?.userId ?? null;
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
    const row = await this.database
      .with("parent", (db) =>
        db
          .selectFrom("authScopes")
          .select("scopeId")
          .where("tenantId", "=", input.tenantId)
          .where("scopeId", "=", input.parentScopeId),
      )
      .with("scope", (db) =>
        db
          .insertInto("authScopes")
          .columns(["tenantId", "parentId", "type", "key", "name"])
          .expression(({ selectFrom, val }) =>
            selectFrom("parent").select([
              sql<string>`${input.tenantId}::uuid`.as("tenantId"),
              "parent.scopeId",
              val(input.type).as("type"),
              val(input.key ?? null).as("key"),
              val(input.name ?? null).as("name"),
            ]),
          )
          .returningAll(),
      )
      .with("closure", (db) =>
        db
          .insertInto("authScopeClosure")
          .columns(["tenantId", "ancestorId", "descendantId", "depth"])
          .expression(({ selectFrom, val }) =>
            selectFrom("authScopeClosure as ancestor")
              .innerJoin("scope", "scope.parentId", "ancestor.descendantId")
              .select([
                sql<string>`${input.tenantId}::uuid`.as("tenantId"),
                "ancestor.ancestorId",
                "scope.scopeId as descendantId",
                sql<number>`ancestor.depth + 1`.as("depth"),
              ])
              .where("ancestor.tenantId", "=", input.tenantId)
              .unionAll(
                selectFrom("scope").select([
                  sql<string>`${input.tenantId}::uuid`.as("tenantId"),
                  "scope.scopeId as ancestorId",
                  "scope.scopeId as descendantId",
                  val(0).as("depth"),
                ]),
              ),
          )
          .returning("descendantId"),
      )
      .selectFrom("scope")
      .selectAll()
      .executeTakeFirst();

    if (!row) {
      throw new AuthRbacError("AUTH_SCOPE_NOT_FOUND", "Scope not found", {
        tenantId: input.tenantId,
        scopeId: input.parentScopeId,
      });
    }
    return mapScope(row);
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

    await this.database
      .insertInto("rolePermissions")
      .columns(["tenantId", "roleId", "permissionId"])
      .expression(({ selectFrom, val }) =>
        selectFrom(
          sql<{
            key: string;
          }>`unnest(${input.permissionKeys}::text[])`.as<"input">(
            sql`input(key)`,
          ),
        )
          .innerJoin("permissions", "permissions.key", "input.key")
          .select([
            val(input.tenantId).as("tenantId"),
            val(input.roleId).as("roleId"),
            "permissions.permissionId",
          ]),
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

    type Assignment = (typeof input.assignments)[number];
    const { userId, roleId, scopeId } = pivotToColumns(input.assignments);

    await this.database
      .insertInto("userRoleAssignments")
      .columns(["tenantId", "userId", "roleId", "scopeId"])
      .expression(({ selectFrom, val }) =>
        selectFrom(
          sql<Assignment>`unnest(${userId}::uuid[], ${roleId}::uuid[], ${scopeId}::uuid[])`.as<"assignments">(
            sql`assignments(user_id, role_id, scope_id)`,
          ),
        ).select([
          val(input.tenantId).as("tenantId"),
          "assignments.userId",
          "assignments.roleId",
          "assignments.scopeId",
        ]),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  async findDeniedRolePermission(input: {
    tenantId: string;
    roleId: string;
    userId: string;
    targetScopeId: string;
  }): Promise<string | null> {
    const denied = await this.database
      .selectFrom("rolePermissions as targetRolePermission")
      .innerJoin(
        "permissions as targetPermission",
        "targetPermission.permissionId",
        "targetRolePermission.permissionId",
      )
      .select("targetPermission.key")
      .where("targetRolePermission.tenantId", "=", input.tenantId)
      .where("targetRolePermission.roleId", "=", input.roleId)
      .where(({ exists, lit, not, selectFrom }) =>
        not(
          exists(
            selectFrom("tenantMemberships as membership")
              .innerJoin("userRoleAssignments as assignment", (join) =>
                join
                  .onRef("assignment.tenantId", "=", "membership.tenantId")
                  .onRef("assignment.userId", "=", "membership.userId"),
              )
              .innerJoin("rolePermissions as actorRolePermission", (join) =>
                join
                  .onRef(
                    "actorRolePermission.tenantId",
                    "=",
                    "assignment.tenantId",
                  )
                  .onRef(
                    "actorRolePermission.roleId",
                    "=",
                    "assignment.roleId",
                  ),
              )
              .innerJoin(
                "permissions as actorPermission",
                "actorPermission.permissionId",
                "actorRolePermission.permissionId",
              )
              .innerJoin("authScopeClosure as closure", (join) =>
                join
                  .onRef("closure.tenantId", "=", "assignment.tenantId")
                  .onRef("closure.ancestorId", "=", "assignment.scopeId"),
              )
              .where("membership.tenantId", "=", input.tenantId)
              .where("membership.userId", "=", input.userId)
              .where("membership.status", "=", "active")
              .whereRef("actorPermission.key", "=", "targetPermission.key")
              .where("closure.descendantId", "=", input.targetScopeId)
              .select(lit(1).as("_")),
          ),
        ),
      )
      .orderBy("targetPermission.key")
      .executeTakeFirst();
    return denied?.key ?? null;
  }

  async findInvalidRoleId(input: {
    tenantId: string;
    roleIds: string[];
  }): Promise<string | null> {
    if (input.roleIds.length === 0) {
      return null;
    }

    const invalid = await this.database
      .selectFrom(
        sql<{
          roleId: string;
          inputOrder: number;
        }>`unnest(${input.roleIds}::uuid[]) with ordinality`.as<"input">(
          sql`input(role_id, input_order)`,
        ),
      )
      .leftJoin("roles", (join) =>
        join
          .on("roles.tenantId", "=", input.tenantId)
          .onRef("roles.roleId", "=", "input.roleId"),
      )
      .select("input.roleId")
      .where("roles.roleId", "is", null)
      .orderBy("input.inputOrder")
      .executeTakeFirst();

    return invalid?.roleId ?? null;
  }

  async findInvalidAssignmentId(input: {
    tenantId: string;
    assignmentIds: string[];
  }): Promise<string | null> {
    if (input.assignmentIds.length === 0) {
      return null;
    }

    const invalid = await this.database
      .selectFrom(
        sql<{
          assignmentId: string;
          inputOrder: number;
        }>`unnest(${input.assignmentIds}::uuid[]) with ordinality`.as<"input">(
          sql`input(assignment_id, input_order)`,
        ),
      )
      .leftJoin("userRoleAssignments", (join) =>
        join
          .on("userRoleAssignments.tenantId", "=", input.tenantId)
          .onRef("userRoleAssignments.assignmentId", "=", "input.assignmentId"),
      )
      .select("input.assignmentId")
      .where("userRoleAssignments.assignmentId", "is", null)
      .orderBy("input.inputOrder")
      .executeTakeFirst();

    return invalid?.assignmentId ?? null;
  }

  async findInvalidScopeId(input: {
    tenantId: string;
    scopeIds: string[];
  }): Promise<string | null> {
    if (input.scopeIds.length === 0) {
      return null;
    }

    const invalid = await this.database
      .selectFrom(
        sql<{
          scopeId: string;
          inputOrder: number;
        }>`unnest(${input.scopeIds}::uuid[]) with ordinality`.as<"input">(
          sql`input(scope_id, input_order)`,
        ),
      )
      .leftJoin("authScopes", (join) =>
        join
          .on("authScopes.tenantId", "=", input.tenantId)
          .onRef("authScopes.scopeId", "=", "input.scopeId"),
      )
      .select("input.scopeId")
      .where("authScopes.scopeId", "is", null)
      .orderBy("input.inputOrder")
      .executeTakeFirst();

    return invalid?.scopeId ?? null;
  }

  async findInvalidDocumentId(input: {
    tenantId: string;
    documentIds: string[];
  }): Promise<string | null> {
    if (input.documentIds.length === 0) {
      return null;
    }

    const invalid = await this.database
      .selectFrom(
        sql<{
          documentId: string;
          inputOrder: number;
        }>`unnest(${input.documentIds}::uuid[]) with ordinality`.as<"input">(
          sql`input(document_id, input_order)`,
        ),
      )
      .leftJoin("documents", (join) =>
        join
          .on("documents.tenantId", "=", input.tenantId)
          .onRef("documents.id", "=", "input.documentId"),
      )
      .select("input.documentId")
      .where("documents.id", "is", null)
      .orderBy("input.inputOrder")
      .executeTakeFirst();

    return invalid?.documentId ?? null;
  }

  async findInvalidPermissionKey(input: {
    permissionKeys: string[];
  }): Promise<string | null> {
    if (input.permissionKeys.length === 0) {
      return null;
    }

    const invalid = await this.database
      .selectFrom(
        sql<{
          permissionKey: string;
          inputOrder: number;
        }>`unnest(${input.permissionKeys}::text[]) with ordinality`.as<"input">(
          sql`input(permission_key, input_order)`,
        ),
      )
      .leftJoin("permissions", "permissions.key", "input.permissionKey")
      .select("input.permissionKey")
      .where("permissions.permissionId", "is", null)
      .orderBy("input.inputOrder")
      .executeTakeFirst();

    return invalid?.permissionKey ?? null;
  }

  async checkCapabilities(input: {
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

    const { capability, targetScopeId } = pivotToColumns(input.checks);
    type Check = (typeof input.checks)[number] & { inputOrder: number };

    const accessResults = await this.database
      .selectFrom(
        sql<Check>`unnest(${capability}::text[], ${targetScopeId}::uuid[]) with ordinality`.as<"input">(
          sql`input(capability, target_scope_id, input_order)`,
        ),
      )
      .innerJoin("permissions as p", "permissionId", "capability")
      .leftJoin("rolePermissions as rp", (join) =>
        join
          .onRef("rp.permissionId", "=", "p.permissionId")
          .on("rp.tenantId", "=", input.tenantId),
      )
      .innerJoin("userRoleAssignments as rs", (join) =>
        join
          .onRef("rs.roleId", "=", "rp.roleId")
          .on("rs.userId", "=", input.userId)
          .on("rs.tenantId", "=", input.tenantId),
      )
      .innerJoin("tenantMemberships as m", (join) =>
        join
          .onRef("m.userId", "=", "rs.userId")
          .onRef("m.tenantId", "=", "rs.tenantId"),
      )
      .innerJoin("authScopeClosure as closure", (join) =>
        join
          .onRef("ancestorId", "=", "rs.scopeId")
          .onRef("descendantId", "=", ({ fn, val }) =>
            fn.coalesce("targetScopeId", val(rootScopeId)),
          )
          .on("closure.tenantId", "=", input.tenantId),
      )
      .select((eb) => eb("descendantId", "is not", null).as("allowed"))
      .execute();

    return accessResults.map((access) => Boolean(access.allowed.valueOf()));
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

function mapMembership(
  row: Selectable<TenantMembershipsTable>,
): TenantMembership {
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
