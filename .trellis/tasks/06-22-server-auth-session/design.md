# server auth session module design

## Scope

This task implements the **domain-first** `server/auth/session` module only.
It owns persisted opaque sessions, tenant selection, expiry, revocation
primitives, and conversion from a resolved session into tenant-scoped actor
context.

It does **not** own Nitro/H3 cookie helpers, runtime config wiring,
`/api/auth/*` route files, or route-level CSRF/origin enforcement.

## Why This Scope

Current repo evidence:

- domain-side neighbors already exist: `server/auth/um`, `server/db/schema.ts`,
  `server/di/container.ts`, and `test/unit/server/` pgLite coverage;
- route-side neighbors do not exist yet: no `server/api` auth routes, no cookie
  helper baseline, no runtime-config auth contract, and no `test/nuxt/` auth
  suite.

Decision: build the reusable domain first, then let a later route task adapt it
into HTTP.

## Archived Brainstorm Decisions Kept

Keep these earlier decisions unchanged:

- opaque server-side sessions, not sealed-cookie-only claims;
- session row stores identity, selected tenant, and expiry metadata only;
- no cached permission/role state in session rows;
- one authenticated user with zero or one selected tenant per session;
- login auto-selects exactly one active membership, otherwise creates a
  tenant-less session;
- session resolution revalidates active user and selected membership on every
  lookup;
- a stale selected membership invalidates the session rather than degrading to
  tenant-less;
- explicit revocation primitives exist for current session, user-wide sessions,
  and membership-scoped sessions.

## Archived Brainstorm Decisions Narrowed For This Task

### Deferred from this task

These stay conceptually valid but move to the later route task:

- cookie attributes and cookie lifetime mapping;
- HTTP status/error contracts;
- same-origin/CSRF enforcement;
- runtime-config environment variables;
- `/api/auth/*` route shapes.

### Adapted for this task

Expiry policy still exists now, but is configured as domain-service input rather
than Nuxt runtime config. The later route task can read runtime config and feed
those values into the session service.

## Public API Decision

The user selected a **high-level service API only**.

Publicly expose service/domain methods like:

- `login`
- `resolveSession`
- `selectTenant`
- `revokeSession`
- `revokeAllForUser`
- `revokeMembershipSessions`
- `requireTenantActor`

Do **not** expose low-level create/get/update persistence primitives as public
module API. Those stay inside the repository/service boundary.

## Proposed Module Boundary

Create `server/auth/session/` with:

- `types.ts` — row/domain/input/output contracts
- `errors.ts` — stable domain errors
- `repository.ts` — session persistence + membership listing/resolution queries
- `service.ts` — high-level login/resolve/select/revoke/actor conversion
- `index.ts` — public barrel

This module must stay transport-agnostic: no H3 event objects, cookies, header
inspection, or route error factories.

## Dependencies

### Reuse from existing auth domain

- `AuthRbacService.verifyUsernamePassword()` for login credential verification.
- Existing membership and actor semantics from `server/auth/um` as the source of
  truth for active-user and tenant-scoped authorization behavior.

### New persistence responsibilities

Session persistence belongs in the new session module, not in `server/auth/um`.
The repo may either:

1. own a dedicated `SessionRepository` implemented in
   `server/auth/session/repository.ts`; or
2. if a small number of shared membership facts are needed, query them there
   without moving session policy into `server/auth/um`.

Decision: prefer a dedicated session repository. Keep `AuthRbacService` focused
on RBAC and credential concerns.

### DI integration

Add new DI token(s) and bind the session repository/service in
`server/di/container.ts`, matching the existing repository/service binding
pattern.

## Data Model

Add a typed `authSessions` table to `server/db/schema.ts` and create the
physical `auth_sessions` table in a new migration as PostgreSQL `UNLOGGED`.

### Required columns

- `tokenHash`
- `userId`
- `tenantId` nullable
- `createdAt`
- `lastRenewedAt`
- `expiresAt`
- `absoluteExpiresAt`

### Required relational behavior

- raw tokens are never stored;
- `userId` references users and supports user-wide revocation;
- nullable selected `tenantId` supports tenant-less sessions;
- selected-membership revocation must efficiently target
  `(tenantId, userId)` sessions;
- deleted users must invalidate/delete their sessions fail-closed;
- selected-membership deletion should not leave a selected session silently
  valid.

### Migration note

Kysely typing cannot express `UNLOGGED` by itself. The migration must use raw SQL
or an equivalent reviewed path for the physical table mode.

## Domain Contracts

### Session creation result

The session service should return both:

- the raw opaque token for the caller to transport/store later;
- a safe resolved session view containing user, nullable selected tenant, and
  expiry timestamps.

### Resolution result

Resolving a raw token should return either:

- a valid resolved session, optionally renewed; or
- an invalid-session outcome the route layer can later translate into cookie
  clearing / unauthenticated response.

### Actor conversion

The domain module should expose a helper that converts a resolved session into
`TenantActorContext` only when a selected tenant exists. Tenant-less sessions
must fail explicitly.

## Domain Flows

### Login flow

1. verify credentials through `AuthRbacService.verifyUsernamePassword()`
2. list the user's active memberships with tenant presentation data
3. select tenant automatically only when exactly one active membership exists
4. generate a high-entropy raw token
5. hash token deterministically for persistence lookup
6. compute created/renewed/expiry timestamps from service policy
7. persist the session row
8. return `{ token, session }`

### Resolve flow

1. hash the supplied raw token
2. fetch the session row together with active user and selected-tenant
   presentation
3. reject expired sessions
4. reject disabled/deleted users
5. if `tenantId` is non-null, require an active membership for that
   `(tenantId, userId)`
6. renew idle expiry only when the renewal threshold is reached, clamped by the
   absolute maximum
7. return valid session data and whether persistence changed

### Select-tenant flow

1. resolve current valid session from token
2. validate active membership for requested `tenantId`
3. rotate to a new raw token/hash
4. update selected `tenantId` and timestamps as needed
5. invalidate old token by replacement
6. return `{ token, session }`

### Revocation flow

Expose primitives to:

- revoke one raw token
- revoke all sessions for one user
- revoke all sessions for one `(tenantId, userId)` membership

These are domain APIs so later admin or route code can call them directly.

## Testing Strategy

Use `test/unit/server/` with the real Kysely pgLite setup.

Required coverage direction:

- migration creates the session table shape/constraints expected by Kysely tests;
- login with zero, one, and multiple memberships;
- tenant-less sessions cannot become `TenantActorContext`;
- selected membership revocation or deactivation invalidates selected sessions;
- user disable/deletion-equivalent invalidation path fails closed;
- token rotation invalidates prior token;
- idle renewal happens only after threshold and never extends beyond absolute
  expiry;
- logout/logout-all/revoke-by-membership primitives delete the intended rows only.

No Nuxt route tests in this task.

## Risks And Guardrails

- Do not push HTTP concerns into `server/auth/session`; keep it callable from
  tests and future adapters without an H3 event.
- Do not widen `server/auth/um` into a mixed RBAC+session omnibus module.
- Do not persist raw session tokens.
- Do not silently degrade a selected but stale membership session into
  tenant-less.
- Do not cache authorization grants in session rows.
