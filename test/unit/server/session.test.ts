import { createHash } from "node:crypto";

import { sql } from "kysely";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AuthRbacService } from "#server/auth/um";
import { migrateToLatest } from "#server/db/migrate";
import { createInMemoryDb } from "#server/utils/kysely";
import { tenantA, tenantB } from "./fixtures/service";
import {
  createSessionServices,
  prepareSessionTestDatabase,
} from "./fixtures/session";

async function createUserWithPassword(
  auth: AuthRbacService,
  input: { displayName: string; username: string; password: string },
) {
  const user = await auth.createUser({ displayName: input.displayName });
  await auth.setUsernamePasswordCredential({
    userId: user.userId,
    username: input.username,
    password: input.password,
  });

  return user;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

describe("server auth session module", () => {
  let database: ReturnType<typeof createInMemoryDb> | null = null;

  beforeAll(() => {
    database = createInMemoryDb();
  });

  beforeEach(async () => {
    await migrateToLatest(getTestDatabase());
    await prepareSessionTestDatabase(getTestDatabase());
  });

  afterEach(async () => {
    vi.useRealTimers();
    await sql`drop schema if exists public cascade`.execute(getTestDatabase());
    await sql`create schema public`.execute(getTestDatabase());
  });

  afterAll(async () => {
    await database?.destroy();
    database = null;
  });

  it("creates an unlogged auth_sessions table with lookup and revocation constraints", async () => {
    const db = getTestDatabase();

    const table = await sql<{ relpersistence: string }>`
      select relpersistence as "relpersistence"
      from pg_class
      where oid = 'auth_sessions'::regclass
    `.execute(db);

    const columns = await sql<{ columnName: string }>`
      select column_name as "columnName"
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'auth_sessions'
      order by ordinal_position
    `.execute(db);

    const constraints = await sql<{ constraintName: string; definition: string }>`
      select c.conname as "constraintName", pg_get_constraintdef(c.oid) as "definition"
      from pg_constraint as c
      where c.conrelid = 'auth_sessions'::regclass
      order by c.conname
    `.execute(db);

    const indexes = await sql<{ indexName: string; indexDef: string }>`
      select indexname as "indexName", indexdef as "indexDef"
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'auth_sessions'
      order by indexname
    `.execute(db);

    expect(table.rows).toEqual([{ relpersistence: "u" }]);
    expect(columns.rows.map((row) => row.columnName)).toEqual([
      "token_hash",
      "user_id",
      "tenant_id",
      "created_at",
      "last_renewed_at",
      "expires_at",
      "absolute_expires_at",
    ]);
    expect(columns.rows.some((row) => row.columnName === "raw_token")).toBe(
      false,
    );
    expect(constraints.rows.map((row) => row.definition)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("PRIMARY KEY (token_hash)"),
        expect.stringContaining(
          "FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE",
        ),
        expect.stringContaining(
          "FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE CASCADE",
        ),
      ]),
    );
    expect(indexes.rows.map((row) => row.indexDef)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("(user_id)"),
        expect.stringContaining("(tenant_id, user_id)"),
      ]),
    );
  });

  it("login selects one active membership and stays tenant-less otherwise", async () => {
    const { auth, session } = createSessionServices(getTestDatabase());

    const zeroMembershipUser = await createUserWithPassword(auth, {
      displayName: "Zero Membership",
      password: "zero-password",
      username: "zero-user",
    });
    const zeroLogin = await session.login({
      username: "zero-user",
      password: "zero-password",
    });

    const oneMembershipUser = await createUserWithPassword(auth, {
      displayName: "One Membership",
      password: "one-password",
      username: "one-user",
    });
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: oneMembershipUser.userId,
    });
    const oneLogin = await session.login({
      username: "one-user",
      password: "one-password",
    });

    const manyMembershipUser = await createUserWithPassword(auth, {
      displayName: "Many Memberships",
      password: "many-password",
      username: "many-user",
    });
    await Promise.all([
      auth.createTenantMembership({
        tenantId: tenantA,
        userId: manyMembershipUser.userId,
      }),
      auth.createTenantMembership({
        tenantId: tenantB,
        userId: manyMembershipUser.userId,
      }),
    ]);
    const manyLogin = await session.login({
      username: "many-user",
      password: "many-password",
    });

    expect(zeroLogin.session.selectedTenant).toBeNull();
    expect(oneLogin.session.selectedTenant).not.toBeNull();
    expect(oneLogin.session.selectedTenant?.tenantId).toBe(tenantA);
    expect(oneLogin.session.selectedTenant?.name).toBe("Test Tenant A");
    expect(manyLogin.session.selectedTenant).toBeNull();
    expect(zeroLogin.session.user).toMatchObject({
      userId: zeroMembershipUser.userId,
      displayName: "Zero Membership",
    });
  });

  it("rejects tenant-less sessions when requiring an actor context", async () => {
    const { auth, session } = createSessionServices(getTestDatabase());
    const user = await createUserWithPassword(auth, {
      displayName: "Tenantless User",
      password: "tenantless-password",
      username: "tenantless-user",
    });

    const login = await session.login({
      username: "tenantless-user",
      password: "tenantless-password",
    });

    expect(login.session.selectedTenant).toBeNull();
    await expect(
      Promise.resolve().then(() =>
        session.requireTenantActor({ session: login.session }),
      ),
    ).rejects.toMatchObject({ code: "SESSION_TENANT_REQUIRED" });

    expect(login.session.user).toMatchObject({ userId: user.userId });
  });

  it("invalidates a selected session when the membership is deleted or disabled", async () => {
    const { auth, session } = createSessionServices(getTestDatabase());
    const selectedUser = await createUserWithPassword(auth, {
      displayName: "Selected User",
      password: "selected-password",
      username: "selected-user",
    });
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: selectedUser.userId,
    });

    const login = await session.login({
      username: "selected-user",
      password: "selected-password",
    });
    const tokenHash = hashToken(login.token);

    await getTestDatabase()
      .deleteFrom("tenantMemberships")
      .where("tenantId", "=", tenantA)
      .where("userId", "=", selectedUser.userId)
      .execute();

    const deletedResult = await session.resolveSession({ token: login.token });
    expect(deletedResult).toEqual({ kind: "invalid", reason: "not-found" });
    expect(await findSessionByHash(tokenHash)).toBeNull();

    const disabledUser = await createUserWithPassword(auth, {
      displayName: "Disabled Membership User",
      password: "disabled-password",
      username: "disabled-user",
    });
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: disabledUser.userId,
    });
    const disabledLogin = await session.login({
      username: "disabled-user",
      password: "disabled-password",
    });
    const disabledTokenHash = hashToken(disabledLogin.token);

    await getTestDatabase()
      .updateTable("tenantMemberships")
      .set({ status: "inactive" })
      .where("tenantId", "=", tenantA)
      .where("userId", "=", disabledUser.userId)
      .execute();

    const disabledResult = await session.resolveSession({
      token: disabledLogin.token,
    });
    expect(disabledResult).toEqual({
      kind: "invalid",
      reason: "membership-disabled",
    });
    expect(await findSessionByHash(disabledTokenHash)).toBeNull();
  });

  it("rotates the session token when selecting a tenant", async () => {
    const { auth, session } = createSessionServices(getTestDatabase());
    const user = await createUserWithPassword(auth, {
      displayName: "Tenant Switcher",
      password: "switch-password",
      username: "switch-user",
    });
    await Promise.all([
      auth.createTenantMembership({ tenantId: tenantA, userId: user.userId }),
      auth.createTenantMembership({ tenantId: tenantB, userId: user.userId }),
    ]);

    const login = await session.login({
      username: "switch-user",
      password: "switch-password",
    });
    const selected = await session.selectTenant({
      token: login.token,
      tenantId: tenantA,
    });

    expect(selected.token).not.toBe(login.token);
    expect(selected.session.selectedTenant).not.toBeNull();
    expect(selected.session.selectedTenant?.tenantId).toBe(tenantA);
    expect(selected.session.selectedTenant?.name).toBe("Test Tenant A");
    expect(await findSessionByHash(hashToken(login.token))).toBeNull();
    expect(await findSessionByHash(hashToken(selected.token))).toMatchObject({
      tenantId: tenantA,
      userId: user.userId,
    });
  });

  it("renews only after the threshold and clamps to the absolute expiry", async () => {
    vi.useFakeTimers();
    const start = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(start);
    let current = start;

    const { auth, session } = createSessionServices(getTestDatabase(), {
      idleTimeoutMs: 30 * 60 * 1000,
      renewalThresholdMs: 10 * 60 * 1000,
      absoluteTimeoutMs: 45 * 60 * 1000,
    });
    const user = await createUserWithPassword(auth, {
      displayName: "Renewal User",
      password: "renewal-password",
      username: "renew-user",
    });
    await auth.createTenantMembership({ tenantId: tenantA, userId: user.userId });

    const login = await session.login({
      username: "renew-user",
      password: "renewal-password",
    });
    const initialRow = await findSessionByToken(login.token);

    current = new Date(current.getTime() + 15 * 60 * 1000);
    vi.setSystemTime(current);
    const beforeThreshold = await session.resolveSession({ token: login.token });
    expect(beforeThreshold).toEqual(
      expect.objectContaining({ kind: "valid", renewed: false }),
    );
    expect(await findSessionByToken(login.token)).toMatchObject({
      expiresAt: initialRow?.expiresAt,
      lastRenewedAt: initialRow?.lastRenewedAt,
    });

    current = new Date(current.getTime() + 10 * 60 * 1000);
    vi.setSystemTime(current);
    const afterThreshold = await session.resolveSession({ token: login.token });
    expect(afterThreshold).toEqual(
      expect.objectContaining({ kind: "valid", renewed: true }),
    );

    const renewedRow = await findSessionByToken(login.token);
    expect(renewedRow?.lastRenewedAt.getTime()).toBe(start.getTime() + 25 * 60 * 1000);
    expect(renewedRow?.expiresAt.getTime()).toBe(start.getTime() + 45 * 60 * 1000);
    expect(renewedRow?.expiresAt.getTime()).toBeLessThanOrEqual(
      renewedRow?.absoluteExpiresAt.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });

  it("revokeSession, revokeAllForUser, and revokeMembershipSessions delete only the intended rows", async () => {
    const { auth, session } = createSessionServices(getTestDatabase());
    const user = await createUserWithPassword(auth, {
      displayName: "Revocation User",
      password: "revocation-password",
      username: "revoke-user",
    });
    await auth.createTenantMembership({ tenantId: tenantA, userId: user.userId });

    const current = await session.login({
      username: "revoke-user",
      password: "revocation-password",
    });
    await session.revokeSession({ token: current.token });
    expect(await findSessionsByUser(user.userId)).toHaveLength(0);

    const userForAll = await createUserWithPassword(auth, {
      displayName: "Logout All User",
      password: "logout-all-password",
      username: "logout-all-user",
    });
    await auth.createTenantMembership({ tenantId: tenantA, userId: userForAll.userId });
    const first = await session.login({
      username: "logout-all-user",
      password: "logout-all-password",
    });
    const second = await session.login({
      username: "logout-all-user",
      password: "logout-all-password",
    });
    expect(first.token).not.toBe(second.token);

    await session.revokeAllForUser({ userId: userForAll.userId });
    expect(await findSessionsByUser(userForAll.userId)).toHaveLength(0);

    const membershipUser = await createUserWithPassword(auth, {
      displayName: "Membership Revocation User",
      password: "membership-revoke-password",
      username: "membership-user",
    });
    await auth.createTenantMembership({ tenantId: tenantA, userId: membershipUser.userId });
    const selected = await session.login({
      username: "membership-user",
      password: "membership-revoke-password",
    });
    await auth.createTenantMembership({ tenantId: tenantB, userId: membershipUser.userId });
    const tenantless = await session.login({
      username: "membership-user",
      password: "membership-revoke-password",
    });

    await session.revokeMembershipSessions({
      tenantId: tenantA,
      userId: membershipUser.userId,
    });

    const remaining = await findSessionsByUser(membershipUser.userId);
    expect(remaining).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: null,
          userId: membershipUser.userId,
        }),
      ]),
    );
    expect(remaining).toHaveLength(1);
    expect(await findSessionByHash(hashToken(selected.token))).toBeNull();
    expect(await findSessionByHash(hashToken(tenantless.token))).toMatchObject({
      tenantId: null,
      userId: membershipUser.userId,
    });
  });

  type SessionSessionRow = {
    tenantId: string | null;
    userId: string;
    expiresAt: Date;
    lastRenewedAt: Date;
    absoluteExpiresAt: Date;
  };

  async function findSessionByHash(
    tokenHash: string,
  ): Promise<SessionSessionRow | null> {
    const row = await getTestDatabase()
      .selectFrom("authSessions")
      .select(["tenantId", "userId", "expiresAt", "lastRenewedAt", "absoluteExpiresAt"])
      .where("tokenHash", "=", tokenHash)
      .executeTakeFirst();

    return row
      ? {
          tenantId: row.tenantId,
          userId: row.userId,
          expiresAt: new Date(row.expiresAt),
          lastRenewedAt: new Date(row.lastRenewedAt),
          absoluteExpiresAt: new Date(row.absoluteExpiresAt),
        }
      : null;
  }

  async function findSessionByToken(token: string) {
    return findSessionByHash(hashToken(token));
  }

  async function findSessionsByUser(userId: string) {
    return getTestDatabase()
      .selectFrom("authSessions")
      .select(["tenantId", "userId"])
      .where("userId", "=", userId)
      .orderBy("tenantId", "asc")
      .execute();
  }

  function getTestDatabase(): ReturnType<typeof createInMemoryDb> {
    if (!database) {
      throw new Error("Test database has not been initialized");
    }

    return database;
  }
});
