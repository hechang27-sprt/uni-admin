# Implementation Plan — tighten ZenStack prototype DocumentBase CRUD policy

## Ordered Checklist

1. Start the task after planning artifacts exist.
2. Update `prototype.zmodel` policy predicates for exact capability-key matching and bottom-scope semantics.
3. Update `runtime.ts` seed constants/data for bottom scope, bottom-target documents, and any extra actor contexts/grants needed to prove asymmetry.
4. Update the focused Vitest spec to cover exact key alignment and bottom-scope behavior.
5. Update `NOTES.md` with the tightened policy findings.
6. Run `bunx zen generate --schema server/zenstack/prototype-relational-redesign/prototype.zmodel --output server/zenstack/prototype-relational-redesign/generated`.
7. Run `bunx vitest run test/unit/server/zenstack/prototype-relational-redesign.test.ts`.
8. Fix any schema/runtime/policy issues until both validations pass.

## Validation Commands

- `bunx zen generate --schema server/zenstack/prototype-relational-redesign/prototype.zmodel --output server/zenstack/prototype-relational-redesign/generated`
- `bunx vitest run test/unit/server/zenstack/prototype-relational-redesign.test.ts`

## Review Gates

Before completion, confirm:

- CRUD policy uses exact row-derived capability keys.
- Bottom-scope asymmetry is exercised, not just documented.
- Tests prove cross-collection mismatch denial.
- Notes capture any remaining ZenStack policy constraints.

## Exit Criteria

- Prototype remains local, Bun-driven, and runnable.
- Schema/test/notes stay aligned.
