# Implementation Plan

1. Update auth type contracts and all request builders to use `targetScopeIds`.
2. Rewrite `KyselyAuthRbacRepository.checkCapabilities` to batch permission × scope evaluation and aggregate ordered `missingCaps` rows.
3. Refactor `AuthRbacService.evaluateAccess` to validate flattened scope ids and derive failures from `missingCaps`.
4. Update document-service access batching to consume the new evaluation shape.
5. Update unit tests for the changed call shapes and denial details.
6. Run the targeted auth unit test file and fix any regressions.

## Validation

- `bun test test/unit/server/auth-rbac.test.ts`

## Review gates

- Confirm root-scope checks still use `null` at service boundaries.
- Confirm no caller still expects `capabilities` or `hasCaps` in `CapabilityEvaluation`.
- Confirm delegated role assignment still performs one `checkCapabilities` call with role-derived permissions batched in SQL.
