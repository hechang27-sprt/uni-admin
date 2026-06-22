# Design — fix mrrmqyyo protected-list regressions

## Problem

Change `mrrmqyyo` rewrote protected document list filtering from a service-built scope-id helper to direct grant rows plus collection `resourceScope`. That change introduced two correctness bugs in `buildGrantedScopeCondition()`:

1. `tenant-root` mode treats any non-empty grant set as sufficient.
2. `none` mode treats only direct `BOTTOM_SCOPE_ID` grants as sufficient.

Both bugs come from replacing effective-target closure checks with direct-grant shortcuts.

## Confirmed bugs to fix

### 1. Tenant-root protected lists over-authorize

Current code:
- `server/data/documents/repository/query.ts:125-127`
- `if (resourceScope === "tenant-root") return eb.lit(true)`

Required behavior:
- protected list filtering must require a direct grant whose scope reaches the tenant root through `auth_scope_closure`
- child-only grants must not pass a tenant-root override

### 2. Bottom/none protected lists under-authorize ancestor grants

Current code:
- `server/data/documents/repository/query.ts:129-132`
- `scopeIds.includes(BOTTOM_SCOPE_ID)`

Required behavior:
- protected list filtering must treat `BOTTOM_SCOPE_ID` as an effective target descendant
- ancestor/root grants that reach bottom through closure must pass

### 3. Auth/RBAC spec examples are stale after the sentinel cutover

Current docs still advertise:
- nullable scope input examples
- `auth_scope_id = null` as the root-document example

These must be updated in the same patch so future work is not steered back to the pre-cutover model.

## Non-bugs / guardrails

- Do not change the current semantic rule that concrete scoped grants may satisfy `resourceScope: "none"` targets.
- Do not spend fix effort on root-scope closure creation unless implementation finds a reproducible failing case; the review did not confirm one.

## Decision

Fix the protected-list bug at the effective-target level, not with more boolean shortcuts.

### Repository filtering rule

`buildGrantedScopeCondition()` must remain closure-based for all modes:

- `document`
  - effective descendant = `documents.authScopeId`
- `tenant-root`
  - effective descendant = the tenant's real root scope id
- `none`
  - effective descendant = `BOTTOM_SCOPE_ID`

The query should ask whether any direct grant ancestor reaches that effective descendant through `auth_scope_closure`.

## Contract choice for the fix

Two viable implementation shapes exist:

### Option A — recommended canonical path

Derive collection `resourceScope` from persisted permission metadata instead of threading it from `DocumentService`.

Shape:
- pass canonical collection permission key into repository list filtering
- repository/query layer reads `permissions.resource_scope`
- repository/query layer computes the effective descendant by mode
- tenant-root descendant is resolved from tenant root, bottom descendant is `BOTTOM_SCOPE_ID`

Why prefer it:
- removes duplicated permission metadata
- makes DB state authoritative
- matches the review finding that current service-threaded `resourceScope` is a drift-prone design

### Option B — bounded correctness patch

Keep the current `grantedScopes + resourceScope` repository input contract, but replace the buggy `tenant-root`/`none` branches with closure checks against the correct effective descendant target.

Why it may be chosen:
- smaller blast radius
- directly repairs the confirmed end-user regressions

Tradeoff:
- leaves the metadata duplication in place

## Recommended implementation choice

Prefer Option A if the implementation stays contained to the document list path and tests.
If the DB-derived shape expands too far during implementation, fall back to Option B for the correctness patch and record the DB-derived cleanup as a follow-up task.

## Tests to add/update

1. Protected list, `resourceScope: "tenant-root"`
   - child-scoped grant must not list tenant-root-override documents
   - root-scoped grant must list them

2. Protected list, `resourceScope: "none"`
   - explicit bottom grant must list bottom-target documents
   - root/ancestor grant that reaches bottom through closure must also list them

3. Existing auth capability tests remain unchanged where they assert the current bottom-target semantics are intentional.

4. Spec updates
   - replace nullable RBAC signature examples
   - replace stale null-document example

## Risks

- The fix touches auth-sensitive list filtering. Any mismatch between repository filtering and mutation authorization will create confusing read/write asymmetry.
- If Option A is chosen, care is needed to avoid introducing a second source of truth for permission identity.
- Tests must cover both over-authorization and under-authorization; a single “happy path” assertion will miss one side.
