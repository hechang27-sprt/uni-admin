# Fix Duplicate Unsafe Collection Permissions

## Problem

`CollectionRegistry.register()` silently overwrites an existing registration when the same collection name is registered twice. Collection names and action names can also contain `:`, even though derived permission keys use `:` as a namespace separator.

## Requirements

- Registering two collections with the same name must throw before overwriting the first registration.
- Collection names must be validated with a safe slug grammar: lowercase letter start, then lowercase letters, digits, or hyphens.
- Action names used for derived permissions must be validated with the same safe slug grammar, or otherwise rejected when unsafe.
- Permission definition derivation must fail fast on duplicate derived keys instead of silently hiding collisions through a `Map` overwrite.
- Preserve existing public contracts except for rejecting duplicate/unsafe registrations that were previously accepted.

## Acceptance Criteria

- `test/unit/server/auth-rbac.test.ts` regression tests pass:
  - `rejects duplicate collection names`
  - `rejects derived permission key collisions from unsafe collection names`
- Existing auth/RBAC tests pass with the new invariants.
- Error behavior is deterministic and explains the rejected collection/action/key.
