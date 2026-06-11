# Clarify code-defined catalog sync source of truth

## Goal

Record the decision that the code-defined registry remains the MVP authoring source of truth while the synced database catalog is the runtime identity source of truth. **Implemented.**

## Context

Recent app catalog identity work made `apps` and `collections` real database tables. The remaining architectural question is how to reconcile those durable identities with the MVP contract that collection schemas are still defined in code.

## Decision

Use the code-defined `CollectionRegistry` as the MVP authoring source of truth, then explicitly sync those registrations into the database catalog. After sync, runtime services treat database catalog rows as the durable source of truth for identity.

In short: **code-defined schema, database-backed identity.**

## Source of Truth Split

| Concern | Authority |
|---|---|
| Collection schema, schema version | Code (`CollectionRegistration`) |
| Remote adapter, projection behavior | Code (`CollectionRegistration`) |
| Operation/action auth declarations | Code (`CollectionRegistration`) |
| Durable `app_id`, `collection_id` | Database (`apps`, `collections`) |
| Tenant app enablement | Database (`tenantApps`) |
| Document FK identity | Database (references `collections.collection_id`) |
| Permission/grant identity | Database (references `apps.app_id`, `collections.collection_id`) |
| Persisted catalog metadata (name, config) | Database (set by sync; overwritten on next sync) |

## Bootstrap Contract

`CatalogService.syncRegistryCollections()` is an **explicit bootstrap step** — not a side effect of document writes.

Call order at startup or test setup:

```ts
await catalog.syncRegistryCollections();          // upsert apps + collections by (app_id, collection key)
await catalog.enableDefaultAppForTenant(tenantId); // or enableTenantApp for non-default apps
```

`DocumentService` and auth/RBAC resolve durable catalog identity (`appId`, `collectionId`) from the database after this sync. They do **not** trigger a sync themselves.

## Drift Rules

### Collection key rename
A rename (`key: "tasks"` → `key: "archive"`) produces a **new row** with a new `collection_id`. The old row and all documents referencing the old `collection_id` are orphaned. During MVP, treat key renames as incompatible migrations requiring explicit data migration.

### `definitionKey` change
`definitionKey` is code-owned metadata. `syncRegistryCollections` overwrites it on every sync. No identity impact — `collection_id` is stable.

### `schemaVersion` change
`schemaVersion` is code-owned metadata. `syncRegistryCollections` overwrites it on every sync. No identity impact. Existing documents retain their stored `schema_version`; callers should handle version mismatch explicitly.

### App key rename
Same as collection key rename — produces a new `app_id` row. All `tenantApps`, `collections`, and downstream documents referencing the old `app_id` are orphaned. Incompatible during MVP.

## Implementation

- `DocumentService.requireCollectionIdentity` — removed implicit `syncRegistryCollections()` call. Now only reads from DB; throws `UNKNOWN_COLLECTION` if catalog row is absent.
- Test fixtures (`createService`, `createRemoteService`) and inline test containers now call `syncRegistryCollections()` + `enableDefaultAppForTenant()` explicitly before exercising the document service.
- `vitest.config.ts` unit `testTimeout` raised to 15 s to accommodate concurrent PGlite initialization under load.

## Acceptance Criteria

- [x] Relevant design/docs state the split between code-authored schema definitions and database-backed durable identity.
- [x] Bootstrap expectations for `CatalogService.syncRegistryCollections()` are documented.
- [x] Runtime expectations state that `DocumentService` and auth/RBAC resolve durable catalog identity from the database after sync.
- [x] Ordinary document writes are not responsible for silently syncing missing collection catalog rows.
- [x] Drift rules are documented for collection key rename, `definitionKey` changes, and `schemaVersion` changes.
