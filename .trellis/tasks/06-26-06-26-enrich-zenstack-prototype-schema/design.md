# Design — Enrich ZenStack prototype schema toward full framework data model

## Problem

The current ZenStack prototype proved the viability of `DocumentBase` delegation and actor-context policy, but it is still too thin to stress the actual framework data model. It lacks most of the framework-owned relational surface present in the baseline migrations and therefore does not yet test whether the redesign can stay coherent once catalog, enablement, permissions, role assignment, sessions, lifecycle metadata, and remote identity are present together.

## Decision

Keep the prototype aligned to the settled redesign, but widen the schema around it.

Core decisions:

1. **Use Postgres-native identity/lifecycle types.**
   - UUID-backed identifiers become `String @db.Uuid`.
   - Lifecycle timestamps use `DateTime @db.Timestamptz(6)` with `@default(now())` / `@updatedAt` where relevant.
   - Integer version columns stay integer scalars.

2. **Model the richer framework-owned surface explicitly in ZModel.**
   Add representative models for:
   - catalog: `App`, `TenantApp`, `Collection`
   - auth identity: `User`, `UserPasswordCredential`, `Membership`, `AuthSession`
   - scope tree: `AuthScope`, `AuthScopeClosure`
   - RBAC definitions: `Permission`, `Role`, `RolePermission`, `RoleAssignment`
   - effective-access surface: `DerivedCapabilityGrant`, plus selective helper rows only where needed for ZenStack policy ergonomics
   - managed documents: `DocumentBase` + concrete managed subtypes
   - unmanaged support table(s) to preserve the managed/unmanaged boundary.

3. **Keep app ownership in catalog metadata, not on managed rows.**
   `DocumentBase` continues to store only tenant/scope/identity/lifecycle/remote metadata plus the qualified collection discriminator. App ownership remains derivable from `Collection` metadata keyed by `qualifiedCollectionKey`.

4. **Keep `DocumentBase` as the only automatic managed-collection contract.**
   Managed collections are concrete subtypes extending `DocumentBase`; support tables stay ordinary models. This preserves the redesign’s explicit semantic boundary.

5. **Preserve a shallow policy surface for managed CRUD.**
   The base policy should continue to read as:
   - actor context belongs to the same tenant,
   - actor has the relevant capability,
   - actor’s reachable scopes include the row’s `authScopeId`.

   For create, the policy must only rely on fields and owned relations that exist on the created row. `tenantId`, `authScopeId`, and the managed collection discriminator stay directly on `DocumentBase`, which keeps create-time authorization shape viable.

6. **Remove the reachable-scope helper table; traverse `AuthScopeClosure` directly from grants.**
   The `AuthScopeClosure` table is already a denormalized form of the scope tree — a closure table trades write amplification for fast ancestor/descendant checks. Adding a separate reachable-scope materialization per grant would multiply that denormalization by capability × grant.
   Policy for read/update/create traverses:
   ```
   auth().capabilityGrants?[
     capabilityKey == 'document:read' &&
     grantScope.closureAsAncestor?[descendantId == this.authScopeId]
   ]
   ```
   For create rules, the key constraint is that only owned relations (FKs on the created model) are accessible. `tenantId`, `authScopeId`, and `qualifiedCollectionKey` are all scalar fields on `DocumentBase` — no non-owned relation traversal needed. The `auth()` function and its grant traversals are not relations on `DocumentBase`, so they remain accessible.
   If this deeper nested traversal proves problematic under ZenStack's generated queries, this decision can be revisited. The prior prototype found direct closure traversal awkward, but that was before adopting the current closure-table shape. We will validate during implementation.
7. **Stay source-informed when notes and source diverge.**
   The prototype should reflect current real framework semantics where doing so sharpens the redesign:
   - sessions remain login continuity + optional tenant selection, not permission snapshots,
   - permissions are persisted policy-bearing capability definitions,
   - app enablement is the tenant precondition for an app's collection surface,
   - remote identity is metadata on managed documents, not replacement identity.

## Planned schema shape

### Catalog / enablement

- `App`
  - UUID id, stable `key`, descriptive `name`, optional JSON config, timestamps
- `TenantApp`
  - composite `(tenantId, appId)` enablement row with optional config and `enabledAt`
- `Collection`
  - UUID id
  - FK to `App`
  - app-scoped `collectionKey`
  - globally unique `qualifiedCollectionKey`
  - `definitionKey`, descriptive `name`, schema version, optional config, timestamps

### Identity / membership / session

- `User`
  - UUID id, display name, status, timestamps
- `UserPasswordCredential`
  - one-to-one by `userId`, `username`, `passwordHash`, timestamps
- `Membership`
  - tenant/user composite uniqueness, status, timestamps
- `ActorContext`
  - real actor row bound to user + tenant + membership
- `AuthSession`
  - token hash primary key, FK to user, optional selected tenant, lifecycle timestamps
  - preserves the domain rule that session continuity and tenant selection live here, not effective permissions

### Scope / RBAC definitions

- `AuthScope`
  - UUID id, tenant FK, optional parent FK, type/key/name, timestamps
- `AuthScopeClosure`
  - tenant-scoped ancestor/descendant/depth relation
- `Permission`
  - canonical key PK, optional app / collection ownership, capability id, source, description, resource scope, timestamps
- `Role`
  - UUID id, tenant FK, app FK [INFERENCE] recommended to better match current domain direction in `CONTEXT.md` even though current baseline migration is tenant-only
- `RolePermission`
  - role-permission join scoped to tenant
- `RoleAssignment`
  - UUID id, tenant/user/role/scope grant row with timestamps

### Effective access surface

One derived table, no closure materialization beyond `AuthScopeClosure`:

- `DerivedCapabilityGrant` stores `(actorContextId, tenantId, capabilityKey, grantScopeId)`
- Closure descendant matching is done at policy evaluation time via `grantScope.closureAsAncestor?[descendantId == this.authScopeId]`
- Target-scope-side relations on `AuthScope` (`closureAsDescendant`) remain available for reverse traversals

`AuthScopeClosure` is already a denormalized closure table. Adding a separate reachable-scope materialization per grant would multiply that denormalization by capability × actor × grant, which is the kind of storage multiplier the redesign exists to avoid.

**Risk acknowledged:** direct closure traversal in policy was flagged as awkward by the prior prototype. That finding was based on a different traversal shape. This task will validate that the current traversal shape works with generation + runtime testing.

### Managed documents

`DocumentBase` gains representative framework-owned metadata from the real document model while staying redesign-aligned:

- `documentId` UUID PK
- `tenantId`
- `authScopeId`
- `qualifiedCollectionKey` discriminator
- `version`
- `createdAt`
- `updatedAt`
- `deletedAt?`
- `remoteSource?`
- `remoteId?`

Relations:
- to `Tenant`
- to `AuthScope`
- to `Collection` via `qualifiedCollectionKey`

Policy:
- base read/update/create policy references actor context tenant and capability access against row scope
- concrete models may tighten only

Concrete managed models remain simple, e.g. `ProjectDocument`, `LockedDocument`.

### Unmanaged support tables

Keep at least one ordinary support model related to a managed collection, e.g. `ProjectRevision`, to preserve the redesign’s managed/unmanaged split while exercising richer schema fidelity.

## Tradeoffs

### Why not copy the baseline migration 1:1?

Because the redesign intentionally changes the architecture:
- explicit `DocumentBase` polymorphism instead of one JSONB `documents` table,
- actor-context-rooted auth surface for ZenStack policy,
- catalog/discriminator usage tuned for model-per-collection semantics.

A 1:1 copy would test the old storage model, not the redesign.

### Why remove the reachable-scope helper table?

Because `AuthScopeClosure` is already a denormalized form of the scope tree. Adding per-grant descendant materialization multiplies that denormalization across every `(actorContext, capability, grantScope)` triple — a quadratic storage multiplier for capability × actor × scope. The closure table already serves the descendant-lookup purpose; the policy just needs to traverse it correctly.

The prior prototype observed that direct closure traversal was "awkward," but that was before the current closure-table shape. This task proceeds with closure-only traversal and validates it against the real ZenStack runtime.

### Why include sessions now?

Because `CONTEXT.md` and `002-auth-sessions.ts` make session semantics explicit, and the redesign needs to prove that sessions can coexist with actor-context-based authorization without turning sessions into permission snapshots.

## Risks

1. **ZenStack policy limitations on create**
   - create rules can only access owned relations on the created model.
   - mitigation: `tenantId`, `authScopeId`, `qualifiedCollectionKey` are scalar fields on `DocumentBase`; grant traversal is through `auth()`, not through non-owned `DocumentBase` relations.

2. **Policy traversal / aliasing complexity**
   - removing reachability materialization means policy traverses `grantScope.closureAsAncestor?[...]`, a three-hop nested filter.
   - mitigation: if generation or runtime fails, the reachable-scope helper table can be restored as a targeted insert. The design choice is correct conceptually; the fallback is only for empirical shape bugs.

3. **Prototype sprawl**
   - adding every baseline detail could make the prototype harder to reason about.
   - mitigation: include representative fields/constraints, not every production nuance.

4. **Identity cutover pressure**
   - existing test/runtime seeds use non-UUID string literals.
   - mitigation: convert prototype ids to real UUID constants in one pass and update all seeds/tests together.

## Validation plan

- Generate ZenStack client from the enriched schema.
- Exercise the focused prototype scenario with richer seed data.
- Extend the focused test to assert:
  - catalog metadata still lines up with managed discriminator identity,
  - sessions and credentials can be seeded consistently,
  - managed documents carry lifecycle/remote metadata,
  - actor policy still filters sibling scopes,
  - stricter subtype policy still composes on top,
  - create-path shape remains actor/scope aware.
