# Add CollectionRegistration key

## Goal

Add a `key` property to `CollectionRegistration` so the public catalog identity is separate from the human/descriptive `name` field, matching GitHub issue #5.

## Source

- GitHub issue #5: `CollectionRegistration` should contain `key` property so that `name` is relegated for descriptive name only.

## Requirements

- Add `CollectionRegistration.key` as the app-scoped public/catalog collection identifier.
- Preserve compatibility for existing callers that only provide `name` during the transition; `key` should default from `name` unless the implementation intentionally performs a clean breaking cutover with all callsites updated.
- Keep `definitionKey` unchanged for now; it should continue to default independently from the public key according to the chosen compatibility strategy.
- Use `key` for registry uniqueness, catalog sync into `collections.key`, catalog lookups, service collection resolution, and collection-scoped permission definition identity.
- Relegate `name` to descriptive/display metadata. `collections.name` should receive `registration.name` when present.
- Update tests and docs/specs that mention collection registration identity.

## Acceptance Criteria

- [ ] `CollectionRegistration` supports a `key` field and normalizes existing registrations safely.
- [ ] Registry duplicate detection is based on `(appKey, key)`, not `(appKey, name)`.
- [ ] `CatalogRepository.syncCollections()` writes `registration.key` to `collections.key` and `registration.name` to `collections.name`.
- [ ] `DocumentService` and auth/RBAC collection permission resolution use the normalized public key consistently.
- [ ] Existing document CRUD and auth/RBAC tests continue to pass, including default-app registrations without explicit `key` if compatibility is preserved.
- [ ] New or updated tests cover different `key` and `name` values.
- [ ] Docs explain `key`, `name`, and `definitionKey` roles.

## Status

Planning only. Do not start implementation until this task is explicitly started.
