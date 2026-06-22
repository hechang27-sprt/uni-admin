import { inject, injectable } from "inversify";
import { createHash, randomBytes } from "node:crypto";

import type { AuthRbacService } from "#server/auth/um";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import type { TenantActorContext } from "#server/data/documents";
import { SessionError } from "./errors";
import {
  loginInputSchema,
  resolveSessionInputSchema,
  revokeAllForUserInputSchema,
  revokeMembershipSessionsInputSchema,
  revokeSessionInputSchema,
  selectTenantInputSchema,
  sessionServiceOptionsSchema,
  type LoginInput,
  type LoginResult,
  type ResolveSessionInput,
  type ResolveSessionResult,
  type RevokeAllForUserInput,
  type RevokeMembershipSessionsInput,
  type RevokeSessionInput,
  type SelectTenantInput,
  type SessionInvalidReason,
  type SessionServiceOptions,
  type SessionTenant,
  type SessionUser,
  type RequireTenantActorInput,
} from "./types";
import type { SessionRepository } from "./repository";

const rawTokenByteLength = 32;

const defaultSessionServiceOptions: SessionServiceOptions = {
  idleTimeoutMs: 1000 * 60 * 60 * 24,
  renewalThresholdMs: 1000 * 60 * 60 * 12,
  absoluteTimeoutMs: 1000 * 60 * 60 * 24 * 30,
};

@injectable()
export class SessionService {
  constructor(
    @inject(SERVER_DI_TYPES.AuthRbacService)
    private readonly auth: AuthRbacService,
    @inject(SERVER_DI_TYPES.SessionRepository)
    private readonly repository: SessionRepository,
    @inject(SERVER_DI_TYPES.SessionServiceOptions)
    private readonly options: SessionServiceOptions = defaultSessionServiceOptions,
  ) {
    sessionServiceOptionsSchema.parse(this.options);
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const parsed = loginInputSchema.parse(input);
    const user = await this.auth.verifyUsernamePassword(parsed);

    if (!user) {
      throw new SessionError(
        "SESSION_INVALID_CREDENTIALS",
        "Invalid username or password",
      );
    }

    const memberships = await this.repository.listActiveMemberships(user.userId);
    const selectedTenant =
      memberships.length === 1 && memberships[0]
        ? {
            tenantId: memberships[0].tenantId,
            name: memberships[0].tenantName,
          }
        : null;
    const now = new Date();
    return this.createSession({
      user: {
        userId: user.userId,
        displayName: user.displayName,
      },
      selectedTenant,
      now,
    });
  }

  async resolveSession(
    input: ResolveSessionInput,
  ): Promise<ResolveSessionResult> {
    const { token } = resolveSessionInputSchema.parse(input);
    return this.resolveByToken(token, { renew: true });
  }

  async selectTenant(input: SelectTenantInput): Promise<LoginResult> {
    const parsed = selectTenantInputSchema.parse(input);
    const resolved = await this.resolveByToken(parsed.token, { renew: false });

    if (resolved.kind === "invalid") {
      throw this.invalidSessionError(resolved.reason);
    }

    const membership = await this.repository.findActiveMembership({
      tenantId: parsed.tenantId,
      userId: resolved.session.user.userId,
    });

    if (!membership) {
      throw new SessionError(
        "SESSION_TENANT_MEMBERSHIP_REQUIRED",
        "Active tenant membership required",
        {
          tenantId: parsed.tenantId,
          userId: resolved.session.user.userId,
        },
      );
    }

    return this.rotateSession({
      token: parsed.token,
      user: resolved.session.user,
      selectedTenant: {
        tenantId: membership.tenantId,
        name: membership.tenantName,
      },
      absoluteExpiresAt: resolved.session.absoluteExpiresAt,
      now: new Date(),
    });
  }

  async revokeSession(input: RevokeSessionInput): Promise<void> {
    const { token } = revokeSessionInputSchema.parse(input);
    await this.repository.deleteSession({ tokenHash: this.hashToken(token) });
  }

  async revokeAllForUser(input: RevokeAllForUserInput): Promise<void> {
    const parsed = revokeAllForUserInputSchema.parse(input);
    await this.repository.deleteSessionsByUser({ userId: parsed.userId });
  }

  async revokeMembershipSessions(
    input: RevokeMembershipSessionsInput,
  ): Promise<void> {
    const parsed = revokeMembershipSessionsInputSchema.parse(input);
    await this.repository.deleteSessionsByMembership({
      tenantId: parsed.tenantId,
      userId: parsed.userId,
    });
  }

  requireTenantActor(
    input: RequireTenantActorInput,
  ): TenantActorContext {
    if (!input.session.selectedTenant) {
      throw new SessionError(
        "SESSION_TENANT_REQUIRED",
        "Tenant selection is required",
      );
    }

    return {
      tenantId: input.session.selectedTenant.tenantId,
      actor: {
        userId: input.session.user.userId,
      },
    };
  }

  private async createSession(input: {
    user: SessionUser;
    selectedTenant: SessionTenant | null;
    now: Date;
  }): Promise<LoginResult> {
    const token = this.generateRawToken();
    const tokenHash = this.hashToken(token);
    const absoluteExpiresAt = this.addMillis(
      input.now,
      this.options.absoluteTimeoutMs,
    );
    const expiresAt = this.clampExpiry(
      this.addMillis(input.now, this.options.idleTimeoutMs),
      absoluteExpiresAt,
    );

    await this.repository.createSession({
      tokenHash,
      userId: input.user.userId,
      tenantId: input.selectedTenant?.tenantId ?? null,
      createdAt: input.now,
      lastRenewedAt: input.now,
      expiresAt,
      absoluteExpiresAt,
    });

    return {
      token,
      session: {
        user: input.user,
        selectedTenant: input.selectedTenant,
        createdAt: input.now,
        lastRenewedAt: input.now,
        expiresAt,
        absoluteExpiresAt,
      },
    };
  }

  private async rotateSession(input: {
    token: string;
    user: SessionUser;
    selectedTenant: SessionTenant;
    absoluteExpiresAt: Date;
    now: Date;
  }): Promise<LoginResult> {
    const nextToken = this.generateRawToken();
    const nextTokenHash = this.hashToken(nextToken);
    const expiresAt = this.clampExpiry(
      this.addMillis(input.now, this.options.idleTimeoutMs),
      input.absoluteExpiresAt,
    );

    const row = await this.repository.rotateSessionTenant({
      tokenHash: this.hashToken(input.token),
      nextTokenHash,
      tenantId: input.selectedTenant.tenantId,
      lastRenewedAt: input.now,
      expiresAt,
    });

    if (!row) {
      throw this.invalidSessionError("not-found");
    }

    return {
      token: nextToken,
      session: {
        user: input.user,
        selectedTenant: input.selectedTenant,
        createdAt: row.createdAt,
        lastRenewedAt: row.lastRenewedAt,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
      },
    };
  }

  private async resolveByToken(
    token: string,
    options: { renew: boolean },
  ): Promise<ResolveSessionResult> {
    const tokenHash = this.hashToken(token);
    const row = await this.repository.findSessionResolution(tokenHash);

    if (!row) {
      return { kind: "invalid", reason: "not-found" };
    }

    const now = new Date();

    if (row.userStatus !== "active") {
      await this.repository.deleteSession({ tokenHash });
      return { kind: "invalid", reason: "user-disabled" };
    }

    if (row.expiresAt.getTime() <= now.getTime()) {
      await this.repository.deleteSession({ tokenHash });
      return { kind: "invalid", reason: "expired" };
    }

    if (row.tenantId) {
      if (!row.membershipStatus) {
        await this.repository.deleteSession({ tokenHash });
        return { kind: "invalid", reason: "membership-missing" };
      }

      if (row.membershipStatus !== "active") {
        await this.repository.deleteSession({ tokenHash });
        return { kind: "invalid", reason: "membership-disabled" };
      }
    }

    if (options.renew && this.shouldRenew(row.expiresAt, now)) {
      const renewedSession = await this.repository.renewSession({
        tokenHash,
        lastRenewedAt: now,
        expiresAt: this.clampExpiry(
          this.addMillis(now, this.options.idleTimeoutMs),
          row.absoluteExpiresAt,
        ),
      });

      if (!renewedSession) {
        return { kind: "invalid", reason: "not-found" };
      }

      return {
        kind: "valid",
        renewed: true,
        session: {
          user: {
            userId: row.userId,
            displayName: row.userDisplayName,
          },
          selectedTenant: row.tenantId
            ? {
                tenantId: row.tenantId,
                name: row.selectedTenantName,
              }
            : null,
          createdAt: renewedSession.createdAt,
          lastRenewedAt: renewedSession.lastRenewedAt,
          expiresAt: renewedSession.expiresAt,
          absoluteExpiresAt: renewedSession.absoluteExpiresAt,
        },
      };
    }

    return {
      kind: "valid",
      renewed: false,
      session: {
        user: {
          userId: row.userId,
          displayName: row.userDisplayName,
        },
        selectedTenant: row.tenantId
          ? {
              tenantId: row.tenantId,
              name: row.selectedTenantName,
            }
          : null,
        createdAt: row.createdAt,
        lastRenewedAt: row.lastRenewedAt,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
      },
    };
  }

  private shouldRenew(expiresAt: Date, now: Date): boolean {
    return expiresAt.getTime() - now.getTime() <= this.options.renewalThresholdMs;
  }

  private addMillis(date: Date, millis: number): Date {
    return new Date(date.getTime() + millis);
  }

  private clampExpiry(candidate: Date, absoluteExpiresAt: Date): Date {
    return candidate.getTime() > absoluteExpiresAt.getTime() ? absoluteExpiresAt : candidate;
  }

  private generateRawToken(): string {
    return randomBytes(rawTokenByteLength).toString("base64url");
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
  }

  private invalidSessionError(reason: SessionInvalidReason): SessionError {
    return new SessionError("SESSION_INVALID_SESSION", "Session is invalid", {
      reason,
    });
  }
}
