# App Catalog Identity Migration Implementation Plan

## Review Gate

Do not run `task.py start` until this plan is reviewed. This is a complex cross-layer migration touching database schema, document repository/service contracts, collection registration, and auth/RBAC permission identity.

## Ordered Checklist

### 1. Prepare schema/catalog foundation

- [x] Run GitNexus impact analysis before editing each modified function/class/method.
- [x] Add `AppsTable`, `TenantAppsTable`, and `CollectionsTable` to `server/db/schema.ts`.
- [x] Add `apps`, `tenant_apps`, and `collections` to `Database`.
- [x] Add baseline migration DDL for `apps`, `tenant_apps`, and `collections` before documents/permissions need them.
- [x] Add indexes/constraints:
  - `apps_key_unique` on `apps.key`.
  - `tenant_apps_pk` on `(tenant_id, app_id)`.
  - `collections_app_key_unique` on `(app_id, key)`.
  - `collections_app_collection_unique` on `(app_id, collection_id)`.
- [x] Add tests proving pgLite migration succeeds with the new tables and constraints.

### 2. Add app-aware collection registration metadata

- [x] Extend collection registration with optional `appKey` and `definitionKey`.
- [x] Default `appKey` to `default` and `definitionKey` to `name`.
- [x] Change registry uniqueness from collection `name` to `(appKey, name)`.
- [x] Preserve safe slug validation for app, collection, action, and definition keys.
- [x] Keep existing callers working without specifying `appKey`.
- [x] Add tests for duplicate collection key allowed across different apps but rejected within one app.

### 3. Add catalog repository/service helpers

- [x] Add a focused catalog persistence boundary rather than scattering app/collection lookups through document/auth repositories.
- [x] Ensure default app exists.
- [x] Sync registry collections into `collections` rows.
- [x] Enable the default app for a tenant when tenant bootstrap/document tests need it, or expose an explicit helper used by tests/bootstrap.
- [x] Add tests for tenant app enablement and collection lookup by app key + collection key.

### 4. Cut document persistence to structured collection identity

- [x] Add `app_id` and `collection_id` columns to `documents`.
- [x] Add FK/invariant constraints:
  - `documents.app_id` references `apps.app_id`.
  - `(documents.app_id, documents.collection_id)` references `collections(app_id, collection_id)`.
  - `(documents.tenant_id, documents.app_id)` references `tenant_apps(tenant_id, app_id)`.
- [x] Keep `documents.collection` temporarily populated for compatibility.
- [x] Update `DocumentsTable` and `StoredDocument` only as needed; avoid exposing app fields publicly until behavior is stable.
- [x] Update document repository inputs to receive normalized app/collection ids.
- [x] Update insert/list/find/update/delete/remote upsert queries to scope by `tenant_id + app_id + collection_id`.
- [x] Update remote identity unique index to `(tenant_id, app_id, collection_id, remote_source, remote_id)`.
- [x] Add tests:
  - Tenant A and Tenant B can both store data for the same app collection without cross-read.
  - Two apps can both define `tasks`; documents do not cross app boundaries.
  - Tenant without enabled app cannot write documents for that app.
  - Remote upsert uniqueness is app/collection scoped.

### 5. Cut permission persistence to structured identity

- [x] Extend permission types with `appId`, `collectionId`, `capabilityId`, and primary `key` fields.
- [x] Add nullable `app_id`, nullable `collection_id`, and non-null `capability_id` to `permissions`; do not add `permission_id` or `display_key`.
- [x] Make `permissions.key` the primary key:
  - `admin:<capability-id>` for special admin permissions.
  - `global:<capability-id>` for special global framework permissions.
  - `<app-id>:<capability-id>` for app-level permissions.
  - `<app-id>:<collection-id>:<capability-id>` for collection-level permissions.
- [x] Change `role_permissions.permission_id` to `role_permissions.permission_key` with an FK to `permissions(key)`.
- [x] Update collection permission derivation to emit fixed built-in CRUD capability ids and reject attempts to override them.
- [x] Allow custom capabilities only for registered custom actions, emitted as `action-<action-id>`.
- [x] Update `upsertPermissions()` conflict handling to target canonical `key`.
- [x] Update invalid permission lookup, role permission assignment, capability checks, and granted-scope listing to use canonical keys directly.
- [x] Add tests:
  - Same human collection key can exist in two apps without permission collision because canonical keys include app/collection ids.
  - Built-in CRUD capability ids cannot be overridden by collection/action auth config.
  - Grants/evaluation use the intended app/collection permission identity.
  - Built-in admin/global permissions still sync, grant, and evaluate.
  - Unknown canonical key still returns `AUTH_PERMISSION_NOT_FOUND` deterministically.

### 6. Documentation/spec cleanup after smoke test

- [ ] Update `docs/data-layer-development-notes.md` storage/auth sections.
- [ ] Update `docs/framework-dx-guide.md` examples only after the public input shape is settled.
- [ ] Update `.trellis/spec/server/repository-and-database.md`.
- [ ] Update `.trellis/spec/server/auth-rbac.md`.
- [ ] Update `.trellis/spec/server/data-layer-boundaries.md` if a catalog module is introduced.

## Validation Commands

Run the narrowest relevant checks after each slice:

```bash
bun test test/unit/server/util-db.test.ts
bun test test/unit/server/service.test.ts
bun test test/unit/server/auth-rbac.test.ts
```

Before finish:

```bash
bun run typecheck
bun run lint
bun test test/unit/server/util-db.test.ts test/unit/server/service.test.ts test/unit/server/auth-rbac.test.ts
```

Then run:

```text
gitnexus_detect_changes(scope: "all", repo: "uni-admin")
```

## Review Gates

- Gate 1: schema/catalog tables migrate cleanly before document behavior changes.
- Gate 2: document service tests pass with default app compatibility before permission identity changes.
- Gate 3: auth/RBAC tests pass with structured permission identity before docs/spec updates.
- Gate 4: docs/spec updates happen only after behavior is proven.

## Rollback Points

- After slice 1: remove unused catalog tables/types if no document/auth behavior depends on them.
- After slice 2: revert repository/service changes while compatibility `documents.collection` remains authoritative.
- After slice 3: keep legacy permission keys only as migration input; revert structured grant/evaluation paths if tests expose unresolved ambiguity.
