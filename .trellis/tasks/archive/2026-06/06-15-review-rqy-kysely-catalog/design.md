# Design — Review rqy Kysely catalog changes

## Problem

`KyselyCatalogRepository` has already been refactored to batch app upserts (`ensureApps`) and batch tenant-app enablement (`enableTenantApps`). The service layer and tests still assume the old scalar repository API. That leaves the codebase inconsistent and breaks compilation/behavior around catalog bootstrap and tenant app enablement.

## Decision

Adopt the repository batch contract as the new source of truth and refactor the service layer into a thin compatibility boundary for the rest of the server code.

### Service-layer shape

Keep scalar convenience methods at the `CatalogService` boundary where they still make sense for callers:

- `ensureDefaultApp()` remains a bootstrap helper, but internally calls `repository.ensureApps([{ ... }])` and unwraps the default entry.
- `enableDefaultAppForTenant(tenantId)` remains a bootstrap helper, but explicitly ensures the default app first, then calls `repository.enableTenantApps([{ tenantId, appKey: DEFAULT_APP_KEY }])`, then resolves and returns the enabled app.
- `enableTenantApp(input)` should no longer imply app creation. It should call `repository.enableTenantApps([input])` and then resolve the existing app/tenant state through read methods, or expose a renamed helper if source makes that cleaner.

### Missing read capability

Issue #10 implies tenant enablement must work only for existing apps. The repository implementation already avoids unconditional app upserts by joining against `apps` during `enableTenantApps`, but the service still needs a way to detect unknown app keys instead of pretending enablement succeeded.

Preferred fix:

- add a repository read method for app lookup by key (for example `findApp(key)`), or an equivalent service-private lookup query, and use it to fail fast for unknown apps before/after tenant enablement.
- keep bootstrap semantics explicit: only default-app/bootstrap paths may create apps.

### Caller migration

Refactor all setup helpers and tests to use the new service semantics:

- fixtures that bootstrap default apps for tenants keep using `enableDefaultAppForTenant`
- tests that need non-default apps must ensure the app exists via catalog sync/bootstrap before enabling it for tenants
- tests should assert behavior, not internal query structure

## Constraints

- Reuse current Kysely repository patterns and helpers (`pivotToColumns`, `unnest`, row mappers).
- Do not reintroduce scalar repository methods as compatibility shims.
- Preserve idempotence for repeated sync/bootstrap calls.
- Keep changes surgical: catalog service, directly affected tests/fixtures, and any immediately impacted server callers.

## Risks

- Silent success on enabling an unknown app key would leave issue #10 only partially fixed.
- Test fixtures may rely on implicit ordering/setup assumptions around registry sync and default app bootstrap.
- The repository/service contract changed, so stale exported types or imports could leave compile errors outside obvious callers.

## Verification

- Run targeted unit tests for catalog setup (`util-db.test.ts`) and affected service/auth suites.
- Confirm default-app setup remains idempotent.
- Confirm multi-app collection identity resolution still works.
- Confirm non-default tenant enablement uses an existing app and does not implicitly create one.
