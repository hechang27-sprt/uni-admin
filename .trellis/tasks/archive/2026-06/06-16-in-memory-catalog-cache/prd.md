# Design in-memory catalog lookup cache

## Goal

Reduce per-document catalog lookup cost by caching catalog identity and app enablement lookups in process, while keeping the database as the source of truth.

## Requirements

- Cache `findApp(key)` results in-process because non-default tenant enablement currently re-reads `apps` through `CatalogService.enableTenantApp()`.
- Cache `findCollectionIdentity({ appKey, collectionKey })` results in-process because catalog tests and future callers use app-scoped collection lookup after sync.
- Cache `findTenantCollectionIdentity({ tenantId, appKey, collectionKey })` results in-process because `DocumentService.requireCollectionIdentity()` calls it for every create, list, update, patch, delete, and remote projection path.
- Keep DB lookups as the fallback on cache miss; repository contracts stay unchanged.
- Refresh cached collection entries from `syncRegistryCollections()` results instead of treating sync as a full cache reset.
- Invalidate tenant-scoped collection entries touched by `syncRegistryCollections()`, `enableDefaultAppForTenant()`, or `enableTenantApp()`.
- Preserve correctness across app/collection renames, sync updates, and tenant enablement changes while matching current non-pruning sync semantics.
- Keep auth/RBAC sync behavior correct because `AuthRbacService.syncCollectionPermissions()` currently calls `CatalogService.syncRegistryCollections()` before permission upserts.
- Do not move catalog authority out of the database.

## Acceptance Criteria

- [ ] `DocumentService.requireCollectionIdentity()` can reuse hot tenant collection identities without a DB join on every call.
- [ ] `CatalogService.enableTenantApp()` and `ensureDefaultApp()` can reuse hot app identities without repeated `findApp()` / equivalent reads.
- [ ] `CatalogService.findCollectionIdentity()` can reuse hot app-scoped collection identities after sync.
- App, collection, and tenant-collection caches have explicit refresh/invalidation points tied to sync and tenant enablement mutations without inventing stronger prune semantics than the database has.
- The design and plan enumerate every current consumer and mutation path that relies on the cache staying coherent, plus the follow-up boundary refactor to resolve collection context once outside auth.

## Notes

- Current observed consumers: `DocumentService.requireCollectionIdentity()`, direct catalog lookups in `test/unit/server/service.test.ts`, and sync/bootstrap flows in `CatalogService` plus `AuthRbacService.syncCollectionPermissions()`.
- Current sync semantics are non-pruning: rows absent from code remain in the database today, so cache refresh must track touched rows instead of assuming a full reset.
- The database remains the durable source of truth; the cache is an optimization only.
