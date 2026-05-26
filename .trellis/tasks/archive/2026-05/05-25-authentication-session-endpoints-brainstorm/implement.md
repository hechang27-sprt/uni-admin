# Authentication Session Endpoints Implementation Plan

## Implementation Boundary

Implement one server milestone: persisted opaque sessions, auth lifecycle
routes, active-tenant selection, revocation primitives, and the reusable
authenticated-request boundary. Do not add protected document routes,
generated UI, administrative account/membership mutations, cross-origin
client support, or rate limiting.

## Before Development

1. Run `trellis-before-dev` for the server/auth, repository/database, testing,
   and Nuxt route layers before changing source.
2. Check current worktree state and preserve unrelated edits.
3. Use GitNexus impact analysis before modifying existing functions/classes or
   shared schema symbols, especially `AuthRbacService`,
   `DrizzleAuthRbacRepository`, and `server/db/schema.ts` declarations.
4. Re-read this task's `prd.md` and `design.md`, treating the route/error and
   session trust-boundary decisions as implementation requirements.

## Ordered Work

1. Add database representation and migration.
   - Define the typed session table, nullable selected tenant, timestamps,
     constraints, and revocation indexes in `server/db/schema.ts`.
   - Generate and review the SQL migration.
   - Ensure the session table is created as PostgreSQL `UNLOGGED`, with user
     deletion and selected-membership deletion semantics preserved.
2. Add auth-domain session contracts.
   - Define session record, resolved-session presentation, selectable-tenant,
     creation, rotation, expiration, and revocation input/output types.
   - Export only public contracts needed by route adapters and future protected
     request consumers.
3. Implement repository persistence operations.
   - Create/read/renew/rotate/delete sessions by token hash.
   - Delete all sessions for a user and selected sessions for a membership.
   - List active selectable memberships joined to tenant names.
   - Resolve an active session using active-user and selected-membership
     validity requirements.
4. Implement lifecycle/domain service behavior.
   - Generate raw tokens and persist hashes only.
   - Create sessions with single-membership auto-selection at login.
   - Apply sliding renewal and absolute expiry limits.
   - Rotate tokens during tenant selection.
   - Produce session view data and tenant actor context only after validation.
   - Preserve generic authentication failure behavior and explicit
     authenticated selection denial.
5. Add Nitro/H3 session request helpers.
   - Read/set/clear the host-only cookie with the selected security flags.
   - Load and validate server runtime timeout configuration in `nuxt.config.ts`
     or the appropriate server-only configuration boundary.
   - Enforce JSON and same-origin/CSRF checks for mutation requests.
   - Map domain outcomes to stable HTTP errors without leaking invalidation
     reasons.
6. Add route handlers.
   - `server/api/auth/login.post.ts`
   - `server/api/auth/session.get.ts`
   - `server/api/auth/tenants.get.ts`
   - `server/api/auth/select-tenant.post.ts`
   - `server/api/auth/logout.post.ts`
   - `server/api/auth/logout-all.post.ts`
7. Add focused tests.
   - Extend real-Drizzle pgLite unit coverage for session repository/service
     behavior and invalidation.
   - Add Nuxt route coverage for body validation, statuses, cookies, CSRF
     checks, session response shapes, and token rotation.
8. Update server documentation/specs once implementation establishes the new
   route and session contracts.

## Validation

Run the relevant checks after implementation:

```bash
bun run test -- --project unit
bun run test -- --project nuxt
bun run typecheck
bun run lint
```

Also inspect the generated/reviewed migration to confirm:

- `auth_sessions` is `UNLOGGED`;
- raw session tokens are not stored;
- user and selected-membership revocation indexes/constraints are present.

Before any commit, run GitNexus change detection and confirm that affected
flows are limited to auth/session boundaries, route adapters, database schema
and tests/documentation expected by this task.

## Review Gates

- A tenant-less authenticated session cannot be turned into
  `TenantActorContext`.
- A login with exactly one active membership selects it; zero or multiple
  memberships leave `tenant` null.
- A stale selected membership fails closed and does not silently become
  tenant-less.
- Login/session failures remain generic; tenant selection denial reveals no
  missing-versus-inactive detail.
- Token rotation invalidates the previous cookie token.
- Logout is idempotent, while logout-all cannot execute without a valid
  current session.
- Cookie and mutation-origin behavior match the PRD.
- Sliding renewal never extends beyond absolute expiration.

## Rollback Points

- Before route wiring, repository/service changes can be tested in isolation
  using pgLite.
- If the session migration cannot be represented safely with the selected
  database tooling, stop before exposing routes and revise the storage design;
  do not substitute logged or in-memory sessions silently.
- Removing the new API surface requires dropping the unlogged session table
  and reverting its auth-domain interfaces together; leave existing RBAC and
  document behavior unchanged.
