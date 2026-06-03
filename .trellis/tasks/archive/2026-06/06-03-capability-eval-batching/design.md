# Design

## Scope

Implement the incomplete capability batching contract change across `server/auth/types.ts`, `server/auth/repository.ts`, `server/auth/service.ts`, document-service callers, and unit tests.

## Existing behavior

`checkCapabilities` currently unnests one row per check, expands direct capabilities and role-derived permissions laterally, checks one normalized target scope per row, and returns ordered booleans plus capability lists. `evaluateAccess` then finds the first denied capability by aligning the returned `capabilities` and `hasCaps` arrays.

## Target behavior

Each `CapabilityAccessCheck` supplies `targetScopeIds: string[] | null`. For every check, SQL must:

1. resolve the actor user id,
2. normalize the check into a set of target scopes (root scope when `targetScopeIds` is `null` or empty root-equivalent),
3. expand direct capabilities and role-derived permissions into one permission stream that retains `permissionId`, `permissionKey`, source `roleId | null`, and deterministic input order,
4. cross join that permission stream with the target scope stream,
5. left join granted permissions for the actor on `(tenantId, userId, permissionKey, descendantId)`,
6. aggregate only the missing permission × scope combinations back per check,
7. compute `allowed` as `hasOverride || missingCaps.length === 0`.

## Query shape

Keep the existing `granted` CTE and outer `input` unnest. Replace the current lateral aggregate with a lateral subquery that:

- unnests `input.capabilities` with ordinality,
- unions role-derived permissions from `input.roleIds` with ordinality and `roleId`,
- unnests `input.targetScopeIds` with ordinality, or synthesizes a single root-scope target when the array is null,
- cross joins permissions × scopes,
- left joins `granted` to detect missing rows,
- aggregates missing rows as ordered JSONB objects to avoid parallel arrays.

The repository can then select:

- `userId`
- `allowed`
- `hasOverride`
- `missingCaps`

without returning intermediate per-capability boolean arrays.

## Service refactor

`AuthRbacService.evaluateAccess` must:

- validate `targetScopeIds.flat()` instead of scalar `targetScopeId`,
- continue delegating tenant/permission validation before repository evaluation,
- treat the first denied check as `missingCaps[0]` when building `AUTH_PERMISSION_DENIED`, mapping root-scope misses back to `null` for external error payloads,
- keep returning the full repository evaluations for non-throwing callers.

## Callsite updates

- Single-scope checks become `targetScopeIds: [scopeId]`.
- Root-scope checks become `targetScopeIds: null`.
- Document-service deduplicated checks should batch a single capability against one-element `targetScopeIds` arrays, then determine allowance by `missingCaps.length === 0`.

## Risks / compatibility

- The biggest risk is losing stable ordering between input checks and missing-capability aggregation; order explicitly by check ordinality, capability/role ordinality, and scope ordinality.
- Root-scope normalization must remain internal to repository results; callers still use `null` to mean tenant root.
- Empty capability lists should still allow unless override or validation rules fail.
