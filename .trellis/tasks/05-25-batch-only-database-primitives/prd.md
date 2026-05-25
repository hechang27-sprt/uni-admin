# Enforce batch-only database access primitives

## Goal

Refactor repeated and bulk-capable server persistence paths so service
workflows do not issue per-record database calls when a set-based operation can
reasonably express the same behavior.

## User Value

- Bulk document APIs retain their performance characteristics when used with
  actor-scoped authorization and non-null authorization scopes.
- Auth/RBAC bootstrap and delegated administration do not degrade into
  request-per-permission database access.
- Future generated admin UI, imports, and queued actions inherit a repository
  boundary that makes inefficient per-row access hard to introduce.

## Confirmed Facts

- `DocumentRepository` already exposes batch document insert, ordered batch
  read, batch update, and remote projection upsert methods.
- `DocumentService.createMany`, `getByIds`, and `updateMany` issue per-item
  authorization checks through `DocumentAuthorizer.checkAccess`.
- `DrizzleDocumentRepository.assertAuthScopesBelongToTenant` validates each
  distinct scope through a separate database select.
- `AuthRbacRepository` exposes scalar reads/writes and a scalar
  `checkAccess` method; it has no batched grant, assignment validation, or
  access-check primitive.
- `AuthRbacService.bootstrapTenantOwner` loops through built-in permissions,
  and each `grantPermission` performs role lookup, permission lookup, and
  insert work.
- `AuthRbacService.assignRoleAsActor` loops through every permission assigned
  to the target role and checks actor authority one capability at a time.
- Scalar document mutation methods load an existing document before
  authorization, then `assertVersionAndUpdate` loads the same row again before
  the versioned update.
- The current schema does not express tenant-scoped composite foreign keys for
  `documents.auth_scope_id`, role grants, or role assignments, so repositories
  perform additional application-side tenant checks.
- Existing tests cover ordinary batch document behavior but not protected
  batch operation authorization or set-based RBAC administration.

## Requirements

- Repository contracts for currently repeated or naturally bulk-capable
  operations must expose batch-capable data access primitives rather than
  scalar-only accessors. A single logical operation may use a one-element
  batch when it reuses such a primitive.
- Scalar accessors may remain when the operation is inherently singular in the
  current architecture and is not reasonably expected to be repeated inside a
  transaction or bulk workflow. Current justified candidates are credential
  lookup/login verification, actor membership resolution, tenant-root
  initialization, individual closure-tree scope creation, and explicit
  single-role resolution.
- Database-backed implementations must issue set-based statements for
  collection-shaped inputs where PostgreSQL can express the invariant without
  changing behavior.
- `DocumentService` batch APIs must authorize unique target scopes in batches,
  preserving input order, missing-item handling, and all-or-nothing update
  behavior.
- Document scope validation for inserts, updates, and projection upserts must
  avoid one validation query per distinct scope.
- Auth/RBAC permission grants and role assignments must have batch primitives,
  and bootstrap must grant built-in permissions through those primitives.
- Delegated role assignment privilege-escalation checks must not issue a query
  for each granted capability.
- Actor-scoped authorization must preserve tenant isolation, scope containment,
  capability checks, and authorization-before-remote-side-effect behavior.
- Scalar public service methods may remain scalar developer-facing APIs. They
  must call one-element batch primitives where their underlying operation is a
  mandatory batching target, such as document item reads/writes or
  authorization checks.
- Eliminate redundant reads in mutation paths where an already loaded row plus
  optimistic `UPDATE ... WHERE version = expectedVersion` preserves the same
  conflict semantics.
- Record the batch-only persistence convention and executable contracts in the
  server Trellis specs, including validation/error behavior and required
  tests.
- Preserve the current Nuxt/server-only scope: no route, composable,
  generated-UI, action-runner, or operation-queue work is part of this task.

## Acceptance Criteria

- [ ] Repeated or naturally bulk-capable `DocumentRepository` and
      `AuthRbacRepository` paths do not expose scalar-only persistence/access
      primitives; retained scalar methods have a documented singular-use
      rationale.
- [ ] Single-record service operations use one-element batch repository calls
      while preserving their current public return values and error codes.
- [ ] Protected `createMany`, `getByIds`, and `updateMany` do not perform
      authorization database access proportional to item count or repeated
      target scopes.
- [ ] Batch document scope validation executes as a set operation and rejects
      cross-tenant scope IDs with `INVALID_AUTH_SCOPE`.
- [ ] Owner bootstrap grants all built-in permissions without looping over
      scalar repository grant calls.
- [ ] Delegated role assignment checks all required capabilities without a
      scalar per-capability database loop and still rejects privilege
      escalation.
- [ ] Document mutations do not redundantly reread the row once an existing
      document has already been loaded for authorization or patching.
- [ ] Tenant isolation, optimistic concurrency, returned input order, soft
      delete behavior, remote-write side-effect ordering, and RBAC semantics
      remain covered by passing pgLite-backed tests.
- [ ] New tests cover actor-protected document batch calls, bulk RBAC grant or
      bootstrap behavior, delegated multi-capability assignment, and
      cross-tenant set validation.
- [ ] `.trellis/spec/server/` documents the batch-only persistence contract,
      required signatures, errors, good/base/bad cases, tests, and forbidden
      scalar-loop pattern.

## Likely Out Of Scope

- New external HTTP/API routes or Nuxt composables.
- Custom actions, operation records, and queue workers.
- Benchmark infrastructure beyond tests proving set-shaped repository
  execution contracts where practical.
- Redesigning the RBAC authorization model or changing capability semantics.

## Resolved Decisions

- Batch any database access that is currently repeated in a service flow or
  reasonably expected to support bulk/transactional usage.
- Retain a scalar primitive when the architecture makes repeat access unlikely
  and batching would only add indirection without removing database work.
- Do not collapse distinct workflow phases across password hashing, remote
  side effects, authorization-before-side-effects, or scope hierarchy
  maintenance merely to claim a one-statement service method.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
