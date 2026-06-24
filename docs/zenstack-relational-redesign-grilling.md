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


## Suggested Next Questions

1. How exactly should framework-owned ZModel files be merged/imported/generated with user-authored models?
2. What exact framework-owned tables should back `auth()` actor context, membership, and derived capability-grant access?
3. How should ZenStack policy join derived `(actor, capability, grant_scope)` access with shared auth-scope closure?
4. How should app-to-collection ownership metadata be represented and generated?
5. How should auth-scope closure semantics be remodeled so ZenStack policies stay readable?
6. How should remote-backed collections materialize relational projections in this new model?
