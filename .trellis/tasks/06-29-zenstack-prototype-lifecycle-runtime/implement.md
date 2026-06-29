# Implementation Plan — lifecycle-reflective ZenStack prototype runtime/tests

## Goal

Refactor the prototype runtime/tests so they read as platform lifecycle journeys instead of mostly static seed inspection, while preserving the current ZenStack policy validation and end-to-end prototype pass.

## Pending scope confirmation

Recommended direction:
- service-shaped flow over local managed rows first
- do not add a full remote-backed prototype flow in this task unless scope changes

## Ordered steps

1. Inventory current runtime responsibilities
   - separate environment setup, bootstrap/setup state, and operational seed helpers
   - identify which existing constants/ids remain useful vs which should become per-test generated ids

2. Refactor runtime into explicit layers
   - keep environment creation as-is or nearly as-is
   - split bootstrap helpers from operational helpers
   - add small workflow-oriented helpers for managed collection operations

3. Rewrite tests around lifecycle slices
   - preserve a small number of structural invariant tests
   - replace seed-only assertions with actor/control-plane + collection-lifecycle journey tests
   - ensure tests cover create/update/delete/restore visibility and app/scope boundaries

4. Keep policy regressions grounded
   - retain exact capability-key and bottom-scope semantics checks
   - ensure new tests still fail meaningfully if policy/lifecycle wiring drifts

5. Update notes/docs if findings change
   - adjust `NOTES.md` only if the lifecycle-oriented prototype reveals a new design finding

## Candidate validation commands

- `bun run prototype:zenstack-relational-redesign`
- if needed during iteration:
  - `bunx vitest run test/unit/server/zenstack/prototype-relational-redesign.test.ts`

## Review gates

Before activation:
- confirm whether scope is service-shaped local lifecycle only, or must include remote-backed behavior now

Before completion:
- tests demonstrate realistic journey shape, not just seeded row existence
- prototype still passes end-to-end against the patched ZenStack fork

## Rollback points

- if runtime refactor becomes noisy, first land a test rewrite over existing helpers to preserve behavioral coverage, then tighten helper boundaries
- if remote-backed modeling starts forcing speculative framework design, cut back to service-shaped local lifecycle only
