# Design: Refine `checkCapabilities` target semantics for bottom-scope RBAC

## Problem

`checkCapabilities` historically used `targetScopeIds` as subtree targets:

- concrete scope ids mean ordinary scope-tree targets
- `null` means the tenant-root target

Issue #4 introduced a second null-bearing concept: `user_role_assignments.scope_id = null` now means an explicit bottom-scope grant for `resourceScope: "none"`.

That creates a semantic conflict if nullable `targetScopeIds` continues to carry all target meaning. The same broad wire shape now risks representing two different axes:

- grant shape: what assignment exists on the role grant
- target semantics: what kind of resource target the caller is checking

These axes are related but not interchangeable.

## Settled direction

The child task should now plan around a boring, DB-aligned evaluator contract:

- concrete scope UUIDs mean concrete scopes, including the tenant root scope
- `null` means the virtual bottom scope only
- `checkCapabilities` should not inspect `resourceScope` to decide target
  meaning at evaluation time
- tenant-root checks must use the actual tenant root scope id before the
  repository call

## Bottom-scope interpretation to preserve

`null` should be planned as a true bottom element in the scope lattice, not as
an “unscoped” or missing target.

Intended interpretation:

- the tenant root scope is the top of the tenant scope tree
- concrete scopes sit inside that tree
- bottom is a virtual scope below every concrete scope
- `auth_scope_closure` can be reasoned about as if it had implicit rows from
  every concrete scope to bottom

This is why the matching rules make sense:

- concrete scoped grants can satisfy bottom-target checks
- bottom grants cannot satisfy upward tenant-root or concrete-scope checks

This bottom-element model should be called out explicitly in the follow-up
implementation plan so future refactors do not drift back toward treating
`null` as “no scope”.

This direction is narrower and cleaner than both the current `targetMode`
approach and the previously discussed metadata-driven null fallback.

## Why this direction is better

It makes the repository evaluator a straight match engine instead of a target
interpreter.

- `resourceScope` remains meaningful, but above the evaluator: collection and
  document services decide what target should be checked
- the repository no longer needs a `targetMode` branch or a root-null sentinel
  convention
- the DB model becomes aligned end-to-end:
  - `user_role_assignments.scope_id = null` already means bottom grant
  - `targetScopeIds: null` now means bottom target too
  - tenant root is represented by its real scope id on both read and write paths

This keeps the hard semantic work at the translation boundary rather than in the
SQL evaluator.

## Translation-boundary model

The settled part of the plan is only this: higher layers must translate auth
intent before calling `checkCapabilities`, and the repository should then
evaluate explicit targets without reading permission metadata to reinterpret
them.

What is already settled:

- collection `resourceScope: "tenant-root"` should translate to the real tenant
  root scope id
- collection `resourceScope: "none"` should translate to `null`
- evaluator inputs should stop using `targetScopeIds: [null]` as a tenant-root
  convention

What is still an explicit prerequisite decision before implementation:

- whether persisted document `authScopeId = null` keeps the current runtime
  meaning (tenant-root document) and is only translated differently by
  capability overrides
- or whether this refactor also performs a broader semantic migration where
  document `authScopeId = null` becomes bottom-scoped by default

The child task should not treat that document-default semantic migration as
already settled unless it is called out and accepted explicitly.

## Consequences for evaluator contracts

### `CapabilityAccessCheck`

- remove `targetMode` from the evaluator-facing contract
- stop using `targetScopeIds: [null]` to mean tenant root
- treat `targetScopeIds` as DB-aligned values:
  - `string` = concrete scope id
  - `null` = bottom target

### `CheckAccessInput`

- same shift as above: tenant-root checks should pass the real root scope id
- `null` should be reserved for bottom semantics only, or removed from this
  surface if higher layers can always translate first

### `CapabilityEvaluation.missingCaps`

- stop using `isRootScope` as the way to reconstruct target semantics
- either carry the fully translated `targetScopeId` only, or add an explicit
  target discriminator if the public error/reporting surface still needs one
- root misses should refer to the actual root scope id, not a null sentinel

### Error mapping

- `permissionDenied` and `AuthRbacService.assertCapabilities` should stop
  reconstructing root-vs-bottom from nullable ids plus `isRootScope`
- denial output should reflect the translated target that was actually checked

### Additional public/service return-shape migration

- `AccessCheckFailure.kind = "capability"` currently carries
  `targetScopeId: string | null`; this surface must migrate with the evaluator
  contract, not after it
- `DocumentService.listCreatableScopes()` currently returns `(string | null)[]`
  and uses `null` as tenant-root for non-document flows; that contract must be
  reviewed as part of the same cutover
- `listGrantedScopeIdsForCapability()` currently maps `scopeId is null` back to
  returned `null`, and `buildAccessibleDocumentScopeFilter()` treats any
  returned null as a signal to disable scope filtering; that coupling becomes
  ambiguous under the planned bottom model unless redesigned

## Why the earlier ideas now look weaker

### Current `targetMode` approach

This still works semantically, but it leaves the evaluator with two target
channels:

- nullable scope ids
- an out-of-band mode flag

That is exactly the seam this child task is trying to remove.

### Metadata-driven null fallback

This is now less attractive for a simpler reason than before:

- `checkCapabilities` works with raw scope targets, not document entities
- `resourceScope: "document"` only makes sense after higher layers decide which
  document scope id is being targeted

Once that translation already has to happen outside the evaluator, it is cleaner
to keep all `resourceScope` interpretation outside the evaluator.

## Current-codebase note — `document` is still first-class

Do not treat `resourceScope: "document"` as stale or purely redundant in the
current codebase.

Observed current behavior:

- `CollectionRegistry` still accepts `document`, `tenant-root`, and `none`
  explicitly as collection auth modes
- registry resolution still defaults omitted operation/action auth to
  `document`
- `DocumentService` still has distinct `document` handling:
  - list/read filters by accessible document auth scopes
  - create helpers enumerate real creatable scopes for document-scoped
    collections
  - document operations authorize against each document's concrete
    `authScopeId`, with `null` document scope translated to tenant root

So reducing the schema to only `tenant-root | none` or changing the default to
tenant-root would be a repo-wide semantics migration, not a local cleanup.

## Required matching matrix

Any eventual implementation must preserve this matrix:

- concrete scoped grant -> concrete scope target: allowed according to
  subtree/root rules
- concrete scoped grant -> tenant-root target: allowed only when it covers the
  tenant root target under existing semantics
- concrete scoped grant -> bottom target: allowed
- bottom grant -> bottom target: allowed
- bottom grant -> tenant-root target: denied
- bottom grant -> concrete scope/document target: denied

## Adjacent cleanup worth doing in the same refactor

High-value cleanup coupled directly to this contract migration:

- remove `targetMode` from evaluator-facing types and call paths
- make root-vs-bottom conventions explicit at one translation boundary
- tighten repository inputs so they no longer rely on `(string | null)[]` as a
  tenant-root sentinel convention
- move document-service translation of `resourceScope` and `authScopeId: null`
  into one helper instead of spreading evaluator semantics inline
- simplify `missingCaps` and `assertCapabilities` error mapping so they no
  longer rebuild target meaning from `isRootScope`
- align registry/service contracts around one canonical mapping from collection
  auth mode to translated evaluator targets
- include `server/auth/um/repository.ts:listGrantedScopeIdsForCapability` in the
  migration plan because it still maps `scopeId is null` back to returned
  tenant-root null

## Defer

Keep these out of the same refactor unless a later task explicitly expands
scope:

- changing the public collection auth-mode surface or removing the
  `document`/`tenant-root`/`none` distinction
- reworking `permissions.resource_scope` storage or the parent issue's
  `resourceScope: "none"` decision
- broader RBAC redesign beyond the `checkCapabilities` seam
- unrelated auth-helper or query-builder cleanup not directly coupled to target
  semantics

## Likely implementation touchpoints

- `server/auth/um/types.ts` — `CapabilityAccessCheck`, `CheckAccessInput`,
  `CapabilityEvaluation`, and `AccessCheckFailure`
- `server/auth/um/repository.ts` — `checkCapabilities`, target normalization
  removal, missing-cap reporting, and `listGrantedScopeIdsForCapability`
- `server/auth/um/service.ts` — translation wrappers and denial mapping
- `server/data/documents/service/service.ts` — central target-translation helper
  for `document` / `tenant-root` / `none`, plus `list()`,
  `listCreatableScopes()`, `authorizeCreate()`, `authorizeDocuments()`,
  `setDocumentAuthScope()`, `buildAccessibleDocumentScopeFilter()`, and
  `validateAuthScopes()`
- `server/db/query.ts` — granted-permission target matching once target mode is
  removed
- `test/unit/server/auth-rbac.test.ts` — migrated root/bottom target semantics
  and document-null behavior coverage

## Non-goals

- No schema redesign.
- No re-litigation of storing `resourceScope` on `permissions`.
- No general RBAC redesign beyond the target-semantics contract.
