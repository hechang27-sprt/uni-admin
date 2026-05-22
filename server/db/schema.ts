import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import type { JsonObject } from "../data/documents/types";

export const tenantsTable = pgTable("tenants", {
  id: uuid().primaryKey().defaultRandom(),
  name: text(),
});

export const usersTable = pgTable("users", {
  userId: uuid("user_id").primaryKey().defaultRandom(),
  displayName: text("display_name"),
  status: text().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userPasswordCredentialsTable = pgTable(
  "user_password_credentials",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => usersTable.userId, { onDelete: "cascade" }),
    username: text().notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_password_credentials_username_unique").on(table.username),
  ],
);

export const tenantMembershipsTable = pgTable(
  "tenant_memberships",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.userId, { onDelete: "cascade" }),
    status: text().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "tenant_memberships_pk",
      columns: [table.tenantId, table.userId],
    }),
  ],
);

export const authScopesTable = pgTable(
  "auth_scopes",
  {
    scopeId: uuid("scope_id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => authScopesTable.scopeId,
      { onDelete: "restrict" },
    ),
    type: text().notNull(),
    key: text(),
    name: text(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_scopes_tenant_scope_unique").on(
      table.tenantId,
      table.scopeId,
    ),
    uniqueIndex("auth_scopes_tenant_key_unique")
      .on(table.tenantId, table.key)
      .where(sql`${table.key} is not null`),
    index("auth_scopes_tenant_parent_idx").on(table.tenantId, table.parentId),
  ],
);

export const authScopeClosureTable = pgTable(
  "auth_scope_closure",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    ancestorId: uuid("ancestor_id")
      .notNull()
      .references(() => authScopesTable.scopeId, { onDelete: "cascade" }),
    descendantId: uuid("descendant_id")
      .notNull()
      .references(() => authScopesTable.scopeId, { onDelete: "cascade" }),
    depth: integer().notNull(),
  },
  (table) => [
    primaryKey({
      name: "auth_scope_closure_pk",
      columns: [table.tenantId, table.ancestorId, table.descendantId],
    }),
    index("auth_scope_closure_descendant_idx").on(
      table.tenantId,
      table.descendantId,
    ),
  ],
);

export const rolesTable = pgTable(
  "roles",
  {
    roleId: uuid("role_id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    key: text().notNull(),
    name: text(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("roles_tenant_key_unique").on(table.tenantId, table.key),
    uniqueIndex("roles_tenant_role_unique").on(table.tenantId, table.roleId),
  ],
);

export const permissionsTable = pgTable(
  "permissions",
  {
    permissionId: uuid("permission_id").primaryKey().defaultRandom(),
    key: text().notNull(),
    source: text().notNull(),
    description: text(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("permissions_key_unique").on(table.key)],
);

export const rolePermissionsTable = pgTable(
  "role_permissions",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => rolesTable.roleId, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissionsTable.permissionId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "role_permissions_pk",
      columns: [table.tenantId, table.roleId, table.permissionId],
    }),
  ],
);

export const userRoleAssignmentsTable = pgTable(
  "user_role_assignments",
  {
    assignmentId: uuid("assignment_id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.userId, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => rolesTable.roleId, { onDelete: "cascade" }),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => authScopesTable.scopeId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_role_assignments_unique").on(
      table.tenantId,
      table.userId,
      table.roleId,
      table.scopeId,
    ),
    index("user_role_assignments_user_idx").on(table.tenantId, table.userId),
  ],
);

export const documentsTable = pgTable(
  "documents",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    collection: text().notNull(),
    schemaVersion: integer("schema_version").notNull(),
    data: jsonb().$type<JsonObject>().notNull(),
    authScopeId: uuid("auth_scope_id").references(
      () => authScopesTable.scopeId,
      { onDelete: "restrict" },
    ),
    remoteSource: text("remote_source"),
    remoteId: text("remote_id"),
    version: integer().notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("documents_tenant_collection_idx").on(
      table.tenantId,
      table.collection,
    ),
    index("documents_tenant_collection_deleted_idx").on(
      table.tenantId,
      table.collection,
      table.deletedAt,
    ),
    index("documents_tenant_collection_auth_scope_idx").on(
      table.tenantId,
      table.collection,
      table.authScopeId,
    ),
    index("documents_tenant_auth_scope_idx").on(
      table.tenantId,
      table.authScopeId,
    ),
    index("documents_data_gin_idx").using("gin", table.data),
    uniqueIndex("documents_remote_identity_unique")
      .on(table.tenantId, table.collection, table.remoteSource, table.remoteId)
      .where(
        sql`${table.remoteSource} is not null and ${table.remoteId} is not null`,
      ),
  ],
);
