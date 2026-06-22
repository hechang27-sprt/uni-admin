# review change mrrmqyyo for similar logic problems

## Goal

Capture the grounded review result for change `mrrmqyyo` (`refactor: rewrite document scope filtering semantics`) and record the confirmed bug-fix plan before any implementation starts.

## What I already know

- The review covered the change diff plus current code in `server/auth/um/*`, `server/data/documents/*`, `server/db/*`, `test/unit/server/auth-rbac.test.ts`, and the changed Trellis specs.
- The primary confirmed regressions are in protected list filtering after the direct-grant rewrite.
- This task remains planning-only. No fix has been implemented or verified yet.

## Review Findings

### Confirmed code bugs

1. `server/data/documents/repository/query.ts:125-127`
   - `buildGrantedScopeCondition()` returns `eb.lit(true)` for `resourceScope === "tenant-root"`.
   - This over-authorizes protected list reads: any non-empty direct grant list passes, including child-scoped grants that do not reach tenant root.

2. `server/data/documents/repository/query.ts:129-132`
   - `buildGrantedScopeCondition()` accepts `resourceScope === "none"` only when a direct grant is exactly `BOTTOM_SCOPE_ID`.
   - This under-authorizes protected list reads: ancestor/root grants that should reach bottom through `auth_scope_closure` are filtered out.

### Confirmed spec regressions

3. `.trellis/spec/server/auth-rbac.md:37-45,80-84`
   - The RBAC interface example still documents nullable scope contracts (`scopeId: string | null`, `targetScopeId: string | null`) even though the cutover made them concrete UUID-based inputs.

4. `.trellis/spec/server/auth-rbac.md:199-200`
   - The Good-case example still says root grants access `auth_scope_id = null` documents, which contradicts the explicit-root / explicit-bottom sentinel model documented elsewhere in the same spec.

### Confirmed design inconsistency to address while fixing

5. Protected list filtering currently threads `resourceScope` from `DocumentService.list()` into repository/query input even though `permissions.resource_scope` is already persisted.
   - Code paths: `server/data/documents/service/service.ts:154-183`, `server/data/documents/types.ts:83-112`, `server/db/query.ts:41-59`, `server/db/schema.ts:100-109`.
   - This is not a second end-user regression by itself, but it duplicates canonical permission metadata and made the override-mode bug easier to encode in the wrong layer.

### Explicit non-findings

- `resourceScope: "none"` allowing concrete scoped grants to satisfy `BOTTOM_SCOPE_ID` targets is intentional under the current documented semantics; do not treat that as a bug.
- The concern that `ensureTenantRootScope()` fails to create tenant-scoped bottom self-closure rows was not reproduced. The insert trigger in `server/db/migrations/001-baseline.ts` covers root creation, and `test/unit/server/auth-rbac.test.ts:1694-1725` already asserts the closure rows.

## Requirements

- Preserve the review result in task artifacts with exact file/symbol evidence.
- Distinguish confirmed bugs from rejected concerns.
- Record a concrete implementation plan for fixing the confirmed protected-list regressions and stale spec examples.
- Keep the plan bounded to the reviewed defect area unless later implementation uncovers more breakage.

## Acceptance Criteria

- [ ] Task docs name the confirmed code bugs and stale spec regressions with exact files and concise rationale.
- [ ] Task docs record the rejected concerns / non-findings so the future fix does not chase false positives.
- [ ] Task docs include a concrete ordered fix plan for repository filtering, tests, and spec cleanup.
- [ ] Task docs state the metadata-duplication issue as a design choice to resolve during implementation, not as an already-fixed outcome.

## Definition of Done

- Findings are grounded in source and change diff
- No implementation is described as already verified
- The follow-up fix plan is specific enough to start Phase 2 without re-reviewing the whole change

## Out of Scope

- Applying the code fix in this planning step
- Broad refactors outside the reviewed scope-filtering / spec-cutover surface unless the implementation uncovers a direct dependency

## Technical Notes

- Review target: `jj show mrrmqyyo`
- Primary code areas: `server/data/documents/repository/query.ts`, `server/data/documents/service/service.ts`, `server/auth/um/repository.ts`, `server/db/query.ts`, `test/unit/server/auth-rbac.test.ts`
- Relevant specs: `.trellis/spec/server/auth-rbac.md`, `.trellis/spec/server/repository-and-database.md`, `.trellis/spec/server/document-service.md`, `.trellis/spec/server/testing.md`
