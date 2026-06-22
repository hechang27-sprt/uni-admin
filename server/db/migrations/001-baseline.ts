import { sql, type Kysely } from "kysely";
import type { Database } from "../schema";

const SYSTEM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const BOTTOM_SCOPE_ID = SYSTEM_TENANT_ID;

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("tenants")
    .addColumn("id", "uuid", (col) =>
      col
        .primaryKey()
        .defaultTo(sql`gen_random_uuid()`)
        .notNull(),
    )
    .addColumn("name", "text")
    .execute();
  await db
    .insertInto("tenants")
    .values({
      id: SYSTEM_TENANT_ID,
      name: "System",
    })
    .onConflict((conflict) => conflict.column("id").doNothing())
    .execute();

  await db.schema
    .createTable("apps")
    .addColumn("app_id", "uuid", (col) =>
      col
        .primaryKey()
        .defaultTo(sql`gen_random_uuid()`)
        .notNull(),
    )
    .addColumn("key", "text", (col) => col.notNull())
    .addColumn("name", "text")
    .addColumn("config", "jsonb")
    .addColumn("created_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updated_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  await db.schema
    .createTable("tenant_apps")
    .addColumn("tenant_id", "uuid", (col) =>
      col.references("tenants.id").onDelete("cascade").notNull(),
    )
    .addColumn("app_id", "uuid", (col) =>
      col.references("apps.app_id").onDelete("cascade").notNull(),
    )
    .addColumn("config", "jsonb")
    .addColumn("enabled_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addPrimaryKeyConstraint("tenant_apps_pk", ["tenant_id", "app_id"])
    .execute();

  await db.schema
    .createTable("collections")
    .addColumn("collection_id", "uuid", (col) =>
      col
        .primaryKey()
        .defaultTo(sql`gen_random_uuid()`)
        .notNull(),
    )
    .addColumn("app_id", "uuid", (col) =>
      col.references("apps.app_id").onDelete("cascade").notNull(),
    )
    .addColumn("key", "text", (col) => col.notNull())
    .addColumn("definition_key", "text", (col) => col.notNull())
    .addColumn("name", "text")
    .addColumn("schema_version", "integer", (col) => col.notNull())
    .addColumn("config", "jsonb")
    .addColumn("created_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updated_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addUniqueConstraint("collections_app_collection_unique", [
      "app_id",
      "collection_id",
    ])
    .execute();

  await db.schema
    .createTable("users")
    .addColumn("user_id", "uuid", (col) =>
      col
        .primaryKey()
        .defaultTo(sql`gen_random_uuid()`)
        .notNull(),
    )
    .addColumn("display_name", "text")
    .addColumn("status", "text", (col) =>
      col.defaultTo(sql`'active'`).notNull(),
    )
    .addColumn("created_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updated_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  await db.schema
    .createTable("user_password_credentials")
    .addColumn("user_id", "uuid", (col) =>
      col
        .primaryKey()
        .references("users.user_id")
        .onDelete("cascade")
        .notNull(),
    )
    .addColumn("username", "text", (col) => col.notNull())
    .addColumn("password_hash", "text", (col) => col.notNull())
    .addColumn("created_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updated_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  await db.schema
    .createTable("tenant_memberships")
    .addColumn("tenant_id", "uuid", (col) =>
      col.references("tenants.id").onDelete("cascade").notNull(),
    )
    .addColumn("user_id", "uuid", (col) =>
      col.references("users.user_id").onDelete("cascade").notNull(),
    )
    .addColumn("status", "text", (col) =>
      col.defaultTo(sql`'active'`).notNull(),
    )
    .addColumn("created_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updated_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addPrimaryKeyConstraint("tenant_memberships_pk", ["tenant_id", "user_id"])
    .execute();

  await db.schema
    .createTable("auth_scopes")
    .addColumn("scope_id", "uuid", (col) =>
      col
        .primaryKey()
        .defaultTo(sql`gen_random_uuid()`)
        .notNull(),
    )
    .addColumn("tenant_id", "uuid", (col) =>
      col.references("tenants.id").onDelete("cascade").notNull(),
    )
    .addColumn("parent_id", "uuid", (col) =>
      col.references("auth_scopes.scope_id").onDelete("restrict"),
    )
    .addColumn("type", "text", (col) => col.notNull())
    .addColumn("key", "text")
    .addColumn("name", "text")
    .addColumn("created_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updated_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  await db.schema
    .createTable("auth_scope_closure")
    .addColumn("tenant_id", "uuid", (col) =>
      col.references("tenants.id").onDelete("cascade").notNull(),
    )
    .addColumn("ancestor_id", "uuid", (col) =>
      col.references("auth_scopes.scope_id").onDelete("cascade").notNull(),
    )
    .addColumn("descendant_id", "uuid", (col) =>
      col.references("auth_scopes.scope_id").onDelete("cascade").notNull(),
    )
    .addColumn("depth", "integer", (col) => col.notNull())
    .addPrimaryKeyConstraint("auth_scope_closure_pk", [
      "tenant_id",
      "ancestor_id",
      "descendant_id",
    ])
    .execute();
  await sql`
    insert into auth_scopes (scope_id, tenant_id, parent_id, type, key, name)
    values (
      ${BOTTOM_SCOPE_ID}::uuid,
      ${SYSTEM_TENANT_ID}::uuid,
      null,
      'system',
      '__bottom',
      'Bottom scope'
    )
    on conflict (scope_id) do nothing;
  `.execute(db);

  await sql`
    insert into auth_scope_closure (tenant_id, ancestor_id, descendant_id, depth)
    values (
      ${SYSTEM_TENANT_ID}::uuid,
      ${BOTTOM_SCOPE_ID}::uuid,
      ${BOTTOM_SCOPE_ID}::uuid,
      0
    )
    on conflict do nothing;
  `.execute(db);

  await sql`
    create or replace function maintain_auth_scope_closure()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.scope_id = '00000000-0000-0000-0000-000000000000'::uuid then
        return new;
      end if;
      insert into auth_scope_closure (tenant_id, ancestor_id, descendant_id, depth)
      values (
        new.tenant_id,
        '00000000-0000-0000-0000-000000000000'::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid,
        0
      )
      on conflict do nothing;

      insert into auth_scope_closure (tenant_id, ancestor_id, descendant_id, depth)
      values (
        new.tenant_id,
        new.scope_id,
        new.scope_id,
        0
      )
      on conflict do nothing;

      insert into auth_scope_closure (tenant_id, ancestor_id, descendant_id, depth)
      select
        ancestor.tenant_id,
        ancestor.ancestor_id,
        new.scope_id,
        ancestor.depth + 1
      from auth_scope_closure as ancestor
      where ancestor.tenant_id = new.tenant_id
        and ancestor.descendant_id = new.parent_id
      on conflict do nothing;

      insert into auth_scope_closure (tenant_id, ancestor_id, descendant_id, depth)
      values (
        new.tenant_id,
        new.scope_id,
        '00000000-0000-0000-0000-000000000000'::uuid,
        1
      )
      on conflict do nothing;

      return new;
    end;
    $$;
  `.execute(db);

  await sql`
    insert into auth_scope_closure (tenant_id, ancestor_id, descendant_id, depth)
    values (${SYSTEM_TENANT_ID}::uuid, ${BOTTOM_SCOPE_ID}::uuid, ${BOTTOM_SCOPE_ID}::uuid, 0)
    on conflict do nothing;
  `.execute(db);

  await sql`
    create trigger auth_scopes_maintain_bottom_scope_closure
    after insert on auth_scopes
    for each row
    execute function maintain_auth_scope_closure();
  `.execute(db);

  await db.schema
    .createTable("roles")
    .addColumn("role_id", "uuid", (col) =>
      col
        .primaryKey()
        .defaultTo(sql`gen_random_uuid()`)
        .notNull(),
    )
    .addColumn("tenant_id", "uuid", (col) =>
      col.references("tenants.id").onDelete("cascade").notNull(),
    )
    .addColumn("key", "text", (col) => col.notNull())
    .addColumn("name", "text")
    .addColumn("created_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updated_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  await db.schema
    .createTable("permissions")
    .addColumn("key", "text", (col) => col.primaryKey().notNull())
    .addColumn("app_id", "uuid", (col) =>
      col.references("apps.app_id").onDelete("cascade"),
    )
    .addColumn("collection_id", "uuid", (col) =>
      col.references("collections.collection_id").onDelete("cascade"),
    )
    .addColumn("capability_id", "text", (col) => col.notNull())
    .addColumn("source", "text", (col) => col.notNull())
    .addColumn("description", "text")
    .addColumn("resource_scope", "text")
    .addColumn("created_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updated_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  await db.schema
    .createTable("role_permissions")
    .addColumn("tenant_id", "uuid", (col) =>
      col.references("tenants.id").onDelete("cascade").notNull(),
    )
    .addColumn("role_id", "uuid", (col) =>
      col.references("roles.role_id").onDelete("cascade").notNull(),
    )
    .addColumn("permission_key", "text", (col) =>
      col.references("permissions.key").onDelete("cascade").notNull(),
    )
    .addColumn("created_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addPrimaryKeyConstraint("role_permissions_pk", [
      "tenant_id",
      "role_id",
      "permission_key",
    ])
    .execute();

  await db.schema
    .createTable("user_role_assignments")
    .addColumn("assignment_id", "uuid", (col) =>
      col
        .primaryKey()
        .defaultTo(sql`gen_random_uuid()`)
        .notNull(),
    )
    .addColumn("tenant_id", "uuid", (col) =>
      col.references("tenants.id").onDelete("cascade").notNull(),
    )
    .addColumn("user_id", "uuid", (col) =>
      col.references("users.user_id").onDelete("cascade").notNull(),
    )
    .addColumn("role_id", "uuid", (col) =>
      col.references("roles.role_id").onDelete("cascade").notNull(),
    )
    .addColumn("scope_id", "uuid", (col) =>
      col.references("auth_scopes.scope_id").onDelete("cascade").notNull(),
    )
    .addColumn("created_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  await db.schema
    .createTable("documents")
    .addColumn("id", "uuid", (col) =>
      col
        .primaryKey()
        .defaultTo(sql`gen_random_uuid()`)
        .notNull(),
    )
    .addColumn("tenant_id", "uuid", (col) =>
      col.references("tenants.id").onDelete("cascade").notNull(),
    )
    .addColumn("app_id", "uuid", (col) =>
      col.references("apps.app_id").onDelete("restrict").notNull(),
    )
    .addColumn("collection_id", "uuid", (col) => col.notNull())
    .addColumn("schema_version", "integer", (col) => col.notNull())
    .addColumn("data", "jsonb", (col) => col.notNull())
    .addColumn("auth_scope_id", "uuid", (col) =>
      col.references("auth_scopes.scope_id").onDelete("restrict").notNull(),
    )
    .addColumn("remote_source", "text")
    .addColumn("remote_id", "text")
    .addColumn("version", "integer", (col) => col.defaultTo(1).notNull())
    .addColumn("created_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updated_at", sql`timestamp with time zone`, (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("deleted_at", sql`timestamp with time zone`)
    .addForeignKeyConstraint(
      "documents_collection_identity_fk",
      ["app_id", "collection_id"],
      "collections",
      ["app_id", "collection_id"],
    )
    .addForeignKeyConstraint(
      "documents_tenant_app_fk",
      ["tenant_id", "app_id"],
      "tenant_apps",
      ["tenant_id", "app_id"],
    )
    .execute();

  await db.schema
    .createIndex("user_password_credentials_username_unique")
    .unique()
    .on("user_password_credentials")
    .column("username")
    .execute();

  await db.schema
    .createIndex("auth_scopes_tenant_key_unique")
    .unique()
    .on("auth_scopes")
    .columns(["tenant_id", "key"])
    .where("key", "is not", null)
    .execute();

  await db.schema
    .createIndex("auth_scopes_tenant_parent_idx")
    .on("auth_scopes")
    .columns(["tenant_id", "parent_id"])
    .execute();

  await db.schema
    .createIndex("auth_scope_closure_descendant_idx")
    .on("auth_scope_closure")
    .columns(["tenant_id", "descendant_id"])
    .execute();

  await db.schema
    .createIndex("roles_tenant_key_unique")
    .unique()
    .on("roles")
    .columns(["tenant_id", "key"])
    .execute();

  await db.schema
    .createIndex("apps_key_unique")
    .unique()
    .on("apps")
    .column("key")
    .execute();

  await db.schema
    .createIndex("collections_app_key_unique")
    .unique()
    .on("collections")
    .columns(["app_id", "key"])
    .execute();

  await db.schema
    .createIndex("permissions_key_unique")
    .unique()
    .on("permissions")
    .column("key")
    .execute();

  await db.schema
    .createIndex("user_role_assignments_scope_unique")
    .unique()
    .on("user_role_assignments")
    .columns(["tenant_id", "user_id", "role_id", "scope_id"])
    .execute();

  await db.schema
    .createIndex("user_role_assignments_user_idx")
    .on("user_role_assignments")
    .columns(["tenant_id", "user_id"])
    .execute();

  await db.schema
    .createIndex("documents_tenant_collection_deleted_idx")
    .on("documents")
    .columns(["tenant_id", "app_id", "collection_id", "deleted_at"])
    .execute();

  await db.schema
    .createIndex("documents_tenant_collection_auth_scope_idx")
    .on("documents")
    .columns(["tenant_id", "app_id", "collection_id", "auth_scope_id"])
    .execute();

  await db.schema
    .createIndex("documents_tenant_auth_scope_idx")
    .on("documents")
    .columns(["tenant_id", "auth_scope_id"])
    .execute();

  await db.schema
    .createIndex("documents_data_gin_idx")
    .on("documents")
    .column("data")
    .using("gin")
    .execute();

  await db.schema
    .createIndex("documents_remote_identity_unique")
    .unique()
    .on("documents")
    .columns([
      "tenant_id",
      "app_id",
      "collection_id",
      "remote_id",
      "remote_source",
    ])
    .where("remote_source", "is not", null)
    .where("remote_id", "is not", null)
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    drop trigger if exists auth_scopes_maintain_bottom_scope_closure on auth_scopes;
  `.execute(db);
  await sql`drop function if exists maintain_auth_scope_closure();`.execute(db);
  await db.schema.dropTable("documents").ifExists().cascade().execute();
  await db.schema
    .dropTable("user_role_assignments")
    .ifExists()
    .cascade()
    .execute();
  await db.schema.dropTable("role_permissions").ifExists().cascade().execute();
  await db.schema.dropTable("permissions").ifExists().cascade().execute();
  await db.schema.dropTable("collections").ifExists().cascade().execute();
  await db.schema.dropTable("tenant_apps").ifExists().cascade().execute();
  await db.schema.dropTable("apps").ifExists().cascade().execute();
  await db.schema.dropTable("roles").ifExists().cascade().execute();
  await db.schema
    .dropTable("auth_scope_closure")
    .ifExists()
    .cascade()
    .execute();
  await db.schema.dropTable("auth_scopes").ifExists().cascade().execute();
  await db.schema
    .dropTable("tenant_memberships")
    .ifExists()
    .cascade()
    .execute();
  await db.schema
    .dropTable("user_password_credentials")
    .ifExists()
    .cascade()
    .execute();
  await db.schema.dropTable("users").ifExists().cascade().execute();
  await db.schema.dropTable("tenants").ifExists().cascade().execute();
}
