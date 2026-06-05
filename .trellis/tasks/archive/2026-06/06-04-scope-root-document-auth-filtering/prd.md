# Scope-root document auth filtering

## Goal

Reduce authorization fan-out for document reads by replacing descendant-expanded accessible-scope lists with grant-scope-root filtering, while preserving protected document semantics for `findByIds(...)`, `getByIds(...)`, `list(...)`, and creatable-scope discovery where still needed.

## What I already know

- `AuthRbacRepository.listAccessibleScopeIds(...)` currently returns every reachable descendant scope id for a `(tenantId, userId, capability)` tuple.
- `AuthRbacService.listAccessibleDocumentScopeIds(...)` maps tenant-root scope to `null` for document-facing consumers.
- `DocumentService.list(...)` currently pushes those expanded scope ids into repository filtering.
- `DocumentService.getByIds(...)` currently loads documents first, then applies `filterAccessibleDocuments(...)` in memory using `evaluateAccess(...)`.
- `evaluateAccess(...)` is high-risk and widely reused; the proposed change should avoid broad policy churn there.
- The document repository currently has no structural scope-containment helper for read-by-id authorization.
- The desired repository API direction is to overload `findByIds(...)` with an additional optional scope-filter input rather than adding a sibling method.
- `listGrantedScopeIdsForCapability(...)` may legitimately return both `null` and concrete scope ids; that is not incoherent because a user can hold the same capability at tenant root and at narrower scopes.
- The current positional-`null` read contract is disliked and should be treated as legacy behavior to preserve only where necessary for existing service APIs.

## Requirements

- Replace descendant-expanded accessible scope enumeration for document filtering with a grant-scope-root representation that grows with effective grants rather than subtree size.
- Keep authorization policy ownership in `AuthRbacService.evaluateAccess(...)` and related service methods; repository changes must stay structural/data-oriented rather than policy-omniscient.
- Sketch a new auth/repository API that returns distinct scope ids at which the actor effectively has the capability.
- Allow `listGrantedScopeIdsForCapability(...)` to return `Array<string | null>`.
- Overload `DocumentRepository.findByIds(...)` with an optional input parameter for structural scope filtering rather than adding a sibling method.
- Tighten overloaded `findByIds(...)` input to `accessibleScopeIds?: string[] | null`.
  - `undefined` and `null` are contractually equivalent: both mean no scope-level filtering.
  - `string[]` means restrict visible documents to those whose non-null `authScopeId` is contained by at least one provided ancestor scope.
  - `[]` is meaningful and distinct from `null`/`undefined`: it means no scoped documents are accessible.
- Preserve existing service behavior where required today:
  - `getByIds(...)` preserves caller order and returns `null` for missing or denied items unless/until a separate API redesign changes that contract.
  - `list(...)` remains SQL-filtered for protected reads.
- Prefer future repository/service read APIs that return keyed/object-shaped results over positional `null` arrays when introducing new contracts, but do not force that redesign into this task unless explicitly scoped in.
- Avoid changing `evaluateAccess(...)` beyond what is necessary to validate membership/permission existence before grant-root lookup.

## Acceptance Criteria

- [ ] PRD records the overloaded `findByIds(...)` direction and its tightened input shape.
- [ ] PRD records that `listGrantedScopeIdsForCapability(...)` may return both `null` and concrete scope ids.
- [ ] PRD records that repository contract does not distinguish `accessibleScopeIds === null` from `accessibleScopeIds === undefined`.
- [ ] PRD records how existing `getByIds(...)` behavior is preserved despite disliking the positional-`null` contract.
- [ ] PRD records which current flows should consume the new shape (`getByIds`, `list`, and scope-list helpers as applicable).
- [ ] PRD captures out-of-scope items so planning stays bounded.

## Out of Scope

- Implementing the refactor.
- Redesigning public read APIs from positional arrays to keyed objects/maps in the same task.
- Changing write-path authorization semantics.
- Reworking `evaluateAccess(...)` beyond what is necessary to validate capability existence/membership before scope-root lookup.
- Adding new API routes, UI changes, or docs outside task artifacts.

## Technical Notes

- Impact analysis: `AuthRbacService.listAccessibleScopeIds` is LOW risk upstream; `AuthRbacService.evaluateAccess` is CRITICAL risk upstream and should not be the main refactor surface.
- Relevant files:
  - `server/auth/service.ts`
  - `server/auth/repository.ts`
  - `server/auth/types.ts`
  - `server/data/documents/service/service.ts`
  - `server/data/documents/repository/kysely.ts`
  - `server/data/documents/repository/types.ts`
- Verified current auth/document behavior with `bun run vitest --project unit test/unit/server/auth-rbac.test.ts`.
