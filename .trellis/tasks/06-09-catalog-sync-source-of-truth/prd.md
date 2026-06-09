# Clarify code-defined catalog sync source of truth

## Goal

Record the decision that the code-defined registry remains the MVP authoring source of truth while the synced database catalog is the runtime identity source of truth.

## Context

Recent app catalog identity work made `apps` and `collections` real database tables. The remaining architectural question is how to reconcile those durable identities with the MVP contract that collection schemas are still defined in code.

## Decision to Preserve

Use the code-defined `CollectionRegistry` as the MVP authoring source of truth, then explicitly sync those registrations into the database catalog. After sync, runtime services should treat database catalog rows as the durable source of truth for identity.

In short: code-defined catalog, database-backed identity.

## Requirements

- Document that code remains authoritative for collection schemas, schema versions, remote adapters, projection behavior, and operation/auth declarations during the MVP.
- Document that the database catalog is authoritative for durable `app_id`, `collection_id`, `tenant_apps`, document FK identity, permission/grant identity, and persisted catalog metadata after bootstrap sync.
- Keep the MVP contract unchanged: developers define collections in code; the DB does not become a schema authoring surface yet.
- Make registry-to-catalog sync an explicit bootstrap, migration, or test setup step, not a hidden side effect of ordinary document writes.
- Preserve stable `collection_id` rows across sync by upserting collections by `(app_id, collection key)` and updating code-owned metadata such as `definition_key`, `schema_version`, name, and config.
- Define clear drift behavior for renamed collection keys, changed `definitionKey`, and changed `schemaVersion`.

## Acceptance Criteria

- [ ] Relevant design/docs state the split between code-authored schema definitions and database-backed durable identity.
- [ ] Bootstrap expectations for `CatalogService.syncRegistryCollections()` are documented.
- [ ] Runtime expectations state that `DocumentService` and auth/RBAC resolve durable catalog identity from the database after sync.
- [ ] Ordinary document writes are not responsible for silently syncing missing collection catalog rows.
- [ ] Drift rules are documented for collection key rename, `definitionKey` changes, and `schemaVersion` changes.

## Status

On hold by request. Do not start implementation until explicitly resumed.
