# Refine `checkCapabilities` target semantics for bottom-scope RBAC

## Goal

Lock down a boring, DB-aligned access-check contract for `checkCapabilities`
before follow-up implementation changes repository/query code.

## Requirements

- Keep this child planning-only. No production edits, schema changes, or test
  changes belong to this task.
- Preserve the parent task decisions:
  - `resourceScope: "none"` exists and remains an inherent part of permission
    metadata.
  - `permissions.resource_scope` remains the persisted home for
    collection-derived auth mode.
  - `user_role_assignments.scope_id = null` remains the representation for
    explicit bottom-scope grants.
- Settle the evaluator contract around one DB-aligned target convention:
  - concrete scope UUIDs mean concrete scopes, including the tenant root scope
  - `null` means the virtual bottom scope only
  - tenant-root checks must use the actual tenant root scope id, not `null`
- Treat bottom as a real semantic target, not as “unscoped”. In planning terms,
  `null` represents the virtual bottom scope that is an implicit descendant of
  every concrete scope, analogous to imaginary closure rows from each scope to
  bottom.
- Make the translation boundary explicit: caller/service conventions such as
  document `authScopeId: null`, collection `resourceScope`, and any public
  null/root conventions must be translated before repository evaluation.
- Treat the boring evaluator contract as settled, but keep one prerequisite
  decision explicit before implementation starts: whether persisted document
  `authScopeId = null` keeps its current runtime meaning (tenant-root document)
  or participates in a broader semantic migration to become bottom-scoped by
  default.
- Make `checkCapabilities` boring:
  - it must not inspect `resourceScope` to decide target meaning
  - it must not use `targetMode` or any equivalent evaluator-side mode flag
  - it should evaluate explicit target inputs only
- Preserve the current semantic split:
  - grant shape and target semantics are different axes
  - `assigned.scopeId is null` classifies a grant row but does not by itself
    define caller intent
- Identify the exact caller categories, return-shape contracts, and
  query/repository surfaces that will need migration during the implementation
  task.
- Identify adjacent cleanup worth doing in the same refactor, without expanding
  into unrelated RBAC redesign.

## Acceptance Criteria

- [ ] Planning artifacts state the final contract: `null` = bottom,
  tenant-root = actual root scope id.
- [ ] Planning artifacts explain why `checkCapabilities` becomes boring because
  it no longer reads `resourceScope` or a mode flag to decide target meaning.
- [ ] Planning artifacts call out that `CapabilityAccessCheck`,
  `CheckAccessInput`, `CapabilityEvaluation.missingCaps`, and error mapping all
  need contract migration to match the new semantics.
- [ ] Planning artifacts make clear which parts are settled now versus still
  open before implementation, especially the future meaning of persisted
  document `authScopeId = null`.
- [ ] Planning artifacts identify the translation boundary where document and
  collection auth conventions become repository-ready target inputs.
- [ ] Planning artifacts explicitly reject `targetScopeIds: [null]` as a
  tenant-root convention.
- [ ] Planning artifacts define the allowed matching matrix:
  - concrete scoped grants may satisfy bottom targets
  - explicit bottom grants may satisfy bottom targets
  - bottom is modeled as the implicit descendant of every concrete scope rather
    than as absence of scope
  - bottom grants do not satisfy tenant-root or concrete document/scope targets
- [ ] Planning artifacts separate high-value adjacent cleanups from out-of-scope
  temptations.
- [ ] Planning artifacts name the broader migration surfaces beyond the
  repository evaluator, including `AccessCheckFailure`, `listCreatableScopes`,
  `setDocumentAuthScope`, and granted-scope/list filtering helpers.
- [ ] Task stays planning-only and does not require production code or test
  edits.

## Out of Scope

- Implementing the new contract in `server/auth/um/repository.ts`, `server/auth/um/service.ts`, `server/data/documents/service/service.ts`, `server/db/query.ts`, or tests.
- Re-opening the parent issue-4 decision to support `resourceScope: "none"`.
- Broader RBAC redesign beyond the `checkCapabilities` target-semantics seam.

## Notes

- This child feeds the parent `issue-4-resource-scope-none-db` task rather than replacing it.
- Likely implementation touchpoints once this planning task is settled:
  - `server/auth/um/types.ts`
  - `server/auth/um/repository.ts`
  - `server/auth/um/service.ts`
  - `server/data/documents/service/service.ts`
  - `server/db/query.ts`
  - `test/unit/server/auth-rbac.test.ts`
