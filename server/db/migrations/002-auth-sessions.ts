import { sql, type Kysely } from "kysely";
import type { Database } from "../schema";

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create unlogged table auth_sessions (
      token_hash text primary key,
      user_id uuid not null references users(user_id) on delete cascade,
      tenant_id uuid references tenants(id) on delete cascade,
      created_at timestamp with time zone not null default now(),
      last_renewed_at timestamp with time zone not null,
      expires_at timestamp with time zone not null,
      absolute_expires_at timestamp with time zone not null,
      foreign key (tenant_id, user_id)
        references tenant_memberships(tenant_id, user_id)
        on delete cascade
    );
  `.execute(db);

  await sql`
    create index auth_sessions_user_id_idx on auth_sessions (user_id);
  `.execute(db);

  await sql`
    create index auth_sessions_tenant_user_id_idx
    on auth_sessions (tenant_id, user_id);
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists auth_sessions cascade;`.execute(db);
}
