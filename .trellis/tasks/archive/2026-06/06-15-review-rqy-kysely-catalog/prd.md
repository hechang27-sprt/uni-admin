# Review rqy Kysely catalog changes

## Goal

Review the `rqy` revision changes in `KyselyCatalogRepository` made for GitHub issues #8 and #10, then refactor the rest of the codebase so the new catalog contracts work end-to-end without regressions.

## What I already know

- Issue #8 requires removing the `syncCollections()` N+1 app upsert pattern by de-duplicating app keys and batch-upserting apps once.
- Issue #10 requires separating explicit app bootstrap from tenant enablement so unknown `appKey` values do not silently create ghost app rows.
- `server/data/catalog/repository.ts` already changed in `rqy`/current source from scalar `ensureApp()` and `enableTenantApp()` methods to batched `ensureApps()` and `enableTenantApps()`.
- `server/data/catalog/service.ts` and several tests/fixtures still call the removed scalar methods.
- GitNexus impact for `KyselyCatalogRepository` is LOW: 3 direct dependents, 10 total impacted files.

## Requirements

- Preserve the batch-oriented repository changes in `KyselyCatalogRepository` that address issues #8 and #10.
- Refactor `CatalogService` to expose a coherent API on top of the new repository contract.
- Update all affected callers, fixtures, and tests to use the new catalog service/repository behavior.
- Keep the default-app bootstrap path explicit and safe for repeated setup calls.
- Ensure tenant app enablement for non-default apps no longer depends on implicit app creation.
- Keep registry collection syncing behavior idempotent.
- Keep document-service and auth/RBAC setup helpers working with the refactored catalog APIs.

## Acceptance Criteria

- [ ] `CatalogService` no longer calls removed repository methods and compiles against the new repository interface.
- [ ] All in-repo callsites of the old scalar catalog enable/ensure API are migrated or replaced.
- [ ] Unknown non-default app enablement cannot silently create an `apps` row through the normal tenant-enable path.
- [ ] Catalog sync still resolves app-scoped collection identities correctly across multiple apps.
- [ ] Updated unit tests covering catalog setup and affected document/auth flows pass.

## Definition of Done

- Targeted unit tests pass for changed catalog/document/auth setup paths.
- No obsolete scalar catalog API remains in reachable code.
- Planning artifacts document the cutover and affected files.

## Out of Scope

- Adding runtime app installation UX or new app-management APIs beyond what is needed for the current codebase cutover.
- Broad schema redesign unrelated to catalog app bootstrap/enable semantics.

## Technical Notes

- Impact analysis: `KyselyCatalogRepository` upstream risk LOW, direct dependents include `server/data/catalog/service.ts`, `server/data/catalog/index.ts`, and `test/unit/server/util-db.test.ts`.
- Key affected files found so far:
  - `server/data/catalog/repository.ts`
  - `server/data/catalog/service.ts`
  - `test/unit/server/util-db.test.ts`
  - `test/unit/server/service.test.ts`
  - `test/unit/server/fixtures/service.ts`
  - `test/unit/server/auth-rbac.test.ts`
- Source-of-truth behavior comes from current repository code plus issue #8 / #10; the server spec still describes the pre-batch interface and may need a follow-up spec update after implementation.
