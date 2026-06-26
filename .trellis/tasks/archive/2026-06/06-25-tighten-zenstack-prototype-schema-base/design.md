# Design — tighten zenstack prototype schema base

## Problem

The prototype currently proves the broad direction, but it does so with a deliberately simplified auth model and grant shape. That leaves a gap between what passed in code and what the grilling notes actually want to standardize.

## Decision

Use the prototype to step materially closer to the draft relational sketch.

This tightening should touch three areas together:

1. **Auth context model**
   - Replace thin `Actor` auth with a more faithful `User` / `Tenant` / `Membership` / `ActorContext` shape.
   - Make `auth()` represent actor context, not a free-floating actor row.

2. **Grant / scope model**
   - Move away from the current direct `effectiveScopeId` shortcut as the main conceptual model.
   - Prefer grant rows centered on `(actorContext, capabilityKey, grantScopeId)`.
   - Keep descendant matching in `AuthScopeClosure` and express policy through closure traversal.

3. **Managed collection base contract**
   - Keep `DocumentBase` limited to truly shared managed-row concerns: canonical id, tenant targeting, auth-scope targeting, global collection discriminator.
   - Keep catalog/app ownership in metadata models, not on the base row.

## Target schema shape

### Auth side

Add/reshape toward:

- `User`
- `Tenant`
- `Membership`
- `ActorContext`
- `AuthScope`
- `AuthScopeClosure`
- `DerivedCapabilityGrant`

`ActorContext` should be the `@@auth` model/type target for runtime binding.

### Catalog side

Tighten toward:

- `App`
- `CollectionCatalog` (or renamed `Collection` if clearer)

Need to preserve:

- app-local `collectionKey`
- global `qualifiedCollectionKey`
- app ownership on catalog metadata only

### Managed base

`DocumentBase` should keep:

- `documentId`
- `tenantId`
- `authScopeId`
- `qualifiedCollectionKey`

Likely remove from the base row:

- bare `collectionKey` if it only duplicates catalog metadata and weakens the contract

## Policy direction

Base rule should aim closer to the settled wording:

- same tenant as actor context
- relevant capability on a derived grant row
- grant scope reaches row `authScopeId` through closure

This likely means expressing policy through relations rather than the current direct `effectiveScopeId == this.authScopeId` shortcut.

## Verification strategy

Keep one focused prototype spec, but expand seeded state as needed:

- one actor context with tenant membership
- one granted ancestor scope
- one descendant row scope that should pass
- one outside scope or tenant row that should fail
- one locked subtype row that proves tightening
- catalog rows proving metadata/discriminator separation

## Risks

- ZenStack policy traversal may become verbose or hit practical ergonomics limits.
- Create/update policy behavior may shift once auth and grants become more relational.
- The more faithful model may prove one of the settled assumptions awkward; if so, record that rather than simplifying it away silently.

## Success bar

The prototype still runs in one Bun command, but the schema now resembles the real target strongly enough that the next design conversation can talk about concrete tradeoffs, not prototype shortcuts.
