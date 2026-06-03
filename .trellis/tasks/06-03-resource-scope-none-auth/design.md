# Resource Scope None Authorization Semantics Design

## Scope

This task is a semantic cleanup of collection authorization scope terminology. It does not introduce a new authorization capability model.

The current implementation and evaluator already support two meaningful concepts:

- document-scoped authorization
- tenant-root-scoped authorization

The current enum value `"none"` is misleading because it suggests the absence of target-scope evaluation, while the implementation actually evaluates against the tenant root scope by passing `targetScopeIds: [null]`.

## Decision

Replace `CollectionResourceScopeMode = "document" | "none"` with explicit terminology:

- `"document"`
- `"tenant-root"`

This makes source, tests, and specs describe the actual model honestly.

## Why not add a true unscoped mode now

A true unscoped mode would require auth-model expansion, not just a rename:

- `AuthRbacService.evaluateAccess(...)` and `KyselyAuthRbacRepository.checkCapabilities(...)` currently model capability checks against `targetScopeIds`.
- `checkCapabilities(...)` laterally unnests `targetScopeIds`; there is no first-class "no target scope" path.
- No confirmed in-repo consumer currently requires collection auth that is capability-checked without document scope or tenant-root scope.

So the task should stop at semantic correction rather than introducing a new evaluator concept without a concrete use case.

## Source Changes

### Collection auth registry

Update `server/data/documents/registry.ts`:

- rename the type union to `"document" | "tenant-root"`
- ensure operation/action auth resolution preserves behavior while returning the new explicit value
- keep `"document"` as the default

### Document service

Update `server/data/documents/service/service.ts`:

- replace every branch that checks `resourceScope === "none"` with `resourceScope === "tenant-root"`
- preserve the current behavior of passing `targetScopeIds: [null]` for tenant-root capability checks
- preserve the existing batching/dedup behavior introduced for `evaluateAccess(...)`

### Specs and planning artifacts

Update `.trellis/spec/server/auth-rbac.md`:

- replace the current `resourceScope: "none"` wording with `resourceScope: "tenant-root"`
- explicitly state that `tenant-root` means capability evaluation at the tenant root scope
- leave any future truly-unscoped mode out of this task

If any current task/planning artifact in active task scope mentions the old meaning, align it to the new wording. Archived tasks should not be rewritten unless they are explicitly used as living references; they can remain historical context.

## Testing

Update/add tests so they prove:

- collection auth declarations resolve the new `tenant-root` mode
- document service authorization still performs tenant-root checks for that mode
- no behavior changes occur beyond the enum/spec rename

Focus on existing auth/document unit coverage rather than adding broad new integration surfaces.

## Compatibility and Migration

This is a source-level breaking rename for collection registration declarations inside the codebase, but behavior remains unchanged.

Because the value is internal source configuration and there is no published external API contract for third-party collection declarations in this repository, the migration is acceptable as a clean cutover:

- update all in-repo declarations in one change
- remove the old `"none"` mode rather than aliasing both spellings

## Risks

- Missing one in-repo declaration or conditional branch would create inconsistent semantics.
- Tests that assert the old enum literal will need deliberate updates.
- If any future work had been mentally relying on `"none"` meaning true unscoped authorization, this task must make that non-goal explicit in specs.

## Review Gates

- No remaining `CollectionResourceScopeMode` usage refers to `"none"`.
- The evaluator behavior is unchanged: tenant-root checks still flow through `targetScopeIds: [null]`.
- Specs use terminology that matches the implemented model.
- No new unscoped capability semantics are introduced accidentally.
