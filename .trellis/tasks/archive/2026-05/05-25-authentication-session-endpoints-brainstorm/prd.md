# Brainstorm authentication and session endpoints

## Goal

Define the next milestone for exposing the existing service-level
authentication and actor-scoped document authorization through Nuxt/Nitro
authentication and session endpoints, including whether any session-scoped
caching is warranted.

## User Value

- Application users can log in, establish an authenticated session, select a
  valid tenant context when needed, and later exercise protected admin
  capabilities through the framework.
- Framework adopters get an authenticated request boundary instead of manually
  resolving actors inside trusted server-only TypeScript.
- The session design leaves room for secure performance improvements without
  caching permission state prematurely.

## Confirmed Facts

- The project is a Nuxt 4 application using Nitro with the Bun preset.
- `AuthRbacService` already implements username/password verification,
  membership-based actor resolution, scoped RBAC, and bootstrap/setup helpers.
- `AuthRbacService.verifyUsernamePassword()` returns an active framework user
  or `null`; `resolveActor({ tenantId, userId })` then requires an active
  tenant membership and returns `TenantActorContext`.
- `resolveActor()` currently does not reload or check the user's active
  status; active-user enforcement exists at credential verification time only.
  Active-session behavior after user disabling therefore needs an explicit
  endpoint/session-boundary contract.
- The current auth repository can create/reactivate and find a single tenant
  membership; it does not yet expose tenant-membership listing or membership
  disabling/removal APIs needed for a full tenant-switcher management flow.
- `DocumentService` accepts actor context for protected document operations.
- Authentication/session endpoints are not implemented; current docs explicitly
  state that the backend is service-level only and Nuxt API routes/composables
  are deferred.
- There is currently no `server/api` route surface, cookie/session handling in
  source, or authentication/session dependency installed in `package.json`.
- There is currently no session/cache storage configuration or cache
  invalidation abstraction in source.
- Although the schema contains active-status fields and cascading deletion
  relationships for users and tenant memberships, the public auth service
  currently exposes membership creation/reactivation only; user disabling,
  account deletion, membership revocation, and global logout are not yet
  implemented mutation boundaries.
- Existing pgLite tests verify credential authentication, tenant actor
  resolution, and actor-scoped document authorization at the service layer;
  endpoint/session behavior has no test coverage yet.
- Nuxt's official Nuxt 4 authentication recipe uses `nuxt-auth-utils`, whose
  current module contract provides sealed-cookie sessions and Nitro server
  helpers including `setUserSession`, `clearUserSession`, and
  `requireUserSession`; it requires a Nuxt server runtime and a
  `NUXT_SESSION_PASSWORD` secret.
- Nitro has a server-side key-value storage abstraction backed by `unstorage`;
  the installed Nitro dependency already carries `unstorage`/`ioredis`
  transitively, but this application has not configured a Redis session store
  or made Redis a runtime prerequisite.
- PostgreSQL is already required runtime infrastructure for this framework.
  Prior task planning selected PostgreSQL-backed records and an optional
  in-process worker for queued operations, while explicitly allowing that
  in-process execution must be disabled or replaced in horizontally scaled
  deployments.
- The framework intends to remain multi-tenant, with authorization dependent
  on both `tenantId` and `userId`.
- The batch-only database primitive milestone exists separately and is marked
  `in_progress`; this brainstorming task should account for its resulting
  authorization access patterns without folding that implementation into the
  endpoint milestone.

## Scope Decisions

- The first endpoint milestone is limited to session lifecycle endpoints and a
  reusable authenticated-request boundary that resolves `TenantActorContext`.
- Protected document API routes are deferred to a subsequent milestone. This
  keeps document transport contracts and route-level RBAC behavior out of the
  initial session trust-boundary implementation.
- An authenticated session represents a user identity with zero or one active
  tenant context. Login automatically selects the tenant when the
  authenticated user has exactly one active membership; when the user has
  zero or multiple active memberships, login creates a tenant-less
  authenticated session. At no point does a session associate the identity
  with more than one active `tenantId`.
- The eventual generated UI should allow an authenticated user to switch among
  tenants where that user has an active membership. A tenant switch changes the
  session's absent or single active `tenantId`; it does not broaden one
  session across tenants.
- The endpoint MVP includes a tenant-switch operation for an authenticated
  user. It validates active membership in the requested tenant and sets or
  replaces the session's one active `tenantId`; the tenant-switcher UI remains
  deferred.
- The endpoint MVP includes an authenticated active-membership discovery
  endpoint so a tenant-less session can obtain its selectable tenants. It
  returns only active memberships joined to existing tenant presentation data,
  currently `tenantId` and nullable `name`; membership administration remains
  deferred.
- `GET /api/auth/session` exposes a minimal authenticated session view: the
  active user's `userId` and nullable `displayName`, a nullable selected tenant
  containing `tenantId` and nullable `name`, and session expiration timestamps
  needed for client expiry handling. It does not duplicate the selectable
  membership list or include permission/role state.
- Tenant-less sessions are authenticated only for account/session operations,
  membership discovery, and tenant selection. They cannot resolve
  `TenantActorContext` or authorize any tenant-scoped application operation
  until an active tenant is selected.
- The endpoint/session MVP does not add a session-validation cache. A valid
  opaque session is a live database row; authorization remains database-backed
  through the existing RBAC queries.
- Global revocation is required: the endpoint/session design must support a
  "log out everywhere" operation and must ensure account deletion disables all
  outstanding sessions for that user.
- Membership revocation is tenant-specific: it must invalidate an outstanding
  session whose selected `tenantId` is the revoked membership, without
  unnecessarily invalidating sessions the same user holds for other active
  tenant memberships or tenant-less sessions.
- The selected session model is a PostgreSQL `UNLOGGED` opaque-session table.
  The browser holds only a high-entropy random session token, and PostgreSQL
  stores a hash of that token with the active `userId`, a nullable selected
  `tenantId`, and expiration metadata.
- The session table is indexed by `userId` and `(tenantId, userId)` so current
  logout, global logout/account deletion, and tenant-membership revocation are
  direct row deletions without maintaining multiple reverse-index maps.
- The `UNLOGGED` trade-off is accepted for this session data: PostgreSQL
  crash/unclean recovery or failover may clear active sessions and require
  users to authenticate again. It must not restore or preserve a session that
  should have been revoked.
- Tenant switching rotates the opaque token and sets or replaces the stored
  session's active `tenantId` after validating membership in the requested
  tenant.
- Session records hold authentication context only; permissions and role
  grants stay database-backed and are not copied into the session.
- User disable/delete and membership revoke administration mutations are
  deferred. This milestone exposes explicit session revocation primitives
  (`revokeSession`, user-wide revocation, and tenant-membership revocation) so
  later admin operations can invoke the correct invalidation contract.
- Sessions should support sliding idle expiration backed by session-row time
  fields and matching cookie renewal, rather than requiring daily
  reauthentication during active use.
- Sliding renewal must not update the session row on every authenticated
  request. It should renew only after a defined threshold, while still
  enforcing an absolute maximum lifetime so a continuously used or stolen
  session cannot remain valid indefinitely.
- Sliding-session timing is server-configurable through Nuxt runtime
  configuration and its environment-variable overrides. Initial defaults are
  an 8-hour idle timeout, renewal no more frequently than once per hour of
  activity, and a 7-day absolute maximum lifetime.
- The proposed environment overrides are
  `NUXT_AUTH_SESSION_IDLE_TIMEOUT_SECONDS` (`28800`),
  `NUXT_AUTH_SESSION_RENEW_AFTER_SECONDS` (`3600`), and
  `NUXT_AUTH_SESSION_ABSOLUTE_TIMEOUT_SECONDS` (`604800`).
- When renewal occurs, the server updates both the cookie expiration and the
  session-row idle expiration, clamped to the absolute expiration timestamp.
- The MVP treats cookie-authenticated or cookie-creating state-changing
  session endpoints as same-origin browser operations. `login`, `logout`,
  `logout-all`, and `select-tenant` accept JSON requests from the application
  origin rather than supporting separately hosted or third-party
  cookie-authenticated clients.
- The opaque session cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and
  `Secure` in production. It must not set a broad `Domain` attribute.
- State-changing cookie-authenticated endpoints reject cross-site browser
  requests using `Sec-Fetch-Site` where available and verify `Origin` as the
  fallback/target-origin check. They require JSON request content for request
  bodies; a cross-origin/CORS and CSRF-token contract is deferred until a
  separate frontend or third-party browser client is required.
- An authenticated request resolves successfully only while its session row
  and user account are valid and active. When the session has a selected
  `tenantId`, tenant-scoped resolution additionally requires the active
  `(tenantId, userId)` membership on every request, ideally in one database
  query, rather than trusting a surviving session row by itself.
- Explicit user-wide and tenant-membership revocation primitives remain
  required for immediate cleanup and later administration workflows, while
  per-request revalidation provides fail-closed behavior if cleanup is missed
  or authorization-related rows are modified outside those workflows.
- Endpoint authentication failures are non-enumerating. Login does not expose
  whether the username is unknown, password is wrong, or account is inactive;
  it returns one generic authentication failure in all such cases.
- Requests presenting an invalid, expired, revoked, deleted-user, disabled-user,
  or otherwise no-longer-valid session receive the same unauthenticated
  response and clear the session cookie. Membership-specific reasons are not
  exposed through the session endpoint response.
- `POST /api/auth/logout` is idempotent. It clears the session cookie and
  succeeds whether or not the submitted cookie identifies a current live
  session row, so sign-out remains reliable after expiry, revocation, or
  session loss during database recovery/failover.
- `POST /api/auth/logout-all` requires a currently valid authenticated
  session, because revoking all sessions requires trusted user identity. If
  the current session is invalid, it clears that cookie and returns the
  generic unauthenticated response rather than acting on client-supplied
  identity.
- When a valid authenticated session attempts to select a tenant for which
  the user does not have an active membership, tenant selection is denied
  explicitly as a forbidden operation. The response must not distinguish a
  nonexistent tenant membership from an inactive or revoked membership.
- The endpoint contract for this milestone is:

  | Method | Path | Successful result |
  | --- | --- | --- |
  | `POST` | `/api/auth/login` | `200`; verifies `{ username, password }`, creates an opaque session, auto-selects a tenant only for exactly one active membership, sets the cookie, and returns the current-session view. |
  | `GET` | `/api/auth/session` | `200`; returns the current-session view for a valid tenant-less or tenant-selected session. |
  | `GET` | `/api/auth/tenants` | `200`; returns the authenticated user's active selectable tenants as `{ tenantId, name }` items. |
  | `POST` | `/api/auth/select-tenant` | `200`; accepts `{ tenantId }`, validates active membership, rotates the session token, selects that tenant, and returns the updated current-session view. |
  | `POST` | `/api/auth/logout` | `204`; idempotently clears the cookie and deletes the current session row when one exists. |
  | `POST` | `/api/auth/logout-all` | `204`; for a valid authenticated session, deletes all sessions for its user and clears the current cookie. |

- The current-session response contains
  `{ user: { userId, displayName }, tenant: { tenantId, name } | null, expiresAt, absoluteExpiresAt }`;
  the tenant-list response contains `{ tenants: Array<{ tenantId, name }> }`.
- Malformed request payloads return `400`. Generic login or session
  authentication failures return `401`. Authenticated selection of an
  inaccessible tenant returns `403`. Failed same-origin/CSRF validation also
  returns `403`.
- `/api/auth/select-tenant` covers both first selection from a tenant-less
  session and later switches from one selected tenant to another.
- Login-attempt throttling and rate limiting are not part of this task's
  requirements or implementation scope.

## Evaluated Session Store Options

- **In-memory LRU opaque sessions:** lowest operational cost and fast direct
  revocation within one Bun/Nitro process. This is acceptable only for an
  explicitly single-process deployment; restart, redeploy, or capacity
  eviction logs sessions out, and replicas cannot share lookup/revocation.
- **PostgreSQL-backed opaque sessions:** use a session table with an opaque
  cookie token, expiration, and indexes for user-wide and
  `(tenantId, userId)` revocation. It adds one datastore lookup per
  authenticated request but introduces no new runtime infrastructure and
  scales consistently with the existing database dependency.
- **PostgreSQL `UNLOGGED` opaque sessions:** use the same typed session-table
  contract without write-ahead logging. It shares sessions across application
  processes through the existing primary database and reduces WAL overhead,
  but PostgreSQL truncates the table after a database crash/unclean shutdown
  and does not replicate its data to standby servers. That behavior is
  acceptable only if unexpected logout after database recovery or failover is
  an explicit operational contract.
- **Redis/Valkey-backed opaque sessions:** use shared low-latency session
  records plus user and membership reverse indexes with TTLs. It supports
  multiple server processes and efficient revocation, but introduces Redis as
  authentication-critical infrastructure and must fail closed if unavailable.
- **Sealed cookie plus database revocation version(s):** avoid per-session
  records but still read persisted account/membership revocation state during
  authentication. It supports global/tenant invalidation but is less natural
  for listing or revoking individual sessions.
- **Pure sealed-cookie sessions:** do not meet the selected immediate global
  and membership-specific revocation requirements without additional
  server-side state.
- **PostgreSQL `hstore`:** not a session-store alternative. It is a typed
  key/value value within a PostgreSQL row; storing session indexes in one
  mutable `hstore` value would create row contention and make expiry/revocation
  queries less natural than typed session rows with ordinary indexes.

## Initial Scope To Explore

- Login, logout, active-membership discovery, tenant switch, and
  current-session/current-actor endpoint responsibilities.
- Session representation, storage/signing mechanism, expiration, rotation,
  invalidation, and tenant selection behavior.
- How server route handlers reconstruct or resolve `TenantActorContext`.
- How disabled users, removed memberships, or changed roles affect existing
  sessions.
- Whether session-level caching is needed for actor or authorization resolution,
  and what invalidation contract would make it safe.
- Integration-test and security requirements for the first authenticated route
  slice.

## Acceptance Criteria

- [x] Brainstorm establishes the session/authentication trust boundary and
      threat assumptions for the MVP.
- [x] PRD defines required endpoints and their observable authentication,
      tenant, expiration, and error behavior.
- [x] PRD resolves whether sessions store only identity/context claims or also
      store/caches derived authorization state.
- [x] PRD defines how permission, membership, credential, and user-status
      changes affect active sessions.
- [x] PRD separates endpoint/session MVP scope from protected document CRUD
      routes, client composables, and generated UI unless those are
      intentionally bundled into the milestone.
- [x] Research/design, if needed, evaluates the appropriate Nuxt/Nitro session
      mechanism and any cache invalidation implications before implementation.
- [x] Complex implementation work receives `design.md` and `implement.md`
      after the brainstorm converges and before the task is started.

## Likely Out Of Scope Until Decided

- Generated admin UI and permission-management UI.
- Protected document CRUD API routes and client composables.
- Generated tenant-switcher UI and membership management UI.
- User disable/delete and tenant-membership revoke management operations and
  routes.
- Cross-origin browser clients and their CORS/CSRF-token contract.
- Login-attempt throttling and rate limiting.
- Custom actions and operation queue workers.
- Broad performance caching without measured need and explicit invalidation
  semantics.

## Open Questions For The Next Session

- No unresolved product-scope decision currently blocks technical design and
  implementation planning.

## Notes

- This task is intentionally left in `planning` for a dedicated brainstorming
  session.
- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
