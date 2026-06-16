# Review catalog identity and session readiness

## Verdict

- `app-catalog-identity-migration`: valid after one source bug fix.
- Session endpoint implementation: can proceed after targeted planning refresh; no broad architecture replan required.
- Cleanup completed: app-aware remote adapter lookup, unknown permission grant failure, stale Kysely/docs/spec drift, and lint debt blocking the current project lint command.

## Fixed issues

### 1. App-aware remote collections bypassed `appKey`

Problem: remote document operations looked up remote adapters through the default-app registry path, so a non-default app remote collection could be registered/enabled but still fail or persist against the wrong collection identity.

Evidence:

- `server/data/documents/service/helpers.ts` now accepts `{ appKey?, collection }` and calls `registry.getForApp(appKey, collection)` when `appKey` is present.
- `server/data/documents/service/service.ts` now passes the full service input into `getRemoteAdapter(...)` and preserves `appKey` through `upsertRemoteProjection(s)`.
- `test/unit/server/service.test.ts` adds `uses app-aware registry identity for remote collections`.

Risk removed: non-default remote-backed apps no longer fall back to default-app string-only lookup.

### 2. Direct permission grant accepted unknown keys silently

Problem: `AuthRbacService.assignPermissionToRole(...)` validated `permissionKeys` without `throw: true`, then repository insertion joined through `permissions`. Unknown keys became a successful no-op.

Fix:

- `server/auth/um/service.ts` now calls `evaluateAccess({ permissionKeys: [input.permissionKey], throw: true })`.
- `test/unit/server/auth-rbac.test.ts` now asserts unknown grant keys reject with `AUTH_PERMISSION_NOT_FOUND` and do not call the repository mutation.

### 3. Session task artifacts had stale Drizzle mechanics

Fix:

- `.trellis/tasks/archive/2026-05/05-25-authentication-session-endpoints-brainstorm/design.md`
- `.trellis/tasks/archive/2026-05/05-25-authentication-session-endpoints-brainstorm/implement.md`

Updated to Kysely schema interfaces, manual/reviewed Kysely migration SQL, pgLite/Kysely tests, and explicit review of PostgreSQL-specific `UNLOGGED` raw SQL.

### 4. Docs/spec drift after catalog cutover

Updated:

- `docs/data-layer-development-notes.md`
- `docs/framework-dx-guide.md`
- `.trellis/spec/server/repository-and-database.md`
- `.trellis/spec/server/auth-rbac.md`

Corrections:

- no persisted `documents.collection` mirror;
- default app still requires catalog sync and tenant enablement before document writes;
- public auth import is `#server/auth/um`;
- protected list reads omit denied documents from `items` rather than returning positional nulls;
- repository contract uses `list(...)`, not removed `findByIds(...)`.

### 5. Lint blockers removed

Fixes included type-only imports, removed unused `ifTrueRef`, cleaned catalog repository/service lint issues, fixed `vitest.config.ts` numeric separator, and corrected `.gitnexus/run.cjs` ESLint violations.

## Catalog migration validation

Confirmed valid:

- `apps`, `tenant_apps`, `collections`, documents, permissions, and grants are represented in `server/db/schema.ts` and baseline migration.
- Document persistence scopes by `tenantId + appId + collectionId` in repository operations.
- Remote uniqueness is scoped by `tenant_id + app_id + collection_id + remote_source + remote_id`.
- Registry supports duplicate collection keys across apps.
- Permission keys are canonical `appId:collectionId:capabilityId` for collection permissions via `buildPermissionKey(...)`.
- `rolePermissions.permissionKey` references `permissions.key`; no runtime `permissionId`/`permission_id` usage remains.

Intentional delta from old checklist: source already did the clean cutover and removed the transitional persisted `documents.collection` mirror. Current specs match source.

## Session readiness

Proceed after targeted cleanup, which is now done for the stale planning artifacts.

Implementation preconditions still required in the session task:

- add `server/auth/session/` as a sibling module, not ad hoc code inside `server/auth/um`;
- add Kysely `authSessions` typing plus reviewed `auth_sessions` migration SQL;
- validate runtime config before route handlers create sessions;
- add `server/api/auth/*` route surface and H3 cookie/origin helpers;
- keep sessions identity-only: no permission or role state cached in sessions;
- resolve active user and active selected membership on each session load.

## Verification

Passed:

- `bun run test test/unit/server/util-db.test.ts test/unit/server/service.test.ts test/unit/server/auth-rbac.test.ts` — 3 files, 52 tests.
- `bun run typecheck`.
- `bun run lint`.
- LSP workspace diagnostics: no TypeScript issues.
- `gitnexus_detect_changes(scope: "all", repo: "uni-admin")` ran.

GitNexus reported `critical` risk because changes touch 23 symbols and 22 indexed execution flows, mostly remote document and auth/catalog flows. Targeted tests cover the touched behavior.

## Residual risks

- Session routes do not exist yet; future implementation must add new session tests and Nuxt route tests.
- `auth_sessions` `UNLOGGED` behavior still needs explicit migration review because pgLite cannot prove PostgreSQL crash/failover semantics.
- The current review did not implement user-disable or membership-revoke admin routes; session revocation primitives must be integrated when those routes exist.
