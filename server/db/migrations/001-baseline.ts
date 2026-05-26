import { sql, type Kysely } from "kysely";

import type { Database } from "../schema";

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table tenants (
      id uuid primary key default gen_random_uuid() not null,
      name text
    )
  `.execute(db);
  await sql`
    create table users (
      user_id uuid primary key default gen_random_uuid() not null,
      display_name text,
      status text default 'active' not null,
      created_at timestamp with time zone default now() not null,
      updated_at timestamp with time zone default now() not null
    )
  `.execute(db);
  await sql`
    create table user_password_credentials (
      user_id uuid primary key not null references users(user_id) on delete cascade,
      username text not null,
      password_hash text not null,
      created_at timestamp with time zone default now() not null,
      updated_at timestamp with time zone default now() not null
    )
  `.execute(db);
  await sql`
    create table tenant_memberships (
      tenant_id uuid not null references tenants(id) on delete cascade,
      user_id uuid not null references users(user_id) on delete cascade,
      status text default 'active' not null,
      created_at timestamp with time zone default now() not null,
      updated_at timestamp with time zone default now() not null,
      constraint tenant_memberships_pk primary key (tenant_id, user_id)
    )
  `.execute(db);
  await sql`
    create table auth_scopes (
      scope_id uuid primary key default gen_random_uuid() not null,
      tenant_id uuid not null references tenants(id) on delete cascade,
      parent_id uuid references auth_scopes(scope_id) on delete restrict,
      type text not null,
      key text,
      name text,
      created_at timestamp with time zone default now() not null,
      updated_at timestamp with time zone default now() not null
    )
  `.execute(db);
  await sql`
    create table auth_scope_closure (
      tenant_id uuid not null references tenants(id) on delete cascade,
      ancestor_id uuid not null references auth_scopes(scope_id) on delete cascade,
      descendant_id uuid not null references auth_scopes(scope_id) on delete cascade,
      depth integer not null,
      constraint auth_scope_closure_pk primary key (
        tenant_id,
        ancestor_id,
        descendant_id
      )
    )
  `.execute(db);
  await sql`
    create table roles (
      role_id uuid primary key default gen_random_uuid() not null,
      tenant_id uuid not null references tenants(id) on delete cascade,
      key text not null,
      name text,
      created_at timestamp with time zone default now() not null,
      updated_at timestamp with time zone default now() not null
    )
  `.execute(db);
  await sql`
    create table permissions (
      permission_id uuid primary key default gen_random_uuid() not null,
      key text not null,
      source text not null,
      description text,
      created_at timestamp with time zone default now() not null,
      updated_at timestamp with time zone default now() not null
    )
  `.execute(db);
  await sql`
    create table role_permissions (
      tenant_id uuid not null references tenants(id) on delete cascade,
      role_id uuid not null references roles(role_id) on delete cascade,
      permission_id uuid not null references permissions(permission_id) on delete cascade,
      created_at timestamp with time zone default now() not null,
      constraint role_permissions_pk primary key (
        tenant_id,
        role_id,
        permission_id
      )
    )
  `.execute(db);
  await sql`
    create table user_role_assignments (
      assignment_id uuid primary key default gen_random_uuid() not null,
      tenant_id uuid not null references tenants(id) on delete cascade,
      user_id uuid not null references users(user_id) on delete cascade,
      role_id uuid not null references roles(role_id) on delete cascade,
      scope_id uuid not null references auth_scopes(scope_id) on delete cascade,
      created_at timestamp with time zone default now() not null
    )
  `.execute(db);
  await sql`
    create table documents (
      id uuid primary key default gen_random_uuid() not null,
      tenant_id uuid not null references tenants(id) on delete cascade,
      collection text not null,
      schema_version integer not null,
      data jsonb not null,
      auth_scope_id uuid references auth_scopes(scope_id) on delete restrict,
      remote_source text,
      remote_id text,
      version integer default 1 not null,
      created_at timestamp with time zone default now() not null,
      updated_at timestamp with time zone default now() not null,
      deleted_at timestamp with time zone
    )
  `.execute(db);

  await sql`create unique index user_password_credentials_username_unique on user_password_credentials (username)`.execute(db);
  await sql`create unique index auth_scopes_tenant_scope_unique on auth_scopes (tenant_id, scope_id)`.execute(db);
  await sql`create unique index auth_scopes_tenant_key_unique on auth_scopes (tenant_id, key) where key is not null`.execute(db);
  await sql`create index auth_scopes_tenant_parent_idx on auth_scopes (tenant_id, parent_id)`.execute(db);
  await sql`create index auth_scope_closure_descendant_idx on auth_scope_closure (tenant_id, descendant_id)`.execute(db);
  await sql`create unique index roles_tenant_key_unique on roles (tenant_id, key)`.execute(db);
  await sql`create unique index roles_tenant_role_unique on roles (tenant_id, role_id)`.execute(db);
  await sql`create unique index permissions_key_unique on permissions (key)`.execute(db);
  await sql`create unique index user_role_assignments_unique on user_role_assignments (tenant_id, user_id, role_id, scope_id)`.execute(db);
  await sql`create index user_role_assignments_user_idx on user_role_assignments (tenant_id, user_id)`.execute(db);
  await sql`create index documents_tenant_collection_idx on documents (tenant_id, collection)`.execute(db);
  await sql`create index documents_tenant_collection_deleted_idx on documents (tenant_id, collection, deleted_at)`.execute(db);
  await sql`create index documents_tenant_collection_auth_scope_idx on documents (tenant_id, collection, auth_scope_id)`.execute(db);
  await sql`create index documents_tenant_auth_scope_idx on documents (tenant_id, auth_scope_id)`.execute(db);
  await sql`create index documents_data_gin_idx on documents using gin (data)`.execute(db);
  await sql`
    create unique index documents_remote_identity_unique
    on documents (tenant_id, collection, remote_source, remote_id)
    where remote_source is not null and remote_id is not null
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists documents cascade`.execute(db);
  await sql`drop table if exists user_role_assignments cascade`.execute(db);
  await sql`drop table if exists role_permissions cascade`.execute(db);
  await sql`drop table if exists permissions cascade`.execute(db);
  await sql`drop table if exists roles cascade`.execute(db);
  await sql`drop table if exists auth_scope_closure cascade`.execute(db);
  await sql`drop table if exists auth_scopes cascade`.execute(db);
  await sql`drop table if exists tenant_memberships cascade`.execute(db);
  await sql`drop table if exists user_password_credentials cascade`.execute(db);
  await sql`drop table if exists users cascade`.execute(db);
  await sql`drop table if exists tenants cascade`.execute(db);
}
