# Implementation Plan: Add CollectionRegistration key

## Preconditions

- Before editing exported symbols, run impact analysis for `CollectionRegistration`, `CollectionRegistry`, and affected service/repository methods as required by project GitNexus rules.
- Read current tests around document registry, catalog sync, document CRUD, and auth/RBAC collection permissions.

## Steps

1. Update registration types and normalization.
   - Add optional `key` to the registration schema/type.
   - Normalize to a required public key on `RegisteredCollection`.
   - Keep existing registrations valid by deriving `key` from `name`.
   - Keep `definitionKey` behavior unchanged.

2. Switch registry identity to public key.
   - Use `(appKey, key)` for duplicate detection and map storage.
   - Ensure `get`, `getForApp`, and `has` receive the public collection key.
   - Keep error metadata clear: report public `key` and descriptive `name` separately when useful.

3. Switch catalog sync to public key.
   - Write normalized `registration.key` to `collections.key`.
   - Write `registration.name` to `collections.name`.
   - Keep conflict target `(appId, key)`.
   - Continue writing `definitionKey` unchanged.

4. Update service and auth flows.
   - Ensure `DocumentService` resolves the registered collection by public key.
   - Ensure tenant catalog lookup receives the normalized public key.
   - Ensure collection permission definitions continue to resolve to `collections.key`.

5. Update tests.
   - Add coverage for a registration where `key !== name`.
   - Verify document CRUD uses `key` as the service `collection` input.
   - Verify catalog row stores `key` and descriptive `name` separately.
   - Verify duplicate detection rejects duplicate `(appKey, key)` even with different names.
   - Verify existing `name`-only registrations still work if compatibility is preserved.

6. Update docs/specs.
   - Explain `key`, `name`, and `definitionKey` roles.
   - Update examples to use `key` for identity and `name` for display text.

## Validation

- Run targeted pgLite-backed tests for document registry/catalog/document service behavior.
- Run targeted auth/RBAC tests if permission definitions are touched.
- Run lint/typecheck for touched files.
- Run `gitnexus_detect_changes()` before finishing.

## Rollback

Revert to `registration.name` as the registry/catalog identity if tests expose unexpected API incompatibility, then split compatibility and clean-cutover into separate tasks.
