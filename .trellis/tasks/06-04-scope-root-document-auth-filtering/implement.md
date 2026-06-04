# Implementation Plan — Scope-root document auth filtering

## Goal

Replace descendant-expanded document authorization filters with grant-scope-root filtering for protected reads, while preserving existing service contracts.

## Ordered Checklist

1. Add auth repository/service grant-root API
   - Introduce `listGrantedScopeIdsForCapability(...)` in auth repository interface and implementation.
   - Return `Array<string | null>`, where `null` means tenant root.
   - Preserve the ability for the returned set to contain both `null` and concrete scope ids.
   - Add the matching `AuthRbacService` wrapper that preserves current membership/permission validation via `evaluateAccess(...)`.

2. Overload document repository `findByIds(...)`
   - Add optional `accessibleScopeIds?: string[] | null` to `findByIds(...)` input.
   - Treat `undefined` and `null` identically: no scope-level filtering.
   - Treat `[]` as meaningful empty access, distinct from `null`/`undefined`.
   - Otherwise filter by `auth_scope_closure` ancestor/descendant containment.
   - Preserve caller order and current positional `null` behavior for existing callers.

3. Extend repository list filtering shape
   - Replace or augment simple `authScopeIds` filtering with the same normalized `accessibleScopeIds?: string[] | null` concept.
   - If the normalized filter is `null` or `undefined`, skip auth-scope filtering entirely for that tenant/collection query.
   - If the normalized filter is `[]`, return no accessible scoped documents.
   - Ensure `list(...)` still respects `includeDeleted`, user filters, sort, and pagination.

4. Update document service protected read flows
   - Switch `getByIds(...)` to use grant-root scope lookup + normalized repository filter input + overloaded `findByIds(...)`.
   - Switch `list(...)` to use the same normalized structural filtering shape.
   - Normalize auth results as follows:
     - auth returns `Array<string | null>`
     - repository input becomes `null` if any returned item is `null`
     - otherwise repository input becomes deduped `string[]`
   - Delete or narrow `filterAccessibleDocuments(...)` if it is no longer needed for read paths.

5. Update tests
   - Cover root-scoped and child-scoped read access.
   - Cover partial `getByIds(...)` denial returning positional `null`s under the current API contract.
   - Cover normalization where auth returns both `null` and concrete scope ids but repository still receives `accessibleScopeIds: null`.
   - Cover `accessibleScopeIds: []` as distinct from `null`/`undefined`.
   - Cover list behavior for root-only, child-only, sibling-denied, and empty-access scenarios.
   - Preserve existing mutation authorization expectations.

## Validation Commands

- `bun run vitest --project unit test/unit/server/auth-rbac.test.ts`
- Add the narrowest additional unit test command if new repository-specific coverage lands elsewhere.
- `bun run vitest --project unit` if the touched coverage footprint broadens enough to justify it.

## Review Gates

Before `task.py start` / before merging implementation:
- Confirm auth service still owns permission existence and membership validation.
- Confirm repository inputs remain structural/pre-authorized, not actor-aware.
- Confirm `Array<string | null>` → `string[] | null | undefined` normalization is specified and tested.
- Confirm repository contract does not distinguish `accessibleScopeIds === null` from `accessibleScopeIds === undefined`.
- Confirm `accessibleScopeIds === []` is explicitly handled and tested.
- Confirm `getByIds(...)` positional `null` contract is preserved for now.
- Confirm any keyed/object-shaped redesign is explicitly deferred.

## Rollback Points

- If structural SQL for `list(...)` becomes too invasive, land overloaded `findByIds(...)` first and leave `list(...)` on the old path in a follow-up.
- If scope-list helper changes expand scope, keep them out of the MVP and preserve existing helper behavior.
- If overloading `findByIds(...)` proves too error-prone during implementation, revisit the API split explicitly rather than drifting into a half-overloaded contract.
