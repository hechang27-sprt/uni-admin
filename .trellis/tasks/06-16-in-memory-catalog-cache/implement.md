# Implementation Plan: In-memory catalog lookup cache

## 1. Add cache state to `CatalogService`

- Add three private `Map` instances:
  - app by `appKey`
  - collection by `appKey:collectionKey`
  - tenant collection by `tenantId:appKey:collectionKey`
- Add tiny private key helpers; avoid per-call object allocation beyond the key string.
- Keep cache ownership in `CatalogService`; do not leak caching into repositories or `DocumentService`.

## 2. Wrap read paths with read-through caching

- `ensureDefaultApp()`
  - still call `repository.ensureApps([DEFAULT_APP_BOOTSTRAP])` for idempotent bootstrap.
  - refresh the default-app cache entry from the returned row.
- `enableTenantApp()`
  - replace the direct `repository.findApp()` read with a cached app lookup helper.
- `findCollectionIdentity()`
  - add app-scoped collection cache lookup -> repository fallback -> cache populate.
- `findTenantCollectionIdentity()`
  - add tenant collection cache lookup -> repository fallback -> cache populate.
- Preserve existing return types and `DocumentServiceError` behavior.

## 3. Add refresh/invalidation helpers tied to mutation paths

- Touched-collection invalidation helper:
  - upsert collection cache entries for returned `CatalogCollection[]`
  - delete tenant collection entries matching each touched `(appKey, collectionKey)`
- Tenant/app-scoped invalidation helper:
  - delete only tenant collection entries for one `(tenantId, appKey)` boundary.
- Do not globally clear app/collection caches on sync; current `syncCollections()` does not prune absent rows.
- Call touched-collection refresh/invalidation from `syncRegistryCollections()` after successful repository sync.
- Call tenant/app-scoped invalidation from:
  - `enableDefaultAppForTenant(tenantId)` for `default`
  - `enableTenantApp({ tenantId, appKey })` for the target app

## 4. Check every current utilization point

- `DocumentService.requireCollectionIdentity()`
  - confirm all local CRUD and remote operations continue to normalize through the cached tenant lookup path.
  - note follow-up refactor target: resolve collection context once, rather than pushing catalog lookup into auth.
- `AuthRbacService.syncCollectionPermissions()`
  - confirm it benefits from `syncRegistryCollections()` touched-row refresh semantics and does not observe stale app/collection identities.
- direct catalog lookup tests in:
  - `test/unit/server/util-db.test.ts`
  - `test/unit/server/service.test.ts`

## 5. Add focused tests

- `test/unit/server/util-db.test.ts`
  - repeated `findCollectionIdentity()` returns stable rows and can prove one repository read after warmup.
  - repeated `enableTenantApp()` / `enableDefaultAppForTenant()` keep app lookup behavior correct.
  - sync after warm cache refreshes touched collection entries without globally invalidating unrelated cached rows.
- `test/unit/server/service.test.ts`
  - repeated `findTenantCollectionIdentity()` for enabled apps returns stable identities.
  - touched collection sync invalidates only affected tenant collection cache entries.
  - document operations still isolate same-named collections across apps after cache warmup.
- Prefer behavior plus targeted repository-call assertions; do not snapshot internal maps.

## 6. Validation commands

- Run the focused server unit tests covering catalog identity and document lookup behavior.
- Minimum expected coverage:
  - `test/unit/server/util-db.test.ts`
  - `test/unit/server/service.test.ts`

## 7. Rollback

- Remove cache maps and helper methods.
- Restore direct repository reads in `CatalogService`.
- Leave repository/database behavior unchanged.
