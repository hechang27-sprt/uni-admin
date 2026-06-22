# server auth session module implementation plan

## Implementation Boundary

Implement the reusable `server/auth/session` domain only.

Included:

- Kysely schema + migration for persisted sessions
- session module types/errors/repository/service/barrel
- DI tokens/container wiring
- pgLite-backed unit/integration tests

Excluded:

- `/api/auth/*` route files
- cookie parsing/writing
- H3/Nitro request helpers
- runtime config/env parsing
- same-origin/CSRF enforcement
- Nuxt route tests

## Before Development

1. Load `trellis-before-dev` for server/auth, repository/database, and testing
   layers before code changes.
2. Run GitNexus impact analysis before editing any existing symbol, especially:
   - `AuthRbacService`
   - `KyselyAuthRbacRepository`
   - `createServerContainer`
   - `SERVER_DI_TYPES`
   - `server/db/schema.ts` table declarations
3. Re-read this task's `prd.md` and `design.md`; domain-first scope is a hard
   boundary.
4. Preserve unrelated worktree changes.

## Ordered Work

1. Add session schema and migration.
   - Extend `server/db/schema.ts` with `AuthSessionsTable` and `Database`
     binding.
   - Create a new migration that adds physical `auth_sessions` storage as
     PostgreSQL `UNLOGGED`.
   - Add indexes/constraints for token lookup, user-wide revocation, and
     membership-scoped revocation.
2. Add session-domain contracts.
   - Create `server/auth/session/types.ts` for session row/domain result/input
     types.
   - Create `server/auth/session/errors.ts` for stable domain error codes.
   - Create `server/auth/session/index.ts` public exports.
   - Keep exported API high-level only; do not export repository primitives for
     callers outside the module/DI boundary.
3. Implement persistence.
   - Create `server/auth/session/repository.ts` with a dedicated repository
     interface + Kysely implementation.
   - Support create/get/update/rotate/delete flows by token hash.
   - Support active-membership listing joined to tenant presentation data.
   - Support user-wide and membership-scoped revocation.
   - Resolve sessions fail-closed against active user and selected membership.
4. Implement service behavior.
   - Create `server/auth/session/service.ts`.
   - Use `AuthRbacService.verifyUsernamePassword()` for credential verification.
   - Generate high-entropy raw tokens and hash them before persistence.
   - Implement high-level methods: `login`, `resolveSession`, `selectTenant`,
     `revokeSession`, `revokeAllForUser`, `revokeMembershipSessions`, and
     `requireTenantActor`.
   - Implement auto-selection of exactly one active membership.
   - Implement resolve/renew semantics.
   - Implement tenant selection with token rotation.
   - Implement actor conversion that rejects tenant-less sessions.
5. Integrate with DI.
   - Add new DI token(s) in `server/di/tokens.ts`.
   - Bind repository/service in `server/di/container.ts` using existing patterns.
6. Add focused tests.
   - Add/extend `test/unit/server/` coverage for session migration/repository/
     service behavior.
   - Reuse existing pgLite/container fixture patterns where possible.
   - Prefer behavior assertions over snapshots.
7. Cleanup.
   - Ensure public exports are minimal and consistent.
   - Update relevant spec docs only if implementation reveals a durable contract
     worth preserving beyond this task.

## Validation

Minimum checks for this task:

```bash
bun run test -- --project unit
bun run typecheck
bun run lint
```

Also inspect the migration to confirm:

- physical `auth_sessions` table is `UNLOGGED`;
- raw tokens are not stored;
- revocation indexes/constraints exist.

## Review Gates

- Session module stays transport-agnostic; no H3/cookie/runtime-config code.
- Public API stays high-level; no public create/get/update repository surface.
- Login with exactly one active membership selects it; zero or multiple do not.
- Tenant-less session cannot produce `TenantActorContext`.
- Selected membership invalidation fails closed.
- Token rotation invalidates the old token.
- Sliding renewal never exceeds absolute expiry.
- User-wide and membership-scoped revocation affect only intended sessions.

## Rollback Points

- After schema/migration only: stop if `UNLOGGED` cannot be represented safely;
  do not silently substitute a logged or in-memory design.
- After repository/service only: session domain can be validated entirely with
  pgLite before any future route work.
- If the design pressures HTTP concerns into the module, stop and move them to a
  later route task rather than widening this task.
