# Design: Add CollectionRegistration key

## Problem

`CollectionRegistration.name` currently carries the public collection identifier used by service calls, catalog persistence, registry uniqueness, and permission resolution. GitHub issue #5 asks for `CollectionRegistration.key` so `name` can become descriptive metadata only.

Current behavior:

```text
registration.name -> registry key
registration.name -> collections.key
registration.name -> collections.name
registration.definitionKey -> collections.definition_key
```

Target behavior:

```text
registration.key -> registry key
registration.key -> collections.key
registration.name -> collections.name
registration.definitionKey -> collections.definition_key
```

## Field Meanings

- `key`: stable public/catalog identifier. App-scoped. Used in service inputs, catalog lookups, document identity, and permission definitions.
- `name`: optional descriptive/display label. Not an identity field.
- `definitionKey`: code-definition/schema binding. Leave behavior unchanged for now.

## Compatibility Strategy

Prefer a compatibility-preserving migration:

```ts
key: registration.key ?? registration.name
name: registration.name ?? registration.key
```

This keeps existing callers working while enabling new registrations to specify different public identity and display name.

If `name` remains required in the first implementation slice, then `key` can be optional with `key ?? name`. A later cleanup can make `name` optional/descriptive-only if desired.

## Affected Code Paths

- `server/data/documents/registry.ts`
  - registration schema
  - `CollectionRegistration`
  - `RegisteredCollection`
  - `normalizeRegistration`
  - `collectionRegistryKey`
  - `get`, `getForApp`, `has`, `listForApp`
  - permission definition derivation
- `server/data/catalog/repository.ts`
  - `syncCollections`
  - conflict key remains `(appId, key)` but value should come from normalized registration key
- `server/data/documents/service/service.ts`
  - resolve collection by public key
  - pass normalized key to `findTenantCollectionIdentity`
  - permission key helpers if they derive from registration input
- `server/auth/um/repository.ts`
  - permission definitions with `collectionKey` should continue resolving against `collections.key`
- docs/specs/tests
  - update examples and add distinct key/name coverage

## Data Model

No database schema change is required. Existing `collections.key` already represents the stable identity. Existing `collections.name` can become the descriptive/display value.

## Open Constraint

`definitionKey` remains unchanged. Do not collapse it into `key`; it is still reserved for the code-definition binding.
