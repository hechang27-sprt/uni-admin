# ZenStack-First Relational Redesign — Grilling Notes

## Purpose

Record the current grilling session so the next session can continue from settled assumptions instead of re-deriving them.

## Current Settled Direction

### 1. Core pivot

The active candidate is a **ZenStack-first relational redesign**.

Assume:

- ZModel is the primary schema source of truth
- ZenStack-generated ORM/query APIs are the primary data access surface
- framework-owned auth, tenant, and RBAC models are merged with user-authored business models
- ZenStack policy is the primary enforcement layer for tenant isolation and RBAC

### 2. Collection meaning

Current leaning:

- **1 collection = 1 ZModel model**

Rejected for now:

- collection as one primary model plus support models
- collection as a loose grouping over multiple models

Reason:

- built-in CRUD becomes direct and unsurprising
- collection-to-model mapping stays simple for codegen, introspection, and admin generation
- relational richness can come from ZenStack relations and `include` / `select` rather than from redefining collection itself

### 3. Custom action model

Current leaning:

- **remove custom document-level / instance-method-style actions**
- keep only namespaced static actions:
  - `app-key:collection-key:action`
  - `app-key:action`

Implication:

- actions that operate on a specific row simply take row ids in input
- collection/app distinction for custom actions is primarily namespace and discovery, not a different execution model

### 4. Built-in CRUD shape

Current leaning:

- built-in CRUD should stay **almost 1:1 with ZenStack ORM API**
- example: collection create maps directly to `db.post.create({...})`
- relational expansion uses ZenStack `include`, `select`, and normal relational query features

This is an intentional simplicity choice for now, even if a narrower framework wrapper may be reconsidered later.

### 5. Canonical record identity

Even with near-raw ZenStack CRUD, each collection should still have:

- **one canonical primary identity** for platform purposes

Other unique selectors may exist, but are secondary conveniences.

Reason:

- stable deep links
- stable row selection semantics
- stable audit / operation-history attachment
- a clean replacement for today's platform `documentId`

### 6. Tenant isolation and actor context

Current leaning:

- tenant scoping must be an **implicit framework invariant**, not a caller-supplied filter
- `auth()` should represent the **current actor context**, not merely the platform user

Concretely, `auth()` should be rooted in:

- authenticated user
- selected tenant / tenant membership
- enough actor-context relations to make policy evaluation natural
Current leaning for concrete shape:

- `auth()` should be rooted in a real actor/session-context row with direct FK links to current user, tenant, and membership


### 7. Framework-owned relational auth surface

The redesign is expected to bake framework-owned relational models/columns into the schema for:

- users
- tenant membership / selection
- tenant isolation
- RBAC grants / permissions / scopes

This is in addition to user-authored business models.

The concern is not whether framework-owned auth data exists, but how it composes cleanly with generated ZModel and ZenStack policy.

Current leaning for injected business-model columns:

- every user-defined business model should receive framework-owned `tenant_id`
- every user-defined business model should receive framework-owned `auth_scope_id`

Reason:

- tenant and auth-scope targeting become first-class columns on every business row
- policy and create-rule checks stay much simpler than deriving these through side relations


### 8. Policy strategy

Working assumption for now:

- **assume ZenStack policy can handle all RBAC rules**
- if policy becomes awkward, prefer **reshaping framework-owned tables** to make policies cleaner

This is an assumption for continued design, not a proven result.


Refined current leaning:

- do **not** start by materializing one row per `(actor_context, capability, effective_descendant_scope)`
- prefer one derived row per `(actor_context, capability, grant_scope)`
- keep descendant matching in the shared auth-scope closure relation instead of duplicating subtree expansion per capability

Reason:

- avoids multiplying closure-derived scope expansion by capability and actor
- keeps denormalization focused on grant resolution, not descendant expansion
- is a better starting point for database size and maintenance cost

### 11. Capability identity

Current leaning:

- capability identity should be derived canonically from stable app/collection metadata
- built-in CRUD capabilities should be framework-generated and fixed per collection, but the exact operation names should stay aligned with the thin ZenStack ORM wrapper rather than be overfit prematurely
- collection static actions should use the form `app-key:collection-key:action-key`
- app actions should use the form `app-key:action-key`


Reason:

- derived capability-grant rows need stable opaque capability keys
- capability identity should not depend on raw model/table names
- admin surfaces, RBAC data, and policy checks should share the same namespace
Additional note:

- do **not** over-commit yet to one exact CRUD verb catalog beyond the requirement that built-in CRUD capability identities are framework-generated and stable
- because the framework is intentionally staying close to ZenStack ORM query/mutation semantics

### 12. Schema composition and generation

Current leaning:

- the framework should own a generated root ZenStack schema entrypoint
- that root schema should compose framework-owned auth/RBAC/base ZModel files, user-authored business model ZModel files, and generated metadata fragments
- users should not be required to hand-wire framework internal schema composition details

Generated metadata fragments may include:

- app-to-collection ownership metadata
- capability catalog metadata
- other framework-owned schema glue needed to keep policy and generation aligned

Reason:

- keeps one authoritative generation pipeline
- gives the framework one place to inject framework-owned columns/relations and metadata
- reduces composition drift between framework internals and user-authored business models




### 13. Default row-level policy shape

Current leaning:

- models/collections/tables are app-owned framework assets, not tenant-owned definitions
- the rows in those tables are tenant-owned business records
- for row-level business access, the default policy shape should compare:
  - row `tenant_id`
  - row `auth_scope_id`
  - actor derived `(capability, grant_scope)` rows
  - shared auth-scope closure from `grant_scope` to row `auth_scope_id`

In words:

- an actor may access a row when it has the relevant capability at an ancestor grant scope whose closure reaches the row's auth scope, within the same tenant

Reason:

- keeps app ownership and tenant data ownership separate
- matches the existing domain model where app definitions are shared while business rows remain tenant-local
- turns injected `tenant_id` and `auth_scope_id` into a standard reusable policy template


### 14. Default generated CRUD policy template

Current leaning:

- framework-generated collection CRUD should start from a standard default policy template rather than requiring each collection to reinvent row-level policy shape
- that default should be based on row `tenant_id`, row `auth_scope_id`, capability identity, derived `(actor, capability, grant_scope)` access, and shared scope closure
- user customization should primarily add stricter rules or explicit overrides when needed

Reason:

- this is a major reason to adopt ZenStack rather than hand-wrapping Kysely authorization repeatedly
- keeps business-model policy consistent across collections
- reduces repeated policy authoring burden for end users
- preserves escape hatches for stricter collection-specific constraints


### 15. Remote-backed collections in the relational redesign

Current leaning:

- a remote-backed collection should still materialize as an ordinary app-owned relational model/table with tenant-owned rows
- remote-backed collections should keep the same core collection model as local collections
- the difference should live in adapter/sync/write behavior above the model, not in a separate collection kind

That means a remote-backed collection should still receive:

- stable collection identity
- app ownership metadata
- injected `tenant_id`
- injected `auth_scope_id`
- default generated ZenStack policy behavior over its local relational rows

Reason:

- preserves the settled `1 collection = 1 model` direction
- avoids reintroducing a split-brain collection abstraction
- keeps auth/admin/query semantics uniform even when remote systems remain authoritative


### 16. Injected framework fields in user-authored models

Current leaning:

- end-user business models should be authored without manually declaring framework-owned multitenancy/auth fields in every model
- the framework should inject those fields during schema generation
- `tenant_id` can stay mostly implicit to user business logic because ordinary business code should already operate entirely within one tenant context
- `auth_scope_id` is different: users may reasonably need to reference scope targeting because higher-scope actors may want to filter or operate across descendant subscopes

Reason:

- tenant isolation should behave as a foundational invariant rather than ordinary business-model authoring burden
- auth-scope remains an important business-facing authorization dimension even when tenant isolation is implicit


### 17. Scope-aware query helpers

Current leaning:

- the framework should expose first-class scope-aware query helpers over injected `auth_scope_id`
- those helpers should cover common cases like exact-scope targeting, scope-with-descendants targeting, and actor-visible subtree targeting
- implementation can live as reusable Kysely expressions/helpers rather than forcing every caller to hand-write closure joins

Reason:

- `auth_scope_id` is a meaningful business-facing authorization dimension, not just hidden infrastructure
- higher-scope actors legitimately need cross-subscope operations
- hand-writing closure joins in user code would recreate the same complexity the ZenStack-first pivot is trying to absorb


### 18. Explicit `DocumentBase` managed-collection contract

Current leaning:

- the platform-managed collection contract should be explicit: only models extending framework-owned `DocumentBase` are managed collections
- `DocumentBase` should carry the shared platform row identity, tenant/scope targeting, collection discriminator, and default policy contract
- `collectionKey` should serve as the ZenStack delegate discriminator because concrete submodels are exactly the managed business collections
- each concrete managed collection should use a stable discriminator value via `@@delegateMap(<collection-key>)`

Current leaning for identity:

- `documentId` should be the shared primary key for `DocumentBase` and all managed concrete submodels
- user-defined domain identifiers may still exist, but as ordinary fields / unique fields rather than replacing the platform primary key

Reason:

- v3 delegate polymorphism assumes shared base/concrete identity values
- the platform benefits from one canonical row identity for audit, actions, policy, remote projection, and admin surfaces
- using collection key as discriminator is coherent because the subtype models are exactly the managed collections


### 19. Base-level default policy ownership

Current leaning:

- the standard generated CRUD access rules should live primarily on `DocumentBase`
- managed concrete submodels should inherit the default tenant/scope/capability policy automatically
- concrete models may add stricter collection-specific rules when needed, but should not need to restate the baseline platform policy contract

Reason:

- best matches the explicit `DocumentBase` managed-collection contract
- keeps default ZenStack policy logic in one place
- reduces per-collection policy duplication further
- makes platform management of a collection materially meaningful at the schema layer


### 20. Composition of collection-specific stricter rules

Current leaning:

- concrete managed submodels may tighten the inherited `DocumentBase` policy contract
- they should not casually weaken or replace the baseline platform tenant/scope/capability guarantees
- collection-specific rules should primarily add stricter business constraints on top of the inherited base policy

Reason:

- preserves the meaning of platform-managed collections
- avoids silent weakening of the shared auth contract
- still leaves domain collections room for stricter business-specific access constraints


### 21. Unmanaged auxiliary relational models

Current leaning:

- models that do not extend `DocumentBase` should be treated as ordinary auxiliary/support relational models
- they may still be queried and used by user business logic
- but they should not automatically become first-class platform collections

That means they do not automatically receive:

- collection identity
- capability generation
- default generated CRUD policy contract
- admin collection surfacing
- remote-backed collection semantics

Reason:

- gives a clean split between platform-managed collections and supporting relational tables
- avoids forcing every support table to pretend to be a collection
- preserves relational freedom under the managed collection layer


### 22. Relations between managed and unmanaged models

Current leaning:

- platform-managed `DocumentBase` collections should be allowed to relate freely to unmanaged auxiliary/support relational models
- only the `DocumentBase` side should participate in collection identity, default CRUD policy generation, admin surfacing, and other first-class platform collection semantics

Reason:

- preserves relational freedom under the managed collection layer
- allows normalized helper/support tables without forcing them into the platform collection model
- keeps the platform boundary semantic rather than relationally isolating managed collections from ordinary support tables


### 23. Collections catalog ownership

Current leaning:

- app ownership should be declared at the managed concrete collection level, not at `DocumentBase`
- there should be a `collections` catalog table with an `appId` foreign key
- managed concrete collection metadata should map stable collection identity to owning app through that catalog

Open design fork:

- whether `collectionKey` remains app-scoped and duplicate across apps, or becomes globally unique in the new `DocumentBase`/delegate-discriminator design

Reason:

- `DocumentBase` is shared platform infrastructure, while app ownership belongs to concrete managed collections
- the collections catalog is now a first-class bridge between app ownership, stable collection identity, and capability generation


### 24. Qualified collection identity and discriminator naming

Current leaning:

- app-local collection keys may remain scoped within an app
- the globally unique technical identity for a managed collection should be the qualified form `app-key:collection-key`
- `DocumentBase` should store that qualified identity as its delegate discriminator
- for naming clarity, the base-model discriminator field should not overload the meaning of a bare local `collectionKey`

Recommended naming split:

- catalog local key: `collectionKey`
- catalog/global discriminator key: `qualifiedCollectionKey`
- `DocumentBase` discriminator field: `qualifiedCollectionKey`

Reason:

- preserves app-local collection naming flexibility
- keeps the ZenStack delegate discriminator globally unique
- avoids forcing bare collection keys to be globally unique
- makes the difference between local collection naming and global technical identity explicit


### 9. Effective-access surface

Current leaning:

- policy should evaluate against a **materialized effective-access surface** where useful, rather than repeatedly traversing raw roles → permissions → scope closure in every business-model rule

Candidate implementation shapes may include:

- derived tables
- closure/materialization tables
- possibly views

Constraint:

- database performance matters
- views are interesting, but currently preview/scantly documented in ZenStack and should be treated carefully
### 10. Collection and app identity

Current leaning:

- collection identity should use a **stable framework collection key** mapped to the model/table name
- collection identity should **not** default to a persisted `collection_id` column on every business row
- app ownership likely belongs in framework metadata tables that map apps to owned collections/models
- business rows should **not** default to a persisted `app_id` unless later semantics require row-local app ownership

Reason:

- with `1 collection = 1 model`, row-local `collection_id` mostly duplicates type identity already implied by the table/model
- capability namespace, admin routing, and metadata still benefit from a stable logical collection key decoupled from raw model/table names
- app ownership looks like collection metadata, not row data, unless one model can belong to multiple apps or ownership varies per row


## Research Notes From This Session

### ZenStack policy traversal

Grounded from ZenStack docs/research:

- policy expressions allow deep to-one traversal via dot access
- policy expressions allow nested to-many collection predicates:
  - `relation?[...]`
  - `relation![...]`
  - `relation^[...]`
- docs explicitly say nested collection predicates can build deep traversals
- no official hard maximum depth was found in docs

Important caveats:

- no documented depth limit does **not** mean unlimited complexity is boring in practice
- deep nested policy/include queries have triggered real alias-generation/query bugs in ZenStack issues
- create-rule relation access is more constrained: create policies can only access owned relations whose FK lives on the model being created

Design consequence:

- deep closure-based RBAC may be syntactically expressible
- but schema shape should still be optimized to keep policies shallow, comprehensible, and performant where possible

## Open Risks

1. **Framework/user schema composition**
   - exact mechanism for merging framework-owned auth/RBAC models with user-authored models still needs design validation

2. **RBAC policy ergonomics**
   - full auth-scope-closure semantics may become verbose or expensive if modeled too indirectly

3. **Create-policy limitations**
   - ZenStack create policies cannot traverse arbitrary non-owned relations, which may force FK placement or denormalization decisions

4. **Performance of effective-access materialization**
   - if policies depend on derived access surfaces, refresh/update strategy and query cost need explicit design

5. **Remote-backed collections**
   - still unresolved in the ZenStack-first world

## Questions Settled In This Session

1. Should collection remain above storage or collapse to ZModel?  
   **Settled:** collapse to **1 collection = 1 ZModel model**.

2. Should custom document-level actions survive?  
   **Settled:** **No**. Keep only static namespaced actions.

3. Should built-in CRUD be strict 1 model / 1 collection?  
   **Settled:** **Yes**.

4. Should CRUD stay close to ZenStack ORM API?  
   **Settled for now:** **Yes**.

5. Should each collection still define one canonical row identity?  
   **Settled:** **Yes**.

6. Should tenant scoping be implicit in actor-bound context rather than caller filters?  
   **Settled:** **Yes**.

7. Should ZenStack policy be assumed capable of carrying the full RBAC model for now?  
   **Settled for current design exploration:** **Yes**.

8. Should `auth()` represent actor context rather than only user identity?  
   **Settled:** **Yes**.

9. Should policy read a cleaner effective-access surface where helpful?  
   **Settled:** **Yes**, with performance sensitivity.
10. Should `auth()` lean toward a real actor/session-context row rather than a thin user-only auth object?
   **Settled direction:** **Yes**.

11. Should every business model receive injected `tenant_id` and `auth_scope_id` columns?
   **Settled:** **Yes**.

12. Should collection identity use a stable framework key mapped to model name rather than the raw model name alone?
   **Settled:** **Yes**.

13. Should the derived access surface store one row per `(actor_context, capability, grant_scope)` rather than per effective descendant scope?
   **Settled:** **Yes**.

14. Should capability identity be canonically derived from app/collection metadata using names like `app-key:collection-key:update` and `app-key:action-key`?
   **Settled:** **Yes**.
15. Should built-in CRUD capability identities be framework-generated and fixed rather than user-redefined per collection?
   **Settled:** **Yes**.
16. Should the framework own a generated root schema that composes framework-owned, user-authored, and generated metadata ZModel fragments into one final ZenStack entrypoint?
   **Settled:** **Yes**.
17. Should the default row-level policy shape use row `tenant_id` + row `auth_scope_id` + derived `(capability, grant_scope)` access joined through shared scope closure, while keeping collections app-owned and rows tenant-owned?
   **Settled:** **Yes**.
18. Should framework-generated collection CRUD start from a standard default policy template, with users mainly extending or tightening it rather than reinventing the policy shape per collection?
   **Settled:** **Yes**.
19. In the ZenStack-first redesign, should a remote-backed collection still materialize as an ordinary app-owned relational model/table with tenant-owned rows, with remote behavior handled by adapters above it?
   **Settled:** **Yes**.
20. Should framework-owned fields like `tenant_id` and `auth_scope_id` be injected into business models during schema generation rather than declared manually by users?
   **Settled:** **Yes**.
21. Should the framework expose first-class scope-aware query helpers over `auth_scope_id`, likely as reusable Kysely expressions/helpers?
   **Settled:** **Yes**.
22. Should user-authored custom policies and query customizations be allowed to reference injected `auth_scope_id` directly as a first-class field, while `tenant_id` remains mostly implicit?
   **Superseded by later `DocumentBase` direction.**

23. Should the platform-managed collection contract become explicit `DocumentBase` inheritance rather than plain-model implicit injection?
   **Settled:** **Yes**.

24. Should `DocumentBase.collectionKey` serve as the ZenStack delegate discriminator for managed collection subtypes?
   **Settled:** **Yes**.

25. Should `DocumentBase.documentId` be the shared primary key for all managed collection subtypes?
   **Settled:** **Yes**.

26. Should the standard generated CRUD access rules live primarily on `DocumentBase`, with managed submodels inheriting them and only adding stricter rules when needed?
   **Settled:** **Yes**.
27. Should concrete managed submodels be allowed to tighten inherited `DocumentBase` policies but not weaken/replace the baseline platform policy wholesale?
   **Settled:** **Yes**.
28. Should models that do not extend `DocumentBase` remain ordinary auxiliary/support relational models rather than first-class platform collections?
   **Settled:** **Yes**.
29. Should platform-managed `DocumentBase` collections be allowed to relate freely to unmanaged auxiliary/support models, with only the `DocumentBase` side participating in platform collection semantics?
   **Settled:** **Yes**.
30. Should app ownership live on concrete managed collections via a `collections` table with an `appId` foreign key rather than at `DocumentBase`?
   **Settled:** **Yes**.
31. Should the base-model discriminator use a globally unique qualified collection identity like `app-key:collection-key`, while keeping a separate local app-scoped `collectionKey` for catalog naming?
   **Settled:** **Yes**.


## Suggested Next Questions

1. How exactly should framework-owned ZModel files be merged/imported/generated with user-authored models?
2. What exact framework-owned tables should back `auth()` actor context, membership, and derived capability-grant access?
3. How should ZenStack policy join derived `(actor, capability, grant_scope)` access with shared auth-scope closure?
4. How should app-to-collection ownership metadata be represented and generated?
5. How should auth-scope closure semantics be remodeled so ZenStack policies stay readable?
6. How should remote-backed collections materialize relational projections in this new model?

## Draft Schema Sketch

The sketch below is a design draft, not a validated final schema. It is intended to make the currently settled direction concrete.

### Catalog and app ownership

```zmodel
model App {
    id          String   @id @default(uuid(4)) @db.Uuid
    key         String   @unique
    name        String
    collections Collection[]
}

model Collection {
    id                   String @id @default(uuid(4)) @db.Uuid
    app                  App    @relation(fields: [appId], references: [id])
    appId                String @db.Uuid

    // app-scoped human/authoring key, e.g. "post"
    collectionKey        String

    // globally unique technical identity, e.g. "blog:post"
    qualifiedCollectionKey String @unique

    name                 String

    @@unique([appId, collectionKey])
}
```

### Auth / actor context

```zmodel
model User {
    id           String       @id @default(uuid(4)) @db.Uuid
    memberships  Membership[]
    actorContexts ActorContext[]
}

model Tenant {
    id           String       @id @default(uuid(4)) @db.Uuid
    memberships  Membership[]
    authScopes   AuthScope[]
}

model Membership {
    id        String @id @default(uuid(4)) @db.Uuid
    user      User   @relation(fields: [userId], references: [id])
    userId    String @db.Uuid
    tenant    Tenant @relation(fields: [tenantId], references: [id])
    tenantId  String @db.Uuid

    actorContexts ActorContext[]

    @@unique([userId, tenantId])
}

model ActorContext {
    id            String      @id @default(uuid(4)) @db.Uuid
    user          User        @relation(fields: [userId], references: [id])
    userId        String      @db.Uuid
    tenant        Tenant      @relation(fields: [tenantId], references: [id])
    tenantId      String      @db.Uuid
    membership    Membership  @relation(fields: [membershipId], references: [id])
    membershipId  String      @db.Uuid

    capabilityGrants DerivedCapabilityGrant[]

    @@unique([userId, tenantId, membershipId])
}

type Auth {
    id           String
    userId       String
    tenantId     String
    membershipId String
    @@auth
}
```

### Scope hierarchy and derived grant surface

```zmodel
model AuthScope {
    id        String @id @default(uuid(4)) @db.Uuid
    tenant    Tenant @relation(fields: [tenantId], references: [id])
    tenantId  String @db.Uuid
}

model AuthScopeClosure {
    ancestorScope   AuthScope @relation("ClosureAncestor", fields: [ancestorScopeId], references: [id])
    ancestorScopeId String    @db.Uuid

    descendantScope   AuthScope @relation("ClosureDescendant", fields: [descendantScopeId], references: [id])
    descendantScopeId String    @db.Uuid

    @@id([ancestorScopeId, descendantScopeId])
}

model DerivedCapabilityGrant {
    id                    String       @id @default(uuid(4)) @db.Uuid
    actorContext          ActorContext @relation(fields: [actorContextId], references: [id])
    actorContextId        String       @db.Uuid

    tenantId              String       @db.Uuid
    capabilityKey         String
    grantScopeId          String       @db.Uuid

    @@index([actorContextId, capabilityKey])
    @@index([grantScopeId])
}
```

### Managed collection base model

```zmodel
model DocumentBase {
    documentId             String   @id @default(uuid(4)) @db.Uuid
    tenantId               String   @db.Uuid
    authScopeId            String   @db.Uuid

    // globally unique discriminator, e.g. "blog:post"
    qualifiedCollectionKey String

    @@delegate(qualifiedCollectionKey)

    // Default generated CRUD policy lives here.
    // Concrete submodels inherit and may only tighten.
}
```

### Example managed collection

```zmodel
model Post extends DocumentBase {
    title   String
    content String?

    @@delegateMap("blog:post")
}
```

### Example auxiliary support model

```zmodel
model PostRevision {
    id        String @id @default(uuid(4)) @db.Uuid
    post      Post   @relation(fields: [postDocumentId], references: [documentId])
    postDocumentId String @db.Uuid
    body      String
}
```

### Policy shape sketch

The default generated `DocumentBase` policy is expected to encode the shared baseline:

- row belongs to the current tenant
- actor has the relevant capability key
- actor's grant scope reaches the row's `authScopeId` via shared scope closure

Concrete managed collections may add stricter rules, but should not weaken this baseline.

### Notes

- This sketch keeps managed collections explicit via `extends DocumentBase`.
- Unmanaged relational models remain ordinary support tables.
- Remote-backed collections are still expected to materialize as ordinary managed collection subtypes, with remote behavior handled above the local relational model.
- `qualifiedCollectionKey` is the globally unique technical identity; bare `collectionKey` remains app-scoped catalog metadata.

## ADR-Style Conclusion

### Status

Provisional architectural direction. Strong enough for prototyping. Not yet validated end-to-end against a real ZenStack v3 schema and policy runtime.

### Decision

Adopt a **ZenStack-first relational architecture** with an explicit **`DocumentBase` polymorphic base model** as the contract for platform-managed collections.

Under this direction:

- a first-class platform collection is a concrete ZModel subtype that extends `DocumentBase`
- unmanaged/support relational tables remain ordinary models that do not extend `DocumentBase`
- `DocumentBase` owns shared platform row identity, tenant targeting, auth-scope targeting, collection discrimination, and baseline generated CRUD policy
- concrete managed collections inherit the base policy and may only tighten it with stricter collection-specific constraints
- app ownership lives in a `collections` catalog table rather than on `DocumentBase`

### Identity model

- `documentId` is the shared primary key for `DocumentBase` and all managed concrete submodels
- local app-scoped collection naming remains available through `collectionKey`
- globally unique technical collection identity is carried by `qualifiedCollectionKey = app-key:collection-key`
- `qualifiedCollectionKey` is the ZenStack delegate discriminator used by `@@delegate(...)`

### Authorization model

- `auth()` represents the current tenant-bound actor context, not merely the platform user
- managed rows carry tenant and auth-scope targeting through the base contract
- default access control is based on actor-derived `(actor_context, capability_key, grant_scope)` rows plus shared auth-scope closure
- baseline CRUD policy should live on `DocumentBase` and be inherited by managed submodels

### Remote-backed model

- remote-backed collections remain ordinary managed collection subtypes
- local relational rows stay the policy/query/admin surface
- remote sync/write differences live in adapter logic above the model, not in a separate collection kind

### Why this direction

This direction was chosen because it best balances:

- explicit platform semantics for managed collections
- strong reuse of ZenStack’s schema, polymorphism, and policy system
- preservation of relational freedom for auxiliary/support tables
- a clean split between platform-managed collections and unmanaged helper models
- a single canonical platform row identity

It also avoids two failure modes:

- making every user table pretend to be a collection
- rebuilding policy, tenant, and scope semantics ad hoc on every model or query path

### Consequences

Positive:

- the managed/unmanaged boundary becomes explicit and inspectable
- default CRUD policy can be centralized in one schema layer
- capability/catalog identity aligns with discriminator identity
- end users keep full freedom to define auxiliary relational tables and joins outside the collection model

Costs:

- the design now depends on ZenStack delegate-polymorphism behavior for inherited policy composition
- `DocumentBase` introduces a real polymorphic base table rather than invisible field injection only
- collection/catalog/auth generation becomes a more opinionated framework pipeline

### Validation required before committing fully

Prototype these first:

1. a minimal ZenStack v3 schema proving `DocumentBase` + `@@delegate` + inherited policy behavior on submodels
2. a tenant/scope/capability rule that joins derived grant rows with shared auth-scope closure
3. a concrete managed subtype that adds stricter rules without weakening the base contract
4. a catalog/discriminator setup proving `qualifiedCollectionKey` cleanly aligns app ownership, collection identity, and capability namespace

### Current recommendation

Proceed with this architecture as the leading design. Do not treat it as final until the four validation prototypes above succeed.
