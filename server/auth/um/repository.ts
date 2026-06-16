/* oxlint-disable typescript/unbound-method -- Kysely expression-builder callback methods are used only to build SQL AST nodes. */
import { inject, injectable } from "inversify";
import { sql, type Selectable, type Transaction } from "kysely";

import {
  DEFAULT_APP_KEY,
  type AuthScopesTable,
  type Database,
  type PermissionsTable,
  type RolesTable,
  type TenantMembershipsTable,
  type UserPasswordCredentialsTable,
  type UsersTable,
} from "#server/db/schema";
import { AuthRbacError } from "./errors";
import { buildPermissionKey } from "./permission-key";
import {
  type AuthScope,
  type AuthUser,
  type CapabilityAccessCheck,
  type CapabilityEvaluation,
  type Permission,
  permissionDefinitionInputSchema,
  type PermissionDefinitionInput,
  type Role,
  type TenantMembership,
  type UsernamePasswordCredential,
  type ResolvedPermissionDefinition,
  resourceScopeModeSchema,
} from "./types";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import { selectGrantedPermissions, selectTenantUsers } from "../../db/query";
import { pivotToColumns } from "../../utils/pivot";
import { unnest } from "../../utils/unnest";
import { uniq } from "es-toolkit";

export const tenantRootScopeKey = "__tenant_root";
export const ADMIN_TENANT_OVERRIDE_KEY = "admin:tenant:owner";

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
    activeUser?: boolean;
    activeMember?: boolean;
  }): Promise<TenantMembership | null>;
  findInvalidActiveMembershipUserId(input: {
    tenantId: string;
    userIds: string[];
  }): Promise<string | null>;
  ensureTenantRootScope(tenantId: string): Promise<AuthScope>;
  findTenantRootScope(tenantId: string): Promise<AuthScope | null>;
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
  assignPermissionsToRole(input: {
    tenantId: string;
    roleId: string;
    permissionKeys: string[];
  }): Promise<void>;
  assignRoles(input: {
    tenantId: string;
    assignments: {
      userId: string;
      roleId: string;
      scopeId: string | null;
    }[];
  }): Promise<void>;
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
    userId?: string;
    checks: CapabilityAccessCheck[];
  }): Promise<CapabilityEvaluation[]>;
  listGrantedScopeIdsForCapability(input: {
    tenantId: string;
    userId: string;
    capability: string;
  }): Promise<Array<string | null>>;
}

@injectable()
export class KyselyAuthRbacRepository implements AuthRbacRepository {
  constructor(
    @inject(SERVER_DI_TYPES.DatabaseClient)
    private readonly database: DatabaseClient,
  ) {}

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
      .selectFrom(selectTenantUsers().selectAll("tu").as("member"))
      .selectAll()
      .where("tenantId", "=", input.tenantId)
      .where("userId", "=", input.userId)
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
        unnest(
          "input",
          { userId: input.userIds },
          { types: { userId: "uuid" }, withOrdinality: "inputOrder" },
        ),
      )
      .leftJoin(
        selectTenantUsers().select(["tu.tenantId", "tu.userId"]).as("tu"),
        (join) =>
          join
            .on("tu.tenantId", "=", input.tenantId)
            .onRef("tu.userId", "=", "input.userId"),
      )
      .select("input.userId")
      .where("tu.userId", "is", null)
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

    const values = await this.resolvePermissionValues(input);

    const now = new Date();
    const rows = await this.database
      .insertInto("permissions")
      .values(values)
      .onConflict((conflict) =>
        conflict.column("key").doUpdateSet(({ ref }) => ({
          appId: ref("excluded.appId"),
          collectionId: ref("excluded.collectionId"),
          capabilityId: ref("excluded.capabilityId"),
          source: ref("excluded.source"),
          description: ref("excluded.description"),
          resourceScope: ref("excluded.resourceScope"),
          updatedAt: now,
        })),
      )
      .returningAll()
      .execute();
    return rows.map((row) => mapPermission(row));
  }

  async assignPermissionsToRole(input: {
    tenantId: string;
    roleId: string;
    permissionKeys: string[];
  }): Promise<void> {
    if (input.permissionKeys.length === 0) {
      return;
    }

    await this.database
      .insertInto("rolePermissions")
      .columns(["tenantId", "roleId", "permissionKey"])
      .expression(({ selectFrom, val }) =>
        selectFrom(
          unnest(
            "input",
            { key: input.permissionKeys },
            { types: { key: "text" } },
          ),
        )
          .innerJoin("permissions", "permissions.key", "input.key")
          .select([
            val(input.tenantId).as("tenantId"),
            val(input.roleId).as("roleId"),
            "permissions.key as permissionKey",
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
      scopeId: string | null;
    }[];
  }): Promise<void> {
    if (input.assignments.length === 0) {
      return;
    }

    const { userId, roleId, scopeId } = pivotToColumns(input.assignments);

    await this.database
      .insertInto("userRoleAssignments")
      .columns(["tenantId", "userId", "roleId", "scopeId"])
      .expression(({ selectFrom, val }) =>
        selectFrom(
          unnest(
            "assignments",
            { userId, roleId, scopeId },
            {
              types: { userId: "uuid", roleId: "uuid", scopeId: "uuid" },
            },
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

  async findInvalidRoleId(input: {
    tenantId: string;
    roleIds: string[];
  }): Promise<string | null> {
    if (input.roleIds.length === 0) {
      return null;
    }

    const invalid = await this.database
      .selectFrom(
        unnest(
          "input",
          { roleId: input.roleIds },
          { types: { roleId: "uuid" }, withOrdinality: "inputOrder" },
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
        unnest(
          "input",
          { assignmentId: input.assignmentIds },
          { types: { assignmentId: "uuid" }, withOrdinality: "inputOrder" },
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
        unnest(
          "input",
          { scopeId: input.scopeIds },
          { types: { scopeId: "uuid" }, withOrdinality: "inputOrder" },
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
        unnest(
          "input",
          { documentId: input.documentIds },
          { types: { documentId: "uuid" }, withOrdinality: "inputOrder" },
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
        unnest(
          "input",
          { permissionKey: input.permissionKeys },
          { types: { permissionKey: "text" }, withOrdinality: "inputOrder" },
        ),
      )
      .leftJoin("permissions", "permissions.key", "input.permissionKey")
      .select("input.permissionKey")
      .where("permissions.key", "is", null)
      .orderBy("input.inputOrder")
      .executeTakeFirst();

    return invalid?.permissionKey ?? null;
  }

  async checkCapabilities(input: {
    tenantId: string;
    userId?: string;
    checks: CapabilityAccessCheck[];
  }): Promise<CapabilityEvaluation[]> {
    if (input.checks.length === 0) {
      return [];
    }
    const { scopeId: rootScopeId } = await this.ensureTenantRootScope(
      input.tenantId,
    );

    if (!input.userId && input.checks.some(({ userId }) => !userId)) {
      throw new Error("Capability checks require a userId");
    }

    const checkInputs = input.checks.map((check) => ({
      userId: check.userId,
      targetScopeIds: check.targetScopeIds,
      override: check.override,
      capabilities: check.capabilities ?? [],
      roleIds: check.roleIds ?? [],
    }));
    const { userId, targetScopeIds, override, capabilities, roleIds } =
      pivotToColumns(checkInputs);

    const accessResults = await this.database
      .with(
        "granted",
        selectGrantedPermissions().$call((qb) => qb),
      )
      .selectFrom(({ selectFrom }) =>
        selectFrom(
          unnest(
            "input",
            {
              userId,
              targetScopeIds,
              override,
              capabilities,
              roleIds,
            },
            {
              withOrdinality: "checkOrder",
              jsonb: ["targetScopeIds", "capabilities", "roleIds"],
              types: {
                userId: "uuid",
              },
            },
          ),
        )
          .select(({ fn, val }) => [
            fn.coalesce("userId", val(input.userId)).$notNull().as("userId"),
            "targetScopeIds",
            "override",
            "capabilities",
            "roleIds",
            "checkOrder",
          ])
          .as("input"),
      )
      .leftJoin("granted as g1", (join) =>
        join
          .on("g1.tenantId", "=", input.tenantId)
          .onRef("g1.userId", "=", "input.userId")
          .onRef("g1.permissionKey", "=", "input.override")
          .on("g1.descendantId", "=", rootScopeId),
      )
      .innerJoinLateral(
        ({ selectFrom, ref, lit }) =>
          selectFrom(() =>
            selectFrom(
              unnest(
                "directCap",
                {
                  capability: ref("input.capabilities"),
                },
                {
                  jsonbText: ["capability"],
                  withOrdinality: "capabilityOrder",
                },
              ),
            )
              .select([
                "directCap.capability",
                lit(null).$castTo<string>().as("permissionKey"),
                lit(null).$castTo<string>().as("roleId"),
                "directCap.capabilityOrder",
                lit<number>(0).as("sourceOrder"),
              ])
              .unionAll(() =>
                selectFrom(
                  unnest(
                    "roleInput",
                    {
                      roleId: ref("input.roleIds"),
                    },
                    {
                      jsonbText: ["roleId"],
                      withOrdinality: "roleOrder",
                    },
                  ),
                )
                  .innerJoin("rolePermissions as rp", (join) =>
                    join
                      .on("rp.tenantId", "=", input.tenantId)
                      .on(
                        "rp.roleId",
                        "=",
                        sql<string>`role_input.role_id::uuid`,
                      ),
                  )
                  .innerJoin("permissions as p", "p.key", "rp.permissionKey")
                  .select([
                    "p.key as capability",
                    "p.key as permissionKey",
                    sql<string>`role_input.role_id::uuid`.as("roleId"),
                    sql<number>`1000000 + role_input.role_order`.as(
                      "capabilityOrder",
                    ),
                    lit<number>(1).as("sourceOrder"),
                  ]),
              )
              .as("cap"),
          )
            .innerJoinLateral(
              () =>
                selectFrom(
                  unnest(
                    "t",
                    {
                      targetScopeId: ref("input.targetScopeIds"),
                    },
                    {
                      withOrdinality: "scopeOrder",
                      jsonbText: ["targetScopeId"],
                    },
                  ),
                )
                  .select((eb) => [
                    "scopeOrder",
                    eb
                      .cast<string>("targetScopeId", "uuid")
                      .as("targetScopeId"),
                  ])
                  .as("scopeInput"),
              (join) => join.onTrue(),
            )
            .leftJoin("permissions as directPermission", (join) =>
              join.onRef("directPermission.key", "=", "cap.capability"),
            )
            .leftJoin("granted as g2", (join) =>
              join
                .on("g2.tenantId", "=", input.tenantId)
                .onRef("g2.userId", "=", "input.userId")
                .onRef("g2.permissionKey", "=", "cap.capability")
                .on((eb) =>
                  eb.or([
                    eb(
                      "g2.descendantId",
                      "=",
                      eb.ref("scopeInput.targetScopeId"),
                    ), // null aware
                    eb("scopeInput.targetScopeId", "is", null),
                  ]),
                ),
            )
            .select(() => [
              sql<CapabilityEvaluation["missingCaps"]>`
                coalesce(
                  jsonb_agg(
                    jsonb_build_object(
                      'capability', cap.capability,
                      'permissionKey', coalesce(cap.permission_key, direct_permission.key),
                      'roleId', cap.role_id,
                      'targetScopeId', scope_input.target_scope_id
                    )
                    order by
                      cap.source_order,
                      cap.capability_order,
                      cap.capability,
                      scope_input.scope_order,
                      scope_input.target_scope_id
                  ) filter (
                    where g2.permission_key is null
                  ),
                  '[]'::jsonb
                )
              `.as("missingCaps"),
              sql<boolean>`
                coalesce(
                  bool_and(g2.permission_key is not null),
                  true
                )
              `.as("hasAllCaps"),
            ])
            .as("caps"),
        (join) => join.onTrue(),
      )
      .select(({ eb, or, ref }) => [
        "input.userId",
        eb("g1.permissionKey", "is not", null)
          .$castTo<boolean>()
          .as("hasOverride"),
        ref("caps.missingCaps").as("missingCaps"),
        or([eb("g1.permissionKey", "is not", null), ref("caps.hasAllCaps")])
          .$castTo<boolean>()
          .as("allowed"),
      ])
      .orderBy("input.checkOrder")
      .execute();

    return accessResults satisfies CapabilityEvaluation[];
  }

  async listGrantedScopeIdsForCapability(input: {
    tenantId: string;
    userId: string;
    capability: string;
  }): Promise<Array<string | null>> {
    const rows = await this.database
      .selectFrom(() =>
        selectGrantedPermissions()
          .where("tu.tenantId", "=", input.tenantId)
          .where("tu.userId", "=", input.userId)
          .where("p.key", "=", input.capability)
          .clearSelect()
          .select("assigned.scopeId as scopeId")
          .distinct()
          .as("_"),
      )
      .selectAll()
      .execute();

    return uniq(rows.map((row) => row.scopeId));
  }

  private async resolvePermissionValues(
    permissions: PermissionDefinitionInput[],
  ): Promise<ResolvedPermissionDefinition[]> {
    const normalizedPermissionDefinitionSchema =
      permissionDefinitionInputSchema.required({
        capabilityId: true,
      });
    const normalizedPermissions = permissions.map((permission) => ({
      ...permission,
      capabilityId:
        permission.capabilityId ?? inferCapabilityId(permission.key),
    }));
    const {
      key,
      appKey,
      collectionKey,
      capabilityId,
      source,
      description,
      resourceScope,
    } = pivotToColumns(
      normalizedPermissions,
      normalizedPermissionDefinitionSchema,
    );

    const rows = await this.database
      .selectFrom(({ selectFrom }) =>
        selectFrom(
          unnest(
            "input",
            {
              key,
              appKey,
              collectionKey,
              capabilityId,
              source,
              description,
              resourceScope,
            },
            { withOrdinality: "inputOrder" },
          ),
        )
          .selectAll("input")
          .select(({ eb, val, fn }) =>
            eb
              .case()
              .when("input.collectionKey", "is not", null)
              .then(fn.coalesce("input.appKey", val(DEFAULT_APP_KEY)))
              .elseRef("input.appKey")
              .end()
              .as("normalizedAppKey"),
          )
          .as("input"),
      )
      .leftJoin("apps", "apps.key", "input.normalizedAppKey")
      .leftJoin("collections", (join) =>
        join
          .onRef("collections.appId", "=", "apps.appId")
          .onRef("collections.key", "=", "input.collectionKey"),
      )
      .selectAll("input")
      .select(({ eb, ref }) => [
        "apps.appId as resolvedAppId",
        "collections.collectionId as resolvedCollectionId",
        eb
          .case()
          .when("input.appKey", "is not", null)
          .then(
            sql<string>`concat(${ref("apps.appId")}, ':', ${ref("input.capabilityId")})`,
          )
          .else(
            sql<string>`coalesce(${ref("input.key")}, concat(${ref("input.source")}, ':', ${ref("input.capabilityId")}))`,
          )
          .end()
          .as("resolvedKey"),
      ])
      .orderBy("input.inputOrder")
      .execute();

    return rows.map((row) => {
      let resolvedKey = row.resolvedKey;

      if (row.collectionKey) {
        if (!row.resolvedAppId || !row.resolvedCollectionId) {
          throw new AuthRbacError(
            "AUTH_PERMISSION_NOT_FOUND",
            "Permission definition requires a valid collection",
            { permissionKey: row.key ?? undefined },
          );
        }

        resolvedKey = buildPermissionKey(
          row.resolvedAppId,
          row.resolvedCollectionId,
          row.capabilityId,
        );
      }

      if (row.appKey && !row.resolvedAppId) {
        throw new AuthRbacError(
          "AUTH_PERMISSION_NOT_FOUND",
          "Permission definition requires a valid app",
          { permissionKey: row.key ?? undefined },
        );
      }

      return {
        key: resolvedKey,
        appId: row.collectionKey || row.appKey ? row.resolvedAppId : null,
        collectionId: row.collectionKey ? row.resolvedCollectionId : null,
        capabilityId: row.capabilityId,
        source: row.source,
        description: row.description,
        resourceScope: row.resourceScope
          ? resourceScopeModeSchema.parse(row.resourceScope)
          : null,
      };
    });
  }

  async findTenantRootScope(
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

function inferCapabilityId(permissionKey: string | undefined): string {
  if (permissionKey?.startsWith("admin:")) {
    return permissionKey.slice("admin:".length);
  }
  if (permissionKey?.startsWith("global:")) {
    return permissionKey.slice("global:".length);
  }
  if (permissionKey) {
    return permissionKey;
  }
  throw new AuthRbacError(
    "AUTH_PERMISSION_NOT_FOUND",
    "Permission definition requires a key or capability id",
    { permissionKey },
  );
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
    resourceScope: row.resourceScope
      ? resourceScopeModeSchema.parse(row.resourceScope)
      : null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
