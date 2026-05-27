# Implementation Plan: Kysely-first SQL pushdown

## Preparation

- [x] Obtain user approval for the `HIGH`-risk document auth-scope validation
      consolidation described in `design.md`.
- [x] Load `trellis-before-dev` and the relevant server specs before source
      edits.
- [x] Re-run GitNexus impact checks for each final source symbol before its
      edit, including any helper or newly selected auth method.

## Execution

- [x] Replace document ordered read/delete result correlation in
      `KyselyDocumentRepository.findByIds` and `hardDeleteMany` with ordered
      SQL input relations and Kysely-composed output ordering.
- [x] Consolidate document write auth-scope validation with `insertMany`,
      `updateMany`, and `upsertRemoteProjections` mutation queries, preserving
      first-invalid-scope errors, stale update atomicity, ordered results, and
      timestamp conversion.
- [x] Remove result-row `Map`/`Set` correlation from remote upsert return
      ordering by joining returned mutation rows back to ordered SQL input.
- [x] Convert `KyselyAuthRbacRepository.createScope` ancestor read/mapped
      insert flow into a set-oriented scope-and-closure SQL operation.
- [x] Implement the delegated assignment repository query and wire
      `AuthRbacService.assignRoleAsActor` to avoid loading role permission rows
      merely to issue another access query, only if the first denied capability
      contract is preserved cleanly.
- [x] Leave required row/domain mapping, Zod validation, and service result
      alignment unchanged; record any reviewed iterator site that is retained
      for those reasons.

## Verification

- [x] Add focused pgLite behavior tests for ordered missing reads/deletes,
      remote upsert ordering if absent, and mixed valid/invalid auth scopes on
      each consolidated document write path.
- [x] Add or adjust auth tests for scope closure insertion and delegated role
      denial/allow semantics if those methods change.
- [x] Run `bun run test -- --project unit test/unit/server/service.test.ts
      test/unit/server/auth-rbac.test.ts`.
- [x] Run `bun run typecheck`.
- [x] Run the repository lint command for touched TypeScript.
- [x] Run `gitnexus_detect_changes()` and review affected execution flows
      before any commit.

## Review Gates And Rollback Points

- After ordered read/delete changes, run document tests before modifying the
  shared validation boundary.
- After document validated writes, stop on any pgLite incompatibility or
  behavior regression and revert that isolated consolidation rather than
  weakening validation behavior.
- Preserve user-authored dirty changes in `server/auth/repository.ts`,
  `server/util/kysely.ts`, package configuration, and test configuration while
  making scoped edits.
