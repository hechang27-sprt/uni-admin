Implemented domain-first `server/auth/session`.

- Added `auth_sessions` as PostgreSQL `UNLOGGED` storage with hashed-token lookup, user-wide revocation index, and membership-scoped `(tenant_id, user_id)` revocation support.
- Added transport-agnostic session domain files under `server/auth/session/` with high-level API only: `login`, `resolveSession`, `selectTenant`, `revokeSession`, `revokeAllForUser`, `revokeMembershipSessions`, `requireTenantActor`.
- Wired `SessionRepository`, `SessionService`, and `SessionServiceOptions` through `server/di`.
- Added pgLite unit coverage for migration shape, login auto-selection, tenant-less actor rejection, membership invalidation, token rotation, renewal behavior, and revocation primitives.
- Raised unit-project `hookTimeout` to 20s in `vitest.config.ts` because real migration setup now exceeds the default 10s in healthy runs.

Verification:
- `bun run test -- --project unit test/unit/server/session.test.ts`
- `bun run test -- --project unit`
- `bun run typecheck`
- `bun run lint`
