# Refactor capability evaluation batching

## Goal

Complete the `checkCapabilities` shape change so batched capability evaluation accepts per-check scope arrays, evaluates every capability/role-derived permission against every requested scope in SQL, and updates service/document callsites to consume the new missing-capability result shape.

## Requirements

- Preserve the existing `checkCapabilities` query structure: one batched query with the existing granted-permissions CTE and batched input unnesting.
- Rewrite the repository query so each `CapabilityAccessCheck` evaluates all requested `targetScopeIds` for both direct `capabilities` and permissions implied by `roleIds`.
- Use SQL cross joins/lateral joins inside the existing batching strategy rather than issuing per-scope or per-capability follow-up queries from TypeScript.
- `CapabilityEvaluation` must report only missing capabilities, including the missing permission id, the originating role id when the missing permission came from a role, and the evaluated target scope id.
- Preserve root-scope semantics: `null` target scopes normalize to the tenant root scope for evaluation, while the result must still identify root-scope misses.
- Refactor `AuthRbacService.evaluateAccess` to derive allow/deny and error reporting from `missingCaps` instead of the removed `capabilities`/`hasCaps`/`targetScopeId` fields.
- Refactor all `evaluateAccess` callsites and tests affected by `targetScopeIds` and the new result shape.
- Keep validation behavior intact for scope id validation, permission key validation, active membership checks, and existing override semantics.

## Acceptance Criteria

- [ ] `CapabilityAccessCheck` callers pass `targetScopeIds` instead of `targetScopeId`.
- [ ] `KyselyAuthRbacRepository.checkCapabilities` evaluates the full capability × target-scope matrix per check in one SQL query and returns only missing entries.
- [ ] `AuthRbacService.evaluateAccess` denies based on the first missing capability entry and still returns successful batched evaluations for callers that inspect them.
- [ ] Document-service scope checks still deduplicate scope ids before calling `evaluateAccess` and correctly map results back to the original document order.
- [ ] Unit tests cover the changed request/response shapes and delegated-role evaluation behavior.
