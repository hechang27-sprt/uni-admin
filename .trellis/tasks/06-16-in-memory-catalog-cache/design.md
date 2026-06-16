# Design: In-memory catalog lookup cache

## Problem

`DocumentService.requireCollectionIdentity()` currently resolves tenant collection identity through `CatalogService -> CatalogRepository -> SQL join` on every document operation. That is correct but expensive for hot paths.

## Decision

Add a process-local read-through cache inside `CatalogService` for:

- app lookup by `appKey`
- tenant collection identity by `tenantId:appKey:collectionKey`

Keep the database as the source of truth. The cache only short-circuits repeated reads.

## Cache shape

### App cache

- Key: `appKey`
- Value: `CatalogApp | null`
- Consumers:
  - `CatalogService.enableTenantApp()` currently calls `repository.findApp(input.appKey)` before enablement.
  - `CatalogService.ensureDefaultApp()` currently calls `repository.ensureApps([DEFAULT_APP_BOOTSTRAP])`; if kept as-is, it should still refresh the cached default-app entry from the returned row.
- Purpose: avoid repeated app identity reads during tenant enablement and bootstrap-heavy tests.

### Collection cache

- Key: `${appKey}:${collectionKey}`
- Value: `CatalogCollection | null`
- Consumers:
  - `CatalogService.findCollectionIdentity()` direct callers.
  - catalog/unit tests that verify sync produced stable collection ids.
- Purpose: avoid repeated app-scoped collection lookups after registry sync.

### Tenant collection cache

- Key: `${tenantId}:${appKey}:${collectionKey}`
- Value: `CatalogCollection | null`
- Consumers:
  - `DocumentService.requireCollectionIdentity()`; this is the hot path behind local CRUD and remote projection operations.
  - direct tenant collection lookups in `test/unit/server/service.test.ts`.
- Purpose: avoid repeated `collections JOIN apps JOIN tenantApps` reads in steady state.

### Cache implementation

- App and app-scoped collection caches use plain `Map` because they only need exact-key lookup.
- Tenant collection cache uses `associum`'s `QueryableStructuredMultiKeyMap` keyed by `{ tenantId, appKey, collectionKey }`.
- Partial structured queries replace hand-maintained reverse index maps:
  - `{ tenantId, appKey }` invalidates one tenant/app boundary after enablement.
  - `{ appKey, collectionKey }` invalidates one touched collection boundary after sync.

## Utilization map

### Read paths

- `DocumentService.requireCollectionIdentity()` -> `CatalogService.findTenantCollectionIdentity()`
  - affects `create`, `createMany`, `list`, `update`, `updateMany`, `patch`, `softDelete`, `restore`, `hardDelete`, `syncRemoteOne`, `syncRemoteList`, `remoteCreate`, `remoteUpdate`, and `remoteDelete` because they normalize `(tenantId, appKey, collection)` through this helper.
- `CatalogService.findCollectionIdentity()`
  - used by catalog tests today; keep cached because it is the app-scoped analog and likely future read API.
- `CatalogService.enableTenantApp()` -> app existence lookup
  - currently the only non-default app read path.

### Mutation and invalidation paths

- `CatalogService.syncRegistryCollections()`
  - writes app/collection rows.
  - should refresh collection cache entries from returned `CatalogCollection[]`.
  - should invalidate tenant collection cache entries only for touched `(appKey, collectionKey)` pairs.
  - should not imply global pruning because current sync does not delete catalog rows absent from code.
  - `AuthRbacService.syncCollectionPermissions()` depends on this method, so touched-row refresh/invalidation must happen before permission sync resumes.
- `CatalogService.enableDefaultAppForTenant()`
  - writes `tenantApps` for the default app.
  - must clear tenant collection entries for `(tenantId, default)`.
  - should also refresh the default app cache entry from the ensured app row.
- `CatalogService.enableTenantApp()`
  - writes `tenantApps` for a non-default app.
  - must clear tenant collection entries for `(tenantId, input.appKey)`.
  - should populate or reuse the app cache for the validated app key.

## Invalidation strategy

Match current database semantics instead of inventing stronger ones:

- `syncRegistryCollections()` does not prune rows absent from the registry today.
- Therefore sync should:
  - upsert collection cache entries for returned rows
  - invalidate tenant collection cache entries for touched `(appKey, collectionKey)` pairs
  - leave unrelated cached app/collection rows alone
- `enableDefaultAppForTenant()` clears cached tenant entries for the default app boundary only.
- `enableTenantApp()` clears cached tenant entries for the target app boundary only.

If later code adds disable/remove or pruning behavior, widen invalidation at that time.

## Failure behavior

- Cache miss -> query DB -> store result -> return.
- Cache hit -> return without repository call.
- Negative lookup (`null`) should be cached only where the mutation paths above fully cover future state changes.
  - Safe candidates: app-scoped and tenant-scoped collection misses, because sync and tenant enablement are the only current writers.
  - If that assumption changes, drop negative caching before adding TTLs.

## Follow-up boundary refactor

- `DocumentService.requireCollectionIdentity()` is a hot-path symptom, not the ideal long-term boundary.
- Follow-up direction: replace it with a broader "resolve collection context once" helper in `DocumentService`, then pass resolved catalog identity into auth and repository work.
- Non-goal for this task: do not move catalog lookup into `AuthRbacService.evaluateAccess()`.

## Verification targets

- Catalog tests should verify repeated `findCollectionIdentity()` / `findTenantCollectionIdentity()` reads still return stable ids across sync and enablement sequences.
- Document service tests should verify the hot tenant lookup path still produces correct app/collection scoping after cache introduction.
- New focused tests can spy on repository methods from a real `CatalogService` instance to prove cache hit/miss behavior without changing repository contracts.

## Compatibility

- No API changes for callers.
- `DocumentService` keeps resolving identity through `CatalogService`.
- Repository layer remains DB-only.

## Risks

- Multi-process deployments: caches are per-process, so invalidation is not global. This is acceptable because the DB remains authoritative and reads fall back to DB on miss. If stronger freshness is needed later, add TTL or drop negative caching first.
- Stale reads after mutation: handled by explicit invalidation on sync and tenant enablement paths.
- Over-caching nulls: safe only while sync and tenant enablement remain the exclusive mutation paths.

## Non-goals

- No cache persistence across restarts.
- No separate distributed cache.
- No change to catalog schema authority.
