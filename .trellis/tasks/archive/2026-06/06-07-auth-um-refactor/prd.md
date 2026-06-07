# Refactor auth module into auth um

## Goal

Move the existing user-management and RBAC implementation from `server/auth/*`
to `server/auth/um/*` so the current auth code has a stable home before future
`server/auth/session/*` work lands.

## What I already know

- The user explicitly chose `server/auth/um` for the current module and
  `server/auth/session` for future session work.
- Scope for this task is structural only: move the current auth files and
  update imports. Do not implement session behavior.
- Current public auth surface is `server/auth/index.ts`; current import sites
  include `server/di/container.ts`, `server/data/documents/service/service.ts`,
  and `test/unit/server/auth-rbac.test.ts`.
- `test/unit/server/auth-rbac.test.ts` already has recent regression coverage
  around inactive users and should remain green after the move.

## Requirements

- Move the current auth module files into `server/auth/um/`:
  - `errors.ts`
  - `index.ts`
  - `password.ts`
  - `repository.ts`
  - `service.ts`
  - `types.ts`
- Update all direct and barrel imports to the new module path.
- Keep behavior unchanged; this task is a namespace/layout refactor only.
- Choose a clean cutover that leaves the codebase ready for a future
  `server/auth/session` sibling module.

## Acceptance Criteria

- [ ] Existing user-management auth source files live under `server/auth/um/`.
- [ ] Affected runtime and test imports resolve from the new auth module path.
- [ ] Targeted auth/document tests pass after the refactor.
- [ ] `bun run typecheck` passes after the refactor.

## Out of Scope

- Creating `server/auth/session/*`.
- Adding new auth/session endpoints or session persistence behavior.
- Reworking current RBAC/service semantics beyond import-path changes required
  by the move.

## Technical Notes

- Relevant guidelines: `.trellis/spec/server/auth-rbac.md`,
  `.trellis/spec/server/repository-and-database.md`,
  `.trellis/spec/server/testing.md`, and
  `.trellis/spec/server/data-layer-boundaries.md`.
- Impact snapshot from current code search: the top-level barrel `#server/auth`
  is consumed by document service, DI wiring, and auth unit tests; there is
  also a direct `#server/auth/repository` import in
  `test/unit/server/auth-rbac.test.ts`.
- GitNexus MCP impact tools are not available in this harness session, so blast
  radius was approximated with LSP references plus repo-wide import search.
- This is a lightweight PRD-only task because scope and acceptance criteria are
  already concrete.
