# Authentication Session Endpoints Design

## Scope

This milestone introduces the first Nuxt/Nitro authentication route surface
over the existing auth/RBAC service layer. It owns opaque browser sessions,
tenant selection, session revocation primitives, and a reusable
authenticated-request boundary.

Protected document CRUD routes, generated UI, membership administration,
account administration, cross-origin browser support, and rate limiting remain
outside this milestone.

## Architecture

The design extends the existing server boundaries rather than letting route
handlers query Drizzle directly:

- `server/db/schema.ts` and a reviewed SQL migration define session
  persistence.
- The `server/auth` domain owns session types, persistence methods, session
  lifecycle behavior, and conversion from a selected session into
  `TenantActorContext`.
- A small Nitro/H3-facing auth utility owns cookie parsing/writing, server
  runtime configuration, generic unauthenticated handling, and same-origin
  mutation validation.
- `server/api/auth/*.get.ts` and `*.post.ts` handlers parse input, call auth
  operations, and translate expected failures into the approved HTTP
  contract.

No permission or role grant is materialized into a session. A future protected
route receives `TenantActorContext` only after session and selected-membership
validation, then continues through the existing database-backed RBAC path.

## Session Data Model

Add a typed `auth_sessions` table represented in Drizzle and created as a
PostgreSQL `UNLOGGED` table in its migration.

Proposed columns:

| Column | Purpose |
| --- | --- |
| `token_hash` | Primary-key lookup value derived from the opaque cookie token; the raw token is never persisted. |
| `user_id` | Required user identity; foreign key to `users` with delete cascade. |
| `tenant_id` | Nullable currently selected tenant. `null` represents an authenticated tenant-less session. |
| `created_at` | Session creation timestamp. |
| `last_renewed_at` | Last time sliding expiration was extended. |
| `expires_at` | Current idle/sliding expiry returned as `expiresAt`. |
| `absolute_expires_at` | Maximum lifetime returned as `absoluteExpiresAt`. |

Required indexes and constraints:

- Primary key or unique index on `token_hash` for request lookup.
- Index on `user_id` for logout-all and account-level revocation.
- Index on `(tenant_id, user_id)` for membership-specific revocation.
- Nullable composite foreign key `(tenant_id, user_id)` to
  `tenant_memberships(tenant_id, user_id)` with delete cascade where supported
  by the Drizzle declaration and generated SQL. This makes physical membership
  deletion remove sessions selected into that membership while leaving
  tenant-less sessions untouched.

The membership-status transition path must still call tenant-membership
revocation, because a foreign key does not invalidate a retained row that
becomes inactive.

The `UNLOGGED` choice is intentional: database recovery or failover can remove
sessions and require login again. Sessions cannot become valid again through
that behavior.

## Token And Cookie Contract

- Generate a cryptographically random opaque token with at least 256 bits of
  entropy and encode it for cookie use.
- Store a deterministic cryptographic hash, such as SHA-256, as
  `token_hash`; compare and index the hash, not the raw token.
- Rotate the token when selecting or changing tenant context. The old
  token/hash is invalid after the selection succeeds.
- Use one host-only cookie with `HttpOnly`, `SameSite=Lax`, `Path=/`, and
  `Secure` in production. Do not configure `Domain`.
- Cookie lifetime follows `expires_at`, bounded by `absolute_expires_at`.

## Runtime Configuration

Add server-only Nuxt runtime configuration with environment overrides:

| Runtime value | Environment override | Default |
| --- | --- | --- |
| idle timeout seconds | `NUXT_AUTH_SESSION_IDLE_TIMEOUT_SECONDS` | `28800` (8 hours) |
| renewal threshold seconds | `NUXT_AUTH_SESSION_RENEW_AFTER_SECONDS` | `3600` (1 hour) |
| absolute timeout seconds | `NUXT_AUTH_SESSION_ABSOLUTE_TIMEOUT_SECONDS` | `604800` (7 days) |

Configuration validation must reject non-positive or internally inconsistent
durations rather than creating sessions with unsafe lifetime behavior.

## Lifecycle Flows

### Login

1. Validate same-origin JSON mutation requirements and parse
   `{ username, password }`.
2. Use existing credential verification semantics. Unknown credential, wrong
   password, and inactive account all produce the same `401`.
3. Query active tenant memberships joined to tenant presentation data.
4. If exactly one active membership exists, create a session selected into
   that tenant. If zero or multiple exist, create a tenant-less session.
5. Set the opaque cookie and return the current-session view.

### Resolve Current Session

1. Read the cookie, hash it, and fetch its unexpired session joined to an
   active user.
2. For a selected session, require that its selected membership still exists
   and is active; a stale selected session is invalid, not silently converted
   to tenant-less.
3. If invalid, delete any reachable invalid/expired row when practical, clear
   the cookie, and produce the generic `401`.
4. If the renewal threshold has elapsed, extend `expires_at` and the cookie,
   clamped to `absolute_expires_at`.
5. Return session presentation data, or produce `TenantActorContext` only if a
   selected active tenant exists.

### List Selectable Tenants

Require a valid tenant-less or tenant-selected authenticated session, then
return the user's active memberships joined to tenant `{ tenantId, name }`
presentation data.

### Select Tenant

Require a valid session and same-origin JSON mutation, validate requested
active membership, and return `403` without distinguishing missing from
inactive/revoked membership when it is unavailable. When permitted, rotate
the token while setting/replacing `tenant_id`, set the new cookie, and return
the updated session view.

### Logout And Revocation

- Current logout is idempotent: delete the submitted token hash if present,
  clear the cookie, and return `204`.
- Logout-all requires a valid session, deletes every session row by its
  trusted `user_id`, clears the cookie, and returns `204`.
- Domain primitives revoke one current session, all sessions for one user, or
  selected sessions for one `(tenantId, userId)` membership so later account
  and membership administration can call the correct behavior.

## HTTP Contract

| Method | Route | Success | Failure behavior |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | `200` session view; set cookie | `400` malformed JSON/body; `401` generic credentials failure; `403` mutation-origin failure |
| `GET` | `/api/auth/session` | `200` session view | `401` generic invalid session and clear cookie |
| `GET` | `/api/auth/tenants` | `200` `{ tenants }` | `401` generic invalid session and clear cookie |
| `POST` | `/api/auth/select-tenant` | `200` session view; rotated cookie | `400` malformed body; `401` generic invalid session; `403` selection denial or mutation-origin failure |
| `POST` | `/api/auth/logout` | `204`; clear cookie | `403` mutation-origin failure |
| `POST` | `/api/auth/logout-all` | `204`; clear cookie | `401` generic invalid session; `403` mutation-origin failure |

Session view:

```ts
{
  user: { userId: string; displayName: string | null };
  tenant: { tenantId: string; name: string | null } | null;
  expiresAt: string;
  absoluteExpiresAt: string;
}
```

Selectable tenant response:

```ts
{ tenants: Array<{ tenantId: string; name: string | null }> }
```

HTTP errors should expose stable generic codes/messages appropriate to the
status, but not reveal disabled-account, expired-session, revoked-membership,
or missing-membership detail beyond the approved selection denial.

## Request Protection

H3 cookie-authenticated mutations require explicit CSRF handling. The route
adapter enforces this for every session mutation, including login because it
creates a login cookie:

- Require JSON content for POST bodies.
- Reject `Sec-Fetch-Site: cross-site`.
- Validate `Origin` against the application's accepted origin when it is
  present or required as the fallback signal.
- Retain `SameSite=Lax` cookies as defense in depth, not as the sole defense.

No CORS or token-based CSRF integration is introduced for a separately hosted
frontend in this milestone.

## Testing And Compatibility

- Keep service/repository behavior tests in `test/unit/server/` using pgLite
  and real Drizzle migrations, matching existing auth/RBAC coverage.
- Add Nitro route tests in the configured Nuxt test project for cookies, HTTP
  statuses, response bodies, and mutation guards.
- Cover login with zero, one, and multiple active memberships; tenant
  selection rotation; tenant-less actor rejection; inactive user/membership
  invalidation; idle renewal and absolute expiry; current logout; logout-all;
  and tenant-specific revocation.
- No existing route clients require migration because the repository currently
  has no server API route surface.

## Operational Notes

- The migration must be reviewed to confirm `UNLOGGED` DDL and indexes; a
  generated Drizzle migration may require deliberate SQL adjustment for the
  persistence mode.
- A PostgreSQL crash recovery or standby failover logs users out by losing
  unlogged session rows. This is accepted behavior, not a data-restoration
  bug.
- A future account/membership administration milestone must call the supplied
  revocation primitives in mutation transactions or otherwise preserve the
  fail-closed resolution contract.
