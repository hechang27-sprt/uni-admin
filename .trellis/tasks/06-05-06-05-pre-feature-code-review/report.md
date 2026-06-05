# Pre-feature architecture review  
_For `.trellis/tasks/archive/2026-05/05-25-authentication-session-endpoints-brainstorm`_

## Executive summary

**Verdict: proceed, but do a small amount of targeted cleanup/design correction first.**

I do **not** see evidence that the current codebase needs a broad refactor before implementing auth-session endpoints. The existing server code is coherent, typed, and passing targeted tests.

What **does** need attention first is narrower:

1. **Update the feature design to match the live architecture**
   - current DB/migration stack is **Kysely**, not the older Drizzle-shaped assumptions in the archived task
2. **Define the session/runtime boundary explicitly**
   - there is still no `server/api` layer, no Nuxt `runtimeConfig` for session settings, and no auth/session helper abstraction
3. **Fix one important auth-domain gap in the design**
   - current actor resolution does **not** re-check user active status after login; session resolution must do that
4. **Add missing auth primitives needed by the session milestone**
   - membership listing, session/user/membership revocation, and selected-session resolution

So: **cleanup first, but only the cleanup that makes the new feature safe and straightforward.**  
I would **not** pause for a generic architecture refactor.

---

## Scope reviewed

### Runtime / frontend / route surface
- `package.json`
- `nuxt.config.ts`
- `app/app.vue`
- `app/assets/css/main.css`
- `server/api/**/*` presence check

### Server / DB / DI / auth surface
- `server/auth/index.ts`
- `server/auth/repository.ts`
- `server/auth/service.ts`
- `server/auth/types.ts`
- `server/db/schema.ts`
- `server/db/migrate.ts`
- `server/db/migrations/001-baseline.ts`
- `server/di/container.ts`
- `server/di/tokens.ts`
- `server/utils/kysely.ts`

### Tests / validation
- `test/unit/server/auth-rbac.test.ts`
- `test/unit/server/service.test.ts`
- `test/unit/server/util-db.test.ts`
- targeted file diagnostics
- repo typecheck

---

## Verified baseline

### Current architecture is internally consistent
- Auth/RBAC is service-level and DB-backed through `AuthRbacService` + `KyselyAuthRbacRepository`
- DI is simple and consistent via `createServerContainer(...)`
- DB access is Kysely-based in both runtime and tests
- Existing auth/document tests pass
- Typecheck passes

### What already works well
- Repository/service split is clear
- DI is boring and understandable
- pgLite-backed server tests are in place
- No partial, half-finished session/auth-route implementation exists to unwind
- Frontend is still mostly blank, so there is little migration pressure

This is a good place to add the next feature **if** the session feature is planned against current reality.

---

## Findings

## 1. Must-fix before implementation

### 1.1 Archived implementation plan is stale against the live DB architecture
**Severity:** High  
**Recommendation:** Fix before feature work starts

#### Observed
- Active migrator is Kysely-only: `server/db/migrate.ts:8-20`
- Active baseline migration is handwritten Kysely SQL: `server/db/migrations/001-baseline.ts:5-145`
- Typed schema has no session table yet: `server/db/schema.ts:108-120`

#### Why this matters
The archived session task still assumes a migration/tooling flow that no longer matches the live codebase. If you start building from that plan directly, you will make early design mistakes around:
- where the session table lives
- how migrations are authored
- how migration review happens
- how tests prove schema behavior

#### Required cleanup
Before implementation, rewrite the feature plan so it assumes:
- **new Kysely migration file**
- **new Kysely `Database` schema entries**
- manual verification of PostgreSQL-specific clauses if you keep `UNLOGGED`

#### Decision
Do this **first**. It is not optional.

---

### 1.2 Session/runtime boundary does not exist yet
**Severity:** High  
**Recommendation:** Define before coding

#### Observed
- No API route surface exists yet
- `find server/api/**/*` returned no files
- `nuxt.config.ts:4-30` has no `runtimeConfig`
- `package.json:20-55` has no session/auth runtime dependency
- `app/app.vue:1-6` is still the welcome screen

#### Why this matters
The session milestone needs new boundaries that do not currently exist:
- cookie parsing/writing
- session timeout config
- same-origin / CSRF checks
- route error mapping
- authenticated request loading

If you do not design these first, the feature will likely leak framework/H3 logic into the auth service or repository.

#### Required cleanup
Before implementation, decide the split:

**Recommended boundary**
- `server/auth/*` owns:
  - session domain types
  - session persistence contracts
  - session lifecycle behavior
  - selected-tenant resolution rules
- `server/api/auth/*` owns:
  - request parsing
  - cookie IO
  - HTTP mapping
  - same-origin / mutation guards
- `nuxt.config.ts` / runtime config owns:
  - session timeout values
  - accepted origin / server-only config

#### Decision
Do the boundary design first; don’t start by writing handlers.

---

### 1.3 Current actor resolution is not sufficient for session resolution
**Severity:** High  
**Recommendation:** Address in design before implementation

#### Observed
- `verifyUsernamePassword()` enforces active user status: `server/auth/service.ts:85-100`
- `resolveActor()` checks tenant membership/access only: `server/auth/service.ts:108-128`
- membership validation flows through `findInvalidActiveMembershipUserId()`: `server/auth/service.ts:482-510`
- that repository query checks membership, not user activity: `server/auth/repository.ts:247-267`

#### Why this matters
The session milestone needs this invariant:

> a session must fail closed when the user is disabled/deleted, even if membership rows still exist

The current auth surface does **not** guarantee that on every request.

If you reuse existing actor resolution without adding a stronger session-resolution query, you risk stale authenticated sessions surviving account disablement.

#### Required cleanup
Before implementation, choose one canonical session-resolution path that validates:
- session existence
- expiration
- active user
- selected membership existence
- selected membership active status

#### Decision
Do **not** just compose `verifyUsernamePassword()` and `resolveActor()` and assume that is enough.

---

## 2. Strongly recommended during pre-work or early implementation

### 2.1 Add missing auth-domain primitives instead of overloading current ones
**Severity:** Medium  
**Recommendation:** Add as first-class APIs, not ad hoc queries in routes

#### Observed
Current repository/service surface has:
- membership creation
- single membership lookup
- active membership lookup
- invalid membership batch check

It does **not** have:
- active memberships list by user
- membership list joined to tenant names
- session revocation by current token/session
- revocation by user
- revocation by `(tenantId, userId)`

#### Why this matters
The archived feature requires:
- login auto-select when exactly one active membership exists
- tenant discovery endpoint
- logout
- logout-all
- membership-specific invalidation

Trying to bolt those onto route handlers would be the wrong architecture.

#### Required cleanup
Add explicit auth/session-domain contracts for:
- `listSelectableMemberships(userId)`
- `resolveSession(...)`
- `createSession(...)`
- `renewSession(...)`
- `rotateSession(...)`
- `revokeSession(...)`
- `revokeUserSessions(...)`
- `revokeMembershipSessions(...)`

#### Decision
This belongs in `server/auth`, not in `server/api`.

---

### 2.2 Decide whether DI needs new collaborators
**Severity:** Medium  
**Recommendation:** small extension, not redesign

#### Observed
Current DI tokens are minimal: `server/di/tokens.ts:1-8`

That is fine today, but session work may introduce non-DB collaborators:
- token generator
- token hasher
- clock
- runtime/session config adapter

#### Why this matters
If you avoid deciding this, token/time/config logic may end up hidden inside service methods and become hard to test.

#### Recommended direction
Keep DI simple. Add seams only where they buy testability or determinism.

**Boring option**
- add a small session repository inside `server/auth`
- keep clock/hash/token helpers as small internal functions unless tests push you otherwise
- inject runtime config at the route/helper boundary, not deep into repository code

#### Decision
Extend DI only as needed. Do not introduce a large new service graph.

---

### 2.3 Re-plan PostgreSQL-specific session semantics vs pgLite test strategy
**Severity:** Medium  
**Recommendation:** decide before migration lands

#### Observed
- Tests run through pgLite: `server/utils/kysely.ts:30-43`
- Existing auth/service tests migrate pgLite DBs
- Archived session design wants PostgreSQL `UNLOGGED`

#### Why this matters
`UNLOGGED` is a PostgreSQL runtime/storage contract, not just a schema shape. Current tests prove Kysely behavior and baseline SQL, but not necessarily the exact persistence semantics you care about.

#### Recommended cleanup
Decide one of these:
1. keep `UNLOGGED`, but explicitly treat it as a reviewed production DDL concern that pgLite cannot fully simulate
2. revise the session storage requirement if the operational tradeoff is no longer worth the special-case complexity

#### Decision
Make this explicit in the refreshed design. Do not leave it implied.

---

## 3. Things I do **not** think you need to refactor first

### 3.1 No broad auth/RBAC refactor
Current auth code is not obviously over-abstracted or collapsing under feature pressure. The main issue is **missing session-specific APIs**, not a broken existing shape.

### 3.2 No broad DI rewrite
The container is small and clear. It does not need a framework cleanup before session work.

### 3.3 No frontend cleanup pass
Frontend is still minimal:
- `app/app.vue:1-6`
- `app/assets/css/main.css:1`

There is almost nothing to refactor here before server-side session work.

### 3.4 No document-service architecture changes for this milestone
The archived session milestone is correctly separated from protected document CRUD routes. Keep that separation.

---

## Recommended pre-feature work order

## Option A — minimal, recommended
A short prep pass before implementation:

1. **Refresh the archived design/implement plan**
   - Kysely, not Drizzle
   - current route/runtime reality
2. **Define the session boundary**
   - auth domain vs route adapter vs runtime config
3. **Define the missing auth/session contracts**
   - list memberships
   - session resolve/create/renew/rotate/revoke
4. **Decide PostgreSQL `UNLOGGED` strategy**
   - keep or revise, explicitly
5. **Then implement**

This is the path I recommend.

---

## Concrete refactor/cleanup list

### Do before implementing the feature
- [ ] Replace archived migration assumptions with a Kysely-native migration plan
- [ ] Add a clear runtime config design for session settings
- [ ] Define one canonical session-resolution path that re-checks active user state
- [ ] Add explicit auth-domain APIs for membership listing and session revocation
- [ ] Decide how PostgreSQL-specific session DDL is verified

### Can be done inside the feature task, but early
- [ ] Add any new DI tokens only if hashing/clock/config need clean seams
- [ ] Add route helper module for cookie IO and same-origin checks
- [ ] Add focused tests for disabled-user / stale-membership / tenant-less session behavior

### Do **not** do as a separate cleanup project
- [ ] full auth service rewrite
- [ ] DI architecture overhaul
- [ ] frontend reorganization
- [ ] document service refactor unrelated to session boundaries

---

## Suggested target architecture for the next feature pass

```md
server/auth/
  types.ts              # session domain types added here
  repository.ts         # session persistence + membership listing + revocation queries
  service.ts            # session lifecycle + validation + selection logic

server/api/auth/
  login.post.ts
  session.get.ts
  tenants.get.ts
  select-tenant.post.ts
  logout.post.ts
  logout-all.post.ts

server/api/auth/_internal/
  session-cookie.ts     # read/write/clear cookie
  session-guards.ts     # JSON + origin / fetch-site checks
  session-runtime.ts    # runtime config parsing/validation
```

This preserves the current repo’s existing separation style.

---

## Validation already run

### Diagnostics
- `server/auth/service.ts` — OK
- `server/auth/repository.ts` — OK
- `nuxt.config.ts` — OK

### Typecheck
- `bun run typecheck` — passed

### Targeted tests
- `bun run vitest --project unit test/unit/server/auth-rbac.test.ts test/unit/server/util-db.test.ts` — passed, 16 tests
- `bun run vitest --project unit test/unit/server/service.test.ts` — passed, 12 tests

---

## Final recommendation

**Yes, do a pre-feature cleanup/review step — but keep it narrow.**

You do **not** need a major architecture refactor before auth-session endpoints.  
You **do** need to correct the feature design so it matches the current codebase and fills the missing session-domain seams.

### Short version
- **Do first:** refresh plan, define boundaries, add missing auth/session contracts
- **Do not do:** broad rewrite of auth/DI/frontend
- **Safe to proceed after:** the above design cleanup is done

If you want, I can turn this into a checked-in markdown artifact under the current task directory, e.g. `review.md` or `pre-feature-review.md`.
