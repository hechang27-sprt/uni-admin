# Resource scope `none` semantics research

## Scope of inspection

Targeted repository inspection only:

- `server/data/collections/registry.ts`
- `server/data/documents/service/service.ts`
- `server/auth/um/service.ts`
- `server/auth/um/repository.ts`
- `server/auth/um/types.ts`
- `server/db/query.ts`
- `server/db/schema.ts`
- `server/db/migrations/001-baseline.ts`
- `test/unit/server/auth-rbac.test.ts`
- `.trellis/spec/server/auth-rbac.md`
- `issue://4`

## Issue intent

Issue #4 says the database currently cannot express `resourceScope: "none"` because `user_role_assignments.scope_id` has no null representation for a grant at the virtual bottom scope. Per user clarification on 2026-06-16, `resourceScope: "none"` is intended to behave as the bottom scope: effectively a child of every possible concrete scope in the tenant.

## Supported `resourceScope` values today

Today the collection auth declaration schema accepts only two values:

- `"document"`
- `"tenant-root"`

Evidence:

- `server/data/collections/registry.ts:34-40` defines `collectionResourceScopeModeSchema = z.enum(["document", "tenant-root"])` and uses it for operation declarations.
- `server/data/collections/registry.ts:47-64` reuses the same enum for collection-level auth and resolved auth.
- `server/data/collections/registry.ts:259-289` resolves operations/actions to `resourceScope`, defaulting to `"document"`.
- `test/unit/server/auth-rbac.test.ts:129-162` covers explicit `"tenant-root"` resolution.
- `.trellis/spec/server/auth-rbac.md:126-129` documents only `"document"` and `"tenant-root"`.

Conclusion: `resourceScope: "none"` is not part of the declared schema today.

## Where document vs tenant-root checks choose target scopes

### Collection auth resolution

`CollectionRegistry.resolveOperationAuth` and `resolveActionAuth` collapse declarations to a `{ capability, resourceScope }` pair and default missing scope declarations to `"document"`.

- `server/data/collections/registry.ts:259-289`

### Document reads

`DocumentService.list()` branches on the resolved scope:

- `server/data/documents/service/service.ts:145-168`
  - `resourceScope === "tenant-root"` -> calls `assertDocumentAccess` with `targetScopeIds: [null]`
  - otherwise -> builds a document-scope filter via `buildAccessibleDocumentScopeFilter(...)`

### Document creates

Create authorization also branches on the resolved scope:

- `server/data/documents/service/service.ts:672-704`
  - `tenant-root` -> `targetScopeIds: [null]`
  - `document` -> `targetScopeIds: uniq(authScopeIds)` where each input document scope is preserved, with `null` meaning tenant root document

### Existing document mutations

Update/patch/delete/restore/hard-delete branch the same way:

- `server/data/documents/service/service.ts:706-741`
  - `tenant-root` -> `targetScopeIds: [null]`
  - `document` -> `targetScopeIds: uniq(documents.map((document) => document.authScopeId))`

### Scope-management helpers

Additional places hard-code root-scope capability checks with `targetScopeIds: [null]`:

- `server/data/documents/service/service.ts:604-623` (`setDocumentAuthScope` checks both current and target scope ids, including `null`)
- `server/data/documents/service/service.ts:634-669` (`listCreatableScopes` returns `[null]` for `tenant-root` collections)
- `server/auth/um/service.ts:315-331` maps repository root scope ids back to API-level `null`
- `server/auth/um/types.ts:145-151` explicitly says `targetScopeIds` null entries mean tenant root scope
- `.trellis/spec/server/auth-rbac.md:116,126-135` documents `authScopeId: null` and `targetScopeIds: [null]` as tenant-root semantics

Conclusion: current call sites already use `null` as the API-level marker for the tenant root, not for “no scope”.

## Whether `resourceScope: "none"` is currently accepted

No.

Evidence:

- `server/data/collections/registry.ts:34-40` restricts the schema to `"document" | "tenant-root"`.
- `server/data/collections/registry.ts:259-289` can only resolve those two values.
- `test/unit/server/auth-rbac.test.ts:129-162` exercises `tenant-root`; there is no parser or resolver coverage for `none`.
- `.trellis/spec/server/auth-rbac.md:126-129` only documents `document` and `tenant-root`.

Any attempt to register `resourceScope: "none"` would currently fail schema validation before authorization logic runs.

## Why a null-scope grant cannot work today

There are two separate blockers in the current implementation.

### 1. Assignment storage forbids null scopes

- `server/db/schema.ts:118-124` types `UserRoleAssignmentsTable.scopeId` as `string`
- `server/db/migrations/001-baseline.ts:258-266` creates `user_role_assignments.scope_id` as `uuid ... not null`
- `server/auth/um/repository.ts:95-101` and `494-527` accept/insert `assignRoles(... scopeId: string)` only

So the database and repository surface cannot currently persist a null assignment scope.

### 2. Permission expansion assumes every assignment participates in scope closure

- `server/db/query.ts:29-46` defines `selectGrantedPermissions()` by inner-joining `authScopeClosure c` on `c.ancestorId = assigned.scopeId`
- `server/auth/um/repository.ts:671-853` builds capability evaluation from that granted-permissions expansion
- `server/auth/um/repository.ts:813-817` converts `targetScopeIds: [null]` into the actual tenant root scope id and marks it as `isRootScope`

This means the current engine has exactly one meaning for `null` at evaluation time: “check the tenant root scope”. A database assignment row with `scope_id = null` would not join into `authScopeClosure`, so it would produce no descendant grant rows at all. Even if storage were relaxed, the evaluator would still ignore null-scope assignments unless the SQL model changes.

## How a bottom-scope grant should be passed into / evaluated by `checkCapabilities`

Corrected semantics shape after user clarification:

1. Keep API-level `targetScopeIds: [null]` meaning tenant root for existing document/tenant-root checks.
   - This is already baked into `CapabilityAccessCheck` (`server/auth/um/types.ts:145-151`), repository normalization (`server/auth/um/repository.ts:813-817`), document auth calls (`server/data/documents/service/service.ts:145-168,672-741`), and the spec (`.trellis/spec/server/auth-rbac.md:116,126-135`). Reusing that same `null` marker for bottom scope would collide with existing root-scope behavior.
2. Represent explicit bottom-scope grants in storage with `user_role_assignments.scope_id = null`.
3. Extend capability evaluation with an explicit bottom-scope check mode instead of overloading `targetScopeIds: null`.
   - Example shape: add `resourceScope: "document" | "tenant-root" | "none"` to each `CapabilityAccessCheck`, or add a separate boolean/enum like `scopeMode`.
   - `resourceScope: "none"` checks should target the virtual bottom scope.
   - Concrete scoped grants should satisfy bottom checks because bottom is a child of every concrete scope in the tenant.
   - Explicit bottom grants (`scope_id is null`) should also satisfy bottom checks.
4. Keep upward access forbidden:
   - bottom-scope grants must not satisfy root/document checks
   - root/document checks continue to use only concrete scope-tree semantics

In short: null assignment scope belongs in the grant row as explicit bottom scope, while bottom-scope checks need an explicit evaluator mode distinct from the existing tenant-root null sentinel.

## Test scenarios needed to prove non-scope grants do not broaden scoped access

Existing tests already prove the current scoped invariants:

- `test/unit/server/auth-rbac.test.ts:429-523` proves a child-scope grant only sees/mutates documents in that subtree
- `test/unit/server/auth-rbac.test.ts:526-581` proves root-scoped create can target child scopes and root documents, with `authScopeId: null` still meaning tenant root
- `test/unit/server/auth-rbac.test.ts:583-747` proves batch checks dedupe by logical operation
- `.trellis/spec/server/auth-rbac.md:187-189` explicitly wants root null-doc access and sibling denial coverage

New coverage for issue #4 should add at least these cases:

1. `resourceScope: "none"` declaration acceptance and resolution
   - collection/action registration accepts `none`
   - resolver returns `{ capability, resourceScope: "none" }`
2. Concrete scoped assignment evaluates for `none`
   - assign a role at a concrete scope
   - a `checkCapabilities` call marked as bottom/`none` succeeds for that permission
3. Null/bottom-scope assignment persists and is evaluated for `none`
   - assign a role with `scope_id = null`
   - a `checkCapabilities` call marked as bottom/`none` succeeds for that permission
4. Null/bottom-scope assignment does not satisfy tenant-root checks
   - same actor must still fail a check whose target is `targetScopeIds: [null]` under `tenant-root` semantics unless they also have a concrete root-scoped grant
5. Null/bottom-scope assignment does not satisfy document-scope checks
   - same actor must still fail reads/mutations against scoped documents and tenant-root documents managed under `resourceScope: "document"` unless they also have an applicable concrete scoped grant
6. Mixed grants stay isolated upward
   - actor with both bottom and scoped assignments gets bottom access from both lanes, but bottom access should not imply descendant document access

## Recommended authorization semantics

Concise shape recommendation:

- Keep existing meanings unchanged:
  - `resourceScope: "document"` -> compare against document `auth_scope_id`, with `targetScopeIds: [null]` still meaning tenant root document
  - `resourceScope: "tenant-root"` -> compare only at tenant root, still expressed as `targetScopeIds: [null]`
- Add a third resource declaration: `resourceScope: "none"`
- Persist explicit bottom grants as `user_role_assignments.scope_id = null`
- Teach `checkCapabilities` to evaluate `none` via an explicit bottom-scope check mode, not by reinterpreting the current root sentinel
- Permit downward satisfaction from concrete scoped grants to bottom checks, but forbid bottom grants from satisfying root/document checks

That preserves all current root/document behavior while making the new “permission granted, but not at any scope” rule precise and non-ambiguous.
