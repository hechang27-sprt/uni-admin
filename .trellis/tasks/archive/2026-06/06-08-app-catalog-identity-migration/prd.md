# Design App Catalog Identity Migration

## Goal

Introduce an `app_id` catalog dimension that owns reusable framework content definitions while `tenant_id` remains the data-isolation boundary. The design should replace the tenant-owned collection proposal from issues #1 and #3 with a cleaner app/catalog model, then provide an implementation path that can be executed safely against the current Kysely document and auth/RBAC data layer.

## What I Already Know

- Current persistence stores `documents.tenant_id` plus string `documents.collection`.
- Current collection definitions live in the process-local `CollectionRegistry`.
- Current permissions have globally unique `permissions.key`; repository methods upsert, validate, grant, and evaluate permissions by key.
- Issue #1 asks for first-class collection identity instead of global string collection names.
- Issue #3 notes that permission key identity must change if collection identity stops being globally code-defined.
- The preferred direction is to separate concerns:
  - `tenant_id`: organization/data segregation.
  - `app_id`: reusable app/module/catalog identity.
  - `collection_id`: concrete collection definition within an app.
- The initial cutover can use a built-in/default app for existing code-defined collections.

## Requirements

- Add an app catalog model where apps own content definitions such as collections and derived permissions.
- Add a tenant-app enablement model so a tenant can use an app without owning the app definition.
- Move collection identity toward `(app_id, key)` and stable `collection_id`, not tenant-local string-only identity.
- Move document persistence toward `tenant_id + app_id + collection_id` while preserving tenant data isolation.
- Move permission persistence toward one canonical primary key format backed by structured columns for app, collection, and capability identity.
- Use `permissions.key` as the primary key and `role_permissions.permission_key` as the grant reference; do not keep a separate `permission_id` or add `display_key` unless a later need proves it necessary.
- Built-in collection CRUD capabilities are fixed framework capabilities; users cannot override `read`, `create`, `update`, `patch`, `delete`, `restore`, or `hard-delete`, and can only add custom action capabilities.
- Preserve the current service-level TypeScript API initially where practical: callers can continue passing `collection: string` for the default app during the first migration slice.
- Provide a staged migration path that avoids partially adopting tenant-owned collections.
- Update docs/specs that describe the storage, collection registry, and auth/RBAC contracts.

## Acceptance Criteria

- [ ] `design.md` defines the target schema for `apps`, `tenant_apps`, `collections`, documents, permissions, and grants.
- [ ] `design.md` defines invariants that prevent cross-app and cross-tenant identity drift.
- [ ] `design.md` explains how current `documents.collection` and `permissions.key` map into the new model.
- [ ] `implement.md` decomposes the migration into ordered, independently verifiable slices.
- [ ] Implementation preserves current document CRUD and auth/RBAC behavior through a default app compatibility path.
- [ ] Tests cover tenant isolation, duplicate collection keys across apps, tenant app enablement, document collection FK binding, and structured permission grants/evaluation.
- [ ] Documentation records the new distinction between tenant data, app catalog, and collection identity.

## Definition of Done

- Tests added/updated for the migrated behavior.
- Relevant unit tests pass, especially document service, auth/RBAC, and migration tests.
- Lint/typecheck pass for touched files.
- Docs/specs updated after behavior is proven.
- `gitnexus_detect_changes()` is run before commit to confirm affected scope.

## Out of Scope

- Dynamic tenant-authored schemas in the first slice.
- Generated admin UI, routes, composables, or app-builder UX.
- Marketplace/distribution semantics for apps.
- Runtime app installation flows beyond minimal tenant-app enablement needed for repository invariants.
- PostgreSQL RLS.

## Technical Notes

- Relevant current files:
  - `server/db/schema.ts`
  - `server/db/migrations/001-baseline.ts`
  - `server/data/documents/registry.ts`
  - `server/data/documents/types.ts`
  - `server/data/documents/service/contracts.ts`
  - `server/data/documents/repository/types.ts`
  - `server/data/documents/repository/kysely.ts`
  - `server/auth/um/types.ts`
  - `server/auth/um/repository.ts`
  - `server/auth/um/service.ts`
  - `server/db/query.ts`
  - `server/di/container.ts`
  - `test/unit/server/service.test.ts`
  - `test/unit/server/auth-rbac.test.ts`
- Relevant docs/specs:
  - `docs/data-layer-development-notes.md`
  - `docs/framework-dx-guide.md`
  - `.trellis/spec/server/repository-and-database.md`
  - `.trellis/spec/server/auth-rbac.md`
  - `.trellis/spec/server/data-layer-boundaries.md`
- Current constraints from specs:
  - Kysely `Database` uses camelCase; physical identifiers are snake_case.
  - Repository methods stay set-shaped and batch-first.
  - Service validates collection existence and document data before persistence.
  - Auth policy stays in `AuthRbacService.evaluateAccess`; repository exposes database facts.
  - No routes/composables/UI unless explicitly requested.
