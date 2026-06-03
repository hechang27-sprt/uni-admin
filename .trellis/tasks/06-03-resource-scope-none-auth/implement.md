# Resource Scope None Authorization Semantics Implementation Plan

## Implementation Boundary

Perform a clean semantic rename from `resourceScope: "none"` to `resourceScope: "tenant-root"` across the collection auth model, document service, tests, and server specs.

Do not add a new unscoped capability-evaluation mode.

## Before Development

1. Run `trellis-before-dev` for the server/auth, document-service, and testing layers before editing code.
2. Re-read this task's `prd.md` and `design.md`.
3. Run GitNexus impact analysis before modifying the collection registry and `DocumentService` symbols.

## Ordered Work

1. Update the collection auth type and resolver output.
   - Change `CollectionResourceScopeMode` to `"document" | "tenant-root"`.
   - Preserve defaulting behavior in `resolveCollectionOperationAuth(...)` and `resolveCollectionActionAuth(...)`.
2. Update document-service auth branches.
   - Replace every `resourceScope === "none"` check with `resourceScope === "tenant-root"`.
   - Preserve existing batching and `targetScopeIds: [null]` behavior.
3. Update in-repo collection auth declarations and related tests.
   - Replace any literal `"none"` declaration/expectation with `"tenant-root"`.
   - Ensure no alias or backward-compat branch remains.
4. Update the server auth/RBAC spec wording.
   - Clarify that `tenant-root` means evaluation at the tenant root scope.
   - Remove wording that suggests the absence of target-scope evaluation.
5. Run focused tests.
   - Auth/document unit tests that cover collection auth resolution and document authorization.

## Validation

Run the relevant focused checks after implementation:

```bash
bunx vitest run test/unit/server/auth-rbac.test.ts
bunx vitest run test/unit/server/service.test.ts
```

If a registry-specific unit file exists or is added, run it too.

## Review Gates

- No source usage of `resourceScope: "none"` remains in active code/specs touched by this task.
- `tenant-root` checks still authorize through `targetScopeIds: [null]`.
- Tests demonstrate unchanged behavior with the new explicit terminology.
- No evaluator/repository changes introduce unscoped capability semantics.
