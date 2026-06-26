# Implementation Plan — prototype zenstack relational redesign validation

## Ordered Checklist

1. Add planning context references for server specs and design sources.
2. Start the task after planning artifacts exist.
3. Install minimal ZenStack prototype dependencies and add one run script.
4. Create the throwaway prototype directory under `server/zenstack/prototype-relational-redesign/`.
5. Author the minimal `schema.zmodel` with policy plugin, auth type, catalog/auth/scope models, and `DocumentBase` subtypes.
6. Add runtime/bootstrap helpers for scratch DB creation, schema generation/apply, and seeded scenario data.
7. Add portable scenario definitions plus the focused Vitest prototype spec.
8. Add `README.md` and `NOTES.md` with the explicit question, run command, throwaway warning, and verdict placeholder.
9. Run the focused Vitest prototype command.
10. Fix any compile/runtime/schema-policy issues until the prototype spec gives a grounded verdict.
11. Do final cleanup only after the prototype works: remove dead files, ensure the command is the single obvious entrypoint, and keep notes aligned with observed results.

## Validation Commands

- Prototype smoke:
  - `pnpm prototype:zenstack-relational-redesign`
- If schema-only debugging is needed during implementation:
  - `bunx zen check --schema server/zenstack/prototype-relational-redesign/schema.zmodel`
  - `bunx zen generate --schema server/zenstack/prototype-relational-redesign/schema.zmodel --output server/zenstack/prototype-relational-redesign/generated`

## Review Gates

Before task completion, confirm:

- the prototype is clearly marked throwaway;
- the run command is one command from `package.json`;
- Vitest output and assertions cover all four architectural validation questions;
- notes capture what was actually observed, not hoped for.

## Rollback / Exit Criteria

- If ZenStack cannot express one of the core assumptions cleanly, do not paper over it with local helper logic; record the failure in `NOTES.md` and report it as evidence against the current direction.
- If dependency/setup friction dominates, keep the prototype minimal and local; do not refactor the existing app around it.
