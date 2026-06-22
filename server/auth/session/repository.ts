/* oxlint-disable typescript/unbound-method -- Kysely expression-builder callback methods are used only to build SQL AST nodes. */
import { inject, injectable } from "inversify";
import type { Selectable } from "kysely";

import type { AuthSessionsTable } from "#server/db/schema";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import type { DatabaseClient } from "#server/utils/kysely";
import type {
  CreateSessionInput,
  DeleteSessionInput,
  DeleteSessionsByMembershipInput,
  DeleteSessionsByUserInput,
  RenewSessionInput,
  RotateSessionTenantInput,
  SessionMembershipRow,
  SessionResolutionRow,
  SessionRow,
} from "./types";

export interface SessionRepository {
  createSession(input: CreateSessionInput): Promise<SessionRow>;
  findSessionResolution(
    tokenHash: string,
  ): Promise<SessionResolutionRow | null>;
  listActiveMemberships(userId: string): Promise<SessionMembershipRow[]>;
  findActiveMembership(
    input: DeleteSessionsByMembershipInput,
  ): Promise<SessionMembershipRow | null>;
  renewSession(input: RenewSessionInput): Promise<SessionRow | null>;
  rotateSessionTenant(
    input: RotateSessionTenantInput,
  ): Promise<SessionRow | null>;
  deleteSession(input: DeleteSessionInput): Promise<number>;
  deleteSessionsByUser(input: DeleteSessionsByUserInput): Promise<number>;
  deleteSessionsByMembership(
    input: DeleteSessionsByMembershipInput,
  ): Promise<number>;
}

@injectable()
export class KyselySessionRepository implements SessionRepository {
  constructor(
    @inject(SERVER_DI_TYPES.DatabaseClient)
    private readonly database: DatabaseClient,
  ) {}

  async createSession(input: CreateSessionInput): Promise<SessionRow> {
    const row = await this.database
      .insertInto("authSessions")
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();

    return mapSession(row);
  }

  async findSessionResolution(
    tokenHash: string,
  ): Promise<SessionResolutionRow | null> {
    const row = await this.database
      .selectFrom("authSessions as s")
      .innerJoin("users as u", "u.userId", "s.userId")
      .leftJoin("tenantMemberships as tm", (join) =>
        join
          .onRef("tm.tenantId", "=", "s.tenantId")
          .onRef("tm.userId", "=", "s.userId"),
      )
      .leftJoin("tenants as t", "t.id", "s.tenantId")
      .select([
        "s.tokenHash as tokenHash",
        "s.userId as userId",
        "s.tenantId as tenantId",
        "s.createdAt as createdAt",
        "s.lastRenewedAt as lastRenewedAt",
        "s.expiresAt as expiresAt",
        "s.absoluteExpiresAt as absoluteExpiresAt",
        "u.displayName as userDisplayName",
        "u.status as userStatus",
        "t.name as selectedTenantName",
        "tm.status as membershipStatus",
      ])
      .where("s.tokenHash", "=", tokenHash)
      .executeTakeFirst();

    return row ? mapSessionResolution(row) : null;
  }

  async listActiveMemberships(userId: string): Promise<SessionMembershipRow[]> {
    return this.database
      .selectFrom("tenantMemberships as tm")
      .innerJoin("users as u", "u.userId", "tm.userId")
      .innerJoin("tenants as t", "t.id", "tm.tenantId")
      .select(["tm.tenantId as tenantId", "t.name as tenantName"])
      .where("tm.userId", "=", userId)
      .where("tm.status", "=", "active")
      .where("u.status", "=", "active")
      .execute();
  }

  async findActiveMembership(
    input: DeleteSessionsByMembershipInput,
  ): Promise<SessionMembershipRow | null> {
    const row = await this.database
      .selectFrom("tenantMemberships as tm")
      .innerJoin("users as u", "u.userId", "tm.userId")
      .innerJoin("tenants as t", "t.id", "tm.tenantId")
      .select(["tm.tenantId as tenantId", "t.name as tenantName"])
      .where("tm.tenantId", "=", input.tenantId)
      .where("tm.userId", "=", input.userId)
      .where("tm.status", "=", "active")
      .where("u.status", "=", "active")
      .executeTakeFirst();

    return row ?? null;
  }

  async renewSession(input: RenewSessionInput): Promise<SessionRow | null> {
    const row = await this.database
      .updateTable("authSessions")
      .set({
        lastRenewedAt: input.lastRenewedAt,
        expiresAt: input.expiresAt,
      })
      .where("tokenHash", "=", input.tokenHash)
      .returningAll()
      .executeTakeFirst();

    return row ? mapSession(row) : null;
  }

  async rotateSessionTenant(
    input: RotateSessionTenantInput,
  ): Promise<SessionRow | null> {
    const row = await this.database
      .updateTable("authSessions")
      .set({
        tokenHash: input.nextTokenHash,
        tenantId: input.tenantId,
        lastRenewedAt: input.lastRenewedAt,
        expiresAt: input.expiresAt,
      })
      .where("tokenHash", "=", input.tokenHash)
      .returningAll()
      .executeTakeFirst();

    return row ? mapSession(row) : null;
  }

  async deleteSession(input: DeleteSessionInput): Promise<number> {
    const result = await this.database
      .deleteFrom("authSessions")
      .where("tokenHash", "=", input.tokenHash)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  }

  async deleteSessionsByUser(input: DeleteSessionsByUserInput): Promise<number> {
    const result = await this.database
      .deleteFrom("authSessions")
      .where("userId", "=", input.userId)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  }

  async deleteSessionsByMembership(
    input: DeleteSessionsByMembershipInput,
  ): Promise<number> {
    const result = await this.database
      .deleteFrom("authSessions")
      .where("tenantId", "=", input.tenantId)
      .where("userId", "=", input.userId)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  }
}

function mapSession(row: Selectable<AuthSessionsTable>): SessionRow {
  return {
    tokenHash: row.tokenHash,
    userId: row.userId,
    tenantId: row.tenantId,
    createdAt: toDate(row.createdAt),
    lastRenewedAt: toDate(row.lastRenewedAt),
    expiresAt: toDate(row.expiresAt),
    absoluteExpiresAt: toDate(row.absoluteExpiresAt),
  };
}

function mapSessionResolution(row: {
  tokenHash: string;
  userId: string;
  tenantId: string | null;
  createdAt: Date | string;
  lastRenewedAt: Date | string;
  expiresAt: Date | string;
  absoluteExpiresAt: Date | string;
  userDisplayName: string | null;
  userStatus: string;
  selectedTenantName: string | null;
  membershipStatus: string | null;
}): SessionResolutionRow {
  return {
    tokenHash: row.tokenHash,
    userId: row.userId,
    tenantId: row.tenantId,
    createdAt: toDate(row.createdAt),
    lastRenewedAt: toDate(row.lastRenewedAt),
    expiresAt: toDate(row.expiresAt),
    absoluteExpiresAt: toDate(row.absoluteExpiresAt),
    userDisplayName: row.userDisplayName,
    userStatus: row.userStatus,
    selectedTenantName: row.selectedTenantName,
    membershipStatus: row.membershipStatus,
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
