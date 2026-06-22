# server auth session module

## Goal

Implement a new domain-first `server/auth/session` module that owns persisted
opaque sessions, tenant selection, expiry, and revocation logic, while deferring
all `/api/auth/*` route adapters to a later task.

## User Value

- The codebase gains a first-class session-management module beside
  `server/auth/um`, instead of mixing cookie/session concerns into RBAC code.
- Future route work can consume a transport-agnostic session domain with tested
  lifecycle behavior.
- Session lifecycle and tenant selection can be verified with the existing
  pgLite/Kysely test style before adding HTTP concerns.

## Confirmed Facts

- `server/auth/um` already owns credential verification, tenant membership
  lookup, actor resolution, and RBAC evaluation through `AuthRbacService` and
  `KyselyAuthRbacRepository`.
- `AuthRbacService.verifyUsernamePassword()` returns an active user or `null`.
  `resolveActor({ tenantId, userId })` resolves `TenantActorContext` through
  active-membership/RBAC checks.
- The server spec explicitly reserves sibling modules under `server/auth/` for
  distinct auth areas such as future `server/auth/session/` work.
- `createServerContainer()` currently binds auth/catalog/document services and
  repositories only; no session service or repository bindings exist.
- `server/db/schema.ts` and `server/db/migrations/001-baseline.ts` contain no
  session table today.
- No `server/api` route surface exists yet, and no existing runtime config or
  cookie helper patterns were found in `server/`.
- No `test/nuxt/` auth route tests exist yet; only unit/integration tests under
  `test/unit/server/` exercise the current service layer.
- The archived brainstorm selected PostgreSQL-backed opaque sessions with an
  `UNLOGGED` session table, tenant auto-selection only when exactly one active
  membership exists, explicit user-wide and membership-scoped revocation
  primitives, sliding idle expiry with absolute max lifetime, and no cached RBAC
  state inside the session.
- `package.json` currently has no dedicated auth/session Nuxt dependency such as
  `nuxt-auth-utils`; the domain-first module therefore should remain HTTP- and
  framework-independent.
- The user selected a **high-level service API only** for this task's public
  session-domain surface.

## Scope Decisions

- This task is **domain-first only**. It owns `server/auth/session` internals
  and does not implement `/api/auth/*` routes.
- The new module remains transport-agnostic. It returns raw token material and
  typed session/domain results for future route adapters, but it does not read
  or write cookies itself.
- Reuse the archived brainstorm's session semantics unless route-specific
  concerns were the original reason for them.
- Keep sessions as opaque server-side records. Do not use sealed-cookie-only
  sessions or cache derived RBAC grants in the session row.
- A session represents one authenticated user with zero or one selected tenant.
  Login auto-selects the tenant only when the user has exactly one active
  membership; zero or multiple memberships produce a tenant-less session.
- Session resolution revalidates the active user and selected membership on each
  lookup. A stale selected membership invalidates the session; it does not
  silently degrade to tenant-less.
- The domain module must expose explicit revocation primitives for one session,
  all sessions for one user, and selected sessions for one
  `(tenantId, userId)` membership.
- The domain module should provide tenant-selection behavior now, even though the
  HTTP endpoint is deferred, so future route adapters do not need to invent that
  policy themselves.
- Expiry remains sliding-idle plus absolute-max lifetime, but configuration and
  cookie mapping are deferred to the later route task; this task may use service
  constructor options or constants for timeout policy.
- The public API is high-level only. Export service/domain methods such as
  `login`, `resolveSession`, `selectTenant`, `revokeSession`,
  `revokeAllForUser`, `revokeMembershipSessions`, and `requireTenantActor`.
  Do not expose lower-level create/get/update persistence primitives as public
  module API.

## Requirements

- Create a new task-specific plan rather than reviving the archived brainstorm
  task directly.
- Add a new `server/auth/session/` module with public types, errors,
  repository/service contracts, and a barrel export.
- Add session persistence to the Kysely database schema and migration.
- Keep the public session-domain API independent of HTTP concerns such as
  cookies, H3 events, request headers, and `createError`.
- Keep the public session-domain API high-level; persistence primitives stay
  internal to the repository/service implementation.
- Integrate the session module through existing DI patterns in `server/di`.
- Add pgLite-backed unit/integration tests under `test/unit/server/` for the new
  session-domain behaviors.
- Defer all `/api/auth/*` route files, cookie helpers, same-origin/CSRF checks,
  Nuxt runtime config, and `test/nuxt/` coverage to a later task.

## Acceptance Criteria

- [x] Planning records the change from the archived brainstorm: this task is
      domain-first only and defers route adapters.
- [x] Planning records the public API decision: high-level service methods only.
- [x] `design.md` defines a transport-agnostic `server/auth/session` boundary,
      its dependencies, persistence model, and public API shape.
- [x] `implement.md` defines ordered work for schema, repository, service, DI,
      and pgLite tests.
- [ ] Future implementation follows existing server/auth, repository, DI, and
      testing conventions instead of inventing a parallel pattern.

## Definition of Done

- Requirements are settled and persisted in `prd.md`.
- Complex-task technical design is captured in `design.md`.
- Execution order and validation commands are captured in `implement.md`.
- The task is ready for activation into implementation.

## Out of Scope

- `/api/auth/login`, `/api/auth/session`, `/api/auth/tenants`,
  `/api/auth/select-tenant`, `/api/auth/logout`, and `/api/auth/logout-all`
  route handlers.
- Cookie parsing/writing and H3/Nitro request helpers.
- Same-origin/CSRF enforcement.
- Nuxt runtime config for browser session endpoints.
- Generated UI and client composables.
- Membership administration and account-administration workflows.
- Rate limiting and cross-origin browser support.
- Protected document CRUD routes.

## Technical Notes

- Prior brainstorm source:
  `.trellis/tasks/archive/2026-05/05-25-authentication-session-endpoints-brainstorm/`.
- Relevant current code: `server/auth/um/*`, `server/di/container.ts`,
  `server/db/schema.ts`, `server/db/migrations/001-baseline.ts`,
  `test/unit/server/auth-rbac.test.ts`.
- Session semantics intentionally preserved from the archived brainstorm:
  opaque token + hashed persistence, zero-or-one selected tenant,
  revalidation on lookup, explicit revocation primitives, and no permission
  caching.
