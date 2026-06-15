# Implementation Plan — Review rqy Kysely catalog changes

## Ordered Checklist

1. Inspect current `CatalogRepository`/`CatalogService` contracts and add any missing read path needed to make issue #10 explicit.
2. Refactor `server/data/catalog/service.ts` to wrap the batch repository API without reintroducing removed scalar repository methods.
3. Update direct server/test callsites and fixtures that still use the old catalog service semantics.
4. Run targeted unit tests for catalog, document-service, and auth/RBAC flows touched by the refactor.
5. If behavior/spec knowledge changed materially, capture it in Trellis spec updates before finishing.

## Validation Commands

- `bun vitest run test/unit/server/util-db.test.ts`
- `bun vitest run test/unit/server/service.test.ts`
- `bun vitest run test/unit/server/auth-rbac.test.ts`

Run narrower commands first if an early failure points to a tighter affected surface.

## Review Gates

- Before start: confirm planning matches issue #8 and #10 intent and names the affected files.
- Before finish: ensure no old scalar repository methods remain referenced.
- Before finish: ensure tests cover both bootstrap idempotence and non-default app enablement semantics.

## Rollback Points

- If the new service wrapper shape proves awkward, fall back to adding the minimal repository read method needed for explicit app existence checks rather than restoring old write APIs.
- If a broad test suite failure appears, isolate setup helper changes first, then re-run only suites using those helpers.
