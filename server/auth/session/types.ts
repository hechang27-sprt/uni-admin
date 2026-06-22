import { z } from "zod";

export const sessionServiceOptionsSchema = z
  .object({
    idleTimeoutMs: z.number().int().positive(),
    renewalThresholdMs: z.number().int().nonnegative(),
    absoluteTimeoutMs: z.number().int().positive(),
  })
  .strict()
  .refine(
    (input) => input.renewalThresholdMs <= input.idleTimeoutMs,
    "renewal threshold must not exceed idle timeout",
  )
  .refine(
    (input) => input.idleTimeoutMs <= input.absoluteTimeoutMs,
    "idle timeout must not exceed absolute timeout",
  );

export type SessionServiceOptions = z.output<typeof sessionServiceOptionsSchema>;

export const loginInputSchema = z
  .object({
    username: z.string().min(1),
    password: z.string().min(1),
  })
  .strict();

export type LoginInput = z.input<typeof loginInputSchema>;

export const resolveSessionInputSchema = z
  .object({
    token: z.string().min(1),
  })
  .strict();

export type ResolveSessionInput = z.input<typeof resolveSessionInputSchema>;

export const selectTenantInputSchema = z
  .object({
    token: z.string().min(1),
    tenantId: z.string().min(1),
  })
  .strict();

export type SelectTenantInput = z.input<typeof selectTenantInputSchema>;

export const revokeSessionInputSchema = z
  .object({
    token: z.string().min(1),
  })
  .strict();

export type RevokeSessionInput = z.input<typeof revokeSessionInputSchema>;

export const revokeAllForUserInputSchema = z
  .object({
    userId: z.string().min(1),
  })
  .strict();

export type RevokeAllForUserInput = z.input<typeof revokeAllForUserInputSchema>;

export const revokeMembershipSessionsInputSchema = z
  .object({
    tenantId: z.string().min(1),
    userId: z.string().min(1),
  })
  .strict();

export type RevokeMembershipSessionsInput = z.input<
  typeof revokeMembershipSessionsInputSchema
>;

export interface SessionUser {
  userId: string;
  displayName: string | null;
}

export interface SessionTenant {
  tenantId: string;
  name: string | null;
}

export interface ResolvedSession {
  user: SessionUser;
  selectedTenant: SessionTenant | null;
  createdAt: Date;
  lastRenewedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface LoginResult {
  token: string;
  session: ResolvedSession;
}

export interface ResolvedSessionValidResult {
  kind: "valid";
  renewed: boolean;
  session: ResolvedSession;
}

export type SessionInvalidReason =
  | "not-found"
  | "expired"
  | "user-disabled"
  | "membership-missing"
  | "membership-disabled";

export interface ResolvedSessionInvalidResult {
  kind: "invalid";
  reason: SessionInvalidReason;
}

export type ResolveSessionResult =
  | ResolvedSessionValidResult
  | ResolvedSessionInvalidResult;

export interface SessionRow {
  tokenHash: string;
  userId: string;
  tenantId: string | null;
  createdAt: Date;
  lastRenewedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface SessionResolutionRow extends SessionRow {
  userDisplayName: string | null;
  userStatus: string;
  selectedTenantName: string | null;
  membershipStatus: string | null;
}

export interface SessionMembershipRow {
  tenantId: string;
  tenantName: string | null;
}

export type CreateSessionInput = SessionRow;

export interface RenewSessionInput {
  tokenHash: string;
  lastRenewedAt: Date;
  expiresAt: Date;
}

export interface RotateSessionTenantInput extends RenewSessionInput {
  nextTokenHash: string;
  tenantId: string;
}

export interface DeleteSessionInput {
  tokenHash: string;
}

export interface DeleteSessionsByUserInput {
  userId: string;
}

export interface DeleteSessionsByMembershipInput {
  tenantId: string;
  userId: string;
}

export interface RequireTenantActorInput {
  session: ResolvedSession;
}
