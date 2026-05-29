# Optimize database access through Kysely SQL execution

## Goal

Reduce avoidable database round trips and application-side processing of
database result sets by moving set-oriented repository behavior into SQL,
using Kysely query builders as the primary query construction API.

## Requirements

- Survey database access throughout the server codebase, with attention to
  repository code that post-processes query results through iteration,
  `.map()` / `.filter()`, `Set`, or `Map` where SQL can perform the same
  ordering, matching, validation, or mutation work.
- Use the existing optimized `grantPermissions`, `assignRoles`, and
  `checkAccessMany` work in `server/auth/repository.ts` as the reference style.
- Prefer typed Kysely builders and expressions; use raw `sql` only for local
  fragments that Kysely does not express cleanly, such as PostgreSQL array
  expansion or specialized JSON/set-shaped operations.
- Minimize database calls per logical repository operation, especially for
  batch validation followed by mutation.
- Preserve public repository/service contracts, tenant isolation, ordered batch
  return values, optimistic concurrency behavior, authorization semantics, and
  document timestamp/value mappings.
- Preserve and build on existing uncommitted user changes; do not revert or
  overwrite unrelated work.

## Acceptance Criteria

- [x] Candidate server database paths have been inspected and each meaningful
      in-memory post-query/result-loop pattern is either optimized or
      documented as contract-required/result-mapping work.
- [x] Approved optimizations execute set-oriented validation, ordering,
      filtering, and/or mutations in SQL with Kysely-first implementations and
      fewer avoidable database calls.
- [x] Auth/RBAC and document repository behavior remains compatible with
      existing contracts, including input ordering, null placeholders,
      cross-tenant rejection, and atomic stale-version handling.
- [x] Relevant pgLite-backed server tests and static checks pass after the
      changes.

## Confirmed Facts

- The user has already modified `server/auth/repository.ts` to optimize
  `grantPermissions`, `assignRoles`, and `checkAccessMany`; that dirty worktree
  state is an input to this task rather than disposable changes.
- Server persistence is Kysely-backed and tested against pgLite.
- Existing server guidance already requires batch-only document persistence and
  one tenant-scoped auth-scope validation query per logical write.
- `server/data/documents/repository/kysely.ts` currently contains query-result
  `Map` / `Set` reconstruction for ordered reads, remote projection upserts,
  and hard deletes, plus application-side validation input shaping.
- Configured server verification currently passes with the existing worktree:
  `bun run test -- --project unit test/unit/server/service.test.ts
  test/unit/server/auth-rbac.test.ts` reports 21 passing tests, and
  `bun run typecheck` passes.
- The database-bearing implementation surface is concentrated in
  `server/auth/repository.ts` and
  `server/data/documents/repository/kysely.ts`; most service-layer iterator
  use is validation, authorization result alignment, or API result shaping.
- `AuthRbacService.assignRoleAsActor` is the material exception at the service
  layer: it reads role permission keys, expands them into checks, and makes a
  second repository access query for delegated assignment validation.
- GitNexus classifies direct candidate document repository method changes as
  `LOW` upstream risk, but classifies changes to
  `assertAuthScopesBelongToTenant` as `HIGH` because it protects three write
  flows: `insertMany`, `updateMany`, and `upsertRemoteProjections`.

## Out Of Scope

- Replacing required service-layer validation, authorization orchestration, or
  public result shaping merely because it uses arrays.
- Schema or migration changes unless investigation proves they are necessary
  for an approved query consolidation.

## Scope Decision

- Interpret "go through the code base" as covering persistence repository
  implementations and the one identified service orchestration path whose
  SQL result expansion causes further database calls. Ordinary application
  computation remains outside scope.

## Open Questions

- None. The user approved the `HIGH`-risk shared validation-boundary change
  before implementation.
