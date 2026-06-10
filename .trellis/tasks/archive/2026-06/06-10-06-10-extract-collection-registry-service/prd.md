# Extract collection registry service

## Goal

Move collection/registry related code out of server/data/documents/registry.ts into its own data module service while preserving existing behavior.

## Requirements

- Extract collection and registry related types/functions currently housed in `server/data/documents/registry.ts` into an owned data module/service under `server/data/`.
- Preserve current public behavior and callsite APIs unless a local import path must change for the new module boundary.
- Keep document-specific code in `server/data/documents/` focused on document service/repository concerns.
- Update all affected imports/exports/tests so the project uses the new module as the source of truth.

## Acceptance Criteria

- [x] Collection/registry implementation lives outside `server/data/documents/registry.ts` in a dedicated `server/data` module.
- [x] Existing collection/registry consumers compile against the new module boundary.
- [x] Targeted tests or type checks covering affected code pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
