# Tighten ZenStack prototype DocumentBase CRUD policy

## Goal

Tighten the prototype ZModel under `server/zenstack/prototype-relational-redesign/` so `DocumentBase` CRUD policy matches the settled RBAC semantics more closely: bottom-scope aware checks plus exact capability-key alignment to the row's qualified collection/app identity instead of broad `endsWith(..., ':capability')` matching.

## What I already know

- Current `DocumentBase` policy in `prototype.zmodel` authorizes by tenant match plus `endsWith(g.capabilityKey, ':<verb>')` and ancestor/self scope match through `this.authScope.path`.
- That shape is too broad. A grant for one collection can satisfy another collection with the same CRUD verb because the predicate ignores the row's concrete `qualifiedCollectionKey`.
- The user wants the capability key to align to the row identity, e.g. `g.capabilityKey == concat(qualifiedCollectionKey, ':', 'read')`.
- Current policy also does not model bottom-scope semantics explicitly. Project guidance says `resourceScope: "none"` is the virtual bottom scope and uses `BOTTOM_SCOPE_ID` in persisted assignments / checks.
- The current prototype already models `App`, `Collection`, `AuthScope`, `Permission`, `RoleAssignment`, and `DerivedCapabilityGrant`, plus focused runtime seeding and Vitest coverage.
- The current prototype notes say deep closure traversal through nested collection predicates is still a ZenStack limitation, so this task should preserve the working closure/path approach unless a simpler exact-match policy still validates.

## Requirements

- Keep the work inside the prototype slice: `server/zenstack/prototype-relational-redesign/` and `test/unit/server/zenstack/prototype-relational-redesign.test.ts`.
- Tighten `DocumentBase` CRUD policy so each CRUD verb requires an exact capability key derived from the row identity, not a suffix match.
- Preserve collection/app alignment by deriving capability keys from `qualifiedCollectionKey`, which already encodes app + collection identity.
- Add bottom-scope-aware policy behavior consistent with the project RBAC direction: bottom-target rows/checks can be satisfied by concrete ancestor grants and explicit bottom grants, while bottom grants must not satisfy non-bottom rows.
- Update seed data and focused tests so the tightened semantics are exercised end-to-end.
- Re-run the focused prototype validation after the schema/test changes.
- Update prototype notes to record the tightened policy semantics and any remaining ZenStack limitations.

## Constraints

- Stay Bun-only and prototype-local.
- Use the real ZenStack toolchain already used by the prototype.
- Do not broaden scope into production server/auth service cutover.

## Acceptance Criteria

- [ ] `DocumentBase` CRUD policy uses exact row-derived capability keys for create/read/update/delete.
- [ ] Bottom-scope checks are represented in the prototype policy/runtime and behave asymmetrically: ancestor/concrete grants can satisfy bottom rows, explicit bottom grants can satisfy bottom rows, and bottom grants do not satisfy non-bottom rows.
- [ ] Focused runtime seeding covers both exact collection-key alignment and bottom-scope semantics.
- [ ] `bunx zen generate --schema server/zenstack/prototype-relational-redesign/prototype.zmodel --output server/zenstack/prototype-relational-redesign/generated` passes.
- [ ] `bunx vitest run test/unit/server/zenstack/prototype-relational-redesign.test.ts` passes.
- [ ] Prototype notes describe the tightened policy behavior and any remaining caveats.

## Definition of Done

- Planning artifacts exist.
- Schema, runtime seed data, tests, and notes are aligned.
- Focused validation passes.

## Out of Scope

- Production migration / repository / service cutover.
- Frontend or route changes.
- Reworking the entire prototype around a different auth model.

## Technical Notes

- Main inputs: `server/zenstack/prototype-relational-redesign/prototype.zmodel`, `runtime.ts`, `NOTES.md`, `test/unit/server/zenstack/prototype-relational-redesign.test.ts`.
- Relevant project guidance: `.trellis/spec/server/auth-rbac.md` and the archived prototype tasks from 2026-06.
