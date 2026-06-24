# ZenStack Relational Pivot — Option Matrix and Handoff

## Purpose

Compare three architecture directions:

- **A. Current JSONB/document core**
- **B. ZenStack-first relational core**
- **C. Hybrid transitional model**

Also preserve the current domain-modeling discussion so the next session can focus on one question:

> What should a "collection" mean in a ZenStack-first relational redesign?

---

## Current Pressure

The current `documents` JSONB model buys a uniform storage abstraction, but it creates increasing friction:

- custom query/filter/sort API has to be designed and maintained
- JSONB querying is awkward compared with typed relational models
- custom business queries lose Kysely autocomplete and strong table/column typing
- richer reads push more complexity into framework-specific query semantics
- the current collection registration model is good for uniformity, but weaker for relational DX

ZenStack v3 is attractive because it offers:

- schema-first typed relational models
- Kysely-backed query builders
- policy enforcement over ORM and query-builder queries
- much better DX for custom handlers and complex queries

The cost is that it wants **ZModel** as the schema/policy source of truth.

---

## Option Matrix

## A. Keep current JSONB/document core

### Shape

- keep `documents` as the primary business-data substrate
- keep code-defined collection registration as primary definition mechanism
- keep current custom document query API direction
- keep remote-backed collections as local document projections

### Strengths

- preserves current architecture and most implemented code
- collection model stays uniform and simple
- remote-backed projection model fits naturally
- no second schema language
- current RBAC/document metadata model already aligns to it

### Weaknesses

- query DX remains weaker than typed relational models
- JSONB filtering/sorting/query composition stays framework-specific
- custom action authors still need to work around document-table awkwardness
- richer relational reporting/joining remains a long-term pain point

### Best if

- remote-backed projection remains the dominant use case
- uniformity matters more than query ergonomics
- the team wants to avoid a platform reset

---

## B. ZenStack-first relational core

### Shape

- ZModel becomes the primary schema language
- ZenStack generates typed relational/Kysely access surface
- framework injects or ships platform-owned models for:
  - users
  - memberships
  - sessions
  - auth scopes / closure
  - roles / assignments / permissions
  - admin/system app concepts
- framework provides TypeScript helpers for action handlers on top of ZenStack/Kysely
- current JSONB `documents` table stops being the core business-data substrate

### Strengths

- best DX for custom handlers and advanced queries
- full Kysely autocomplete over typed tables
- no need to design and maintain a bespoke JSONB query abstraction as the main path
- clearer path for richer relational reporting and joins
- better alignment with schema-first admin/backend workflows

### Weaknesses

- requires redefining core primitives around ZModel
- code-defined collection registration can no longer remain the primary schema source
- current document-table assumptions become legacy or transitional
- remote-backed collection model must be redesigned around local relational projection tables
- ZenStack policy language may not cleanly express all current RBAC semantics without framework-layer adaptation
- larger architectural reset than a normal refactor

### Best if

- typed relational DX is now more important than document-uniform storage
- end-user developers are expected to write substantial custom queries/actions
- the framework is willing to move from code-first collection definition to schema-first app modeling

---

## C. Hybrid transitional model

### Shape

- keep current platform/domain concepts
- allow both:
  - document-backed collections
  - relational/ZenStack-backed collections
- framework surface tries to hide storage differences where practical
- remote-backed collections can remain document/projection-backed initially
- new relational-first business domains can adopt ZenStack incrementally

### Strengths

- lower migration risk than a full reset
- lets the team test ZenStack on selected domains first
- preserves current investment in document-backed flows
- gives a path to compare real DX before total commitment

### Weaknesses

- two storage models, two mental models
- higher framework complexity
- source-of-truth problems if collection definitions and ZModel overlap unclearly
- risk of split-brain architecture if boundaries are not very strict

### Best if

- the team wants to experiment before committing
- current code must keep shipping while the new model is explored
- remote-backed document projections still matter in the short term

---

## Recommendation

If the goal is to preserve the current product with minimum upheaval, choose **A**.

If the goal is to optimize for future developer experience around typed relational queries and custom handlers, **B** is the more coherent long-term architecture.

If uncertainty is still high and the team wants an incremental path, **C** is viable but only if the source-of-truth split is tightly controlled.

Current leaning from discussion:

- the JSONB/document core is becoming less attractive
- the relational ZenStack-first direction is attractive enough to justify rethinking current UX/DX
- the main remaining design problem is no longer “whether ZenStack is interesting”, but **what core framework concepts survive and how they map onto ZModel-first modeling**

---

## What Survives Even In A ZenStack Pivot

These domain concepts still look valid above the storage/modeling layer:

- tenant
- app
- collection
- capability / permission
- role / assignment
- auth scope
- session / actor / membership
- platform-owned vs end-user apps
- admin app vs system app
- control plane vs operational plane
- document-level / collection-level / app-level actions

What changes is mainly:

- schema source of truth
- persistence shape
- query surface
- how a collection is realized in storage

---

## What Must Change In A ZenStack-First Redesign

If option B is chosen, these assumptions likely change:

### 1. Source of truth

- move from code-defined collection schema to **ZModel-first schema definition**
- TS helpers become secondary adapters, not primary collection schema declarations

### 2. Collection realization

- collection can no longer simply mean “bucket inside the generic `documents` table`
- needs a new definition in a relational world

### 3. Remote-backed collections

- local projection likely becomes one or more ordinary relational tables
- sync/write hooks must populate relational projections instead of generic document rows

### 4. Query path

- primary query experience becomes generated ZenStack/Kysely client
- custom action handlers operate over typed query builders, not a custom document query API

### 5. Policy/enforcement layering

- decide how much to rely on ZenStack policy language vs framework RBAC layer
- avoid duplicate or drifting policy sources

---

## Handoff For The Next Session

The next session should **not** re-argue JSONB vs relational from scratch.

Assume the serious candidate is:

- **ZenStack-first relational redesign**
- schema-first app modeling
- generated typed query builder surface
- framework preserved as auth/action/admin layer above it

The key design question to grill next:

# What should a "collection" mean in a ZenStack-first relational redesign?

Possible directions to compare:

## Model 1 — One ZModel model = one collection

### Pros
- simplest mental model
- easy mapping from schema to app admin surface
- easiest for codegen/introspection

### Cons
- weak fit for multi-table business modules
- may force fake collection boundaries around support tables

## Model 2 — One primary ZModel model + optional supporting tables = one collection

### Pros
- preserves a strong collection abstraction
- allows normalized relational support tables underneath
- likely best match for current collection vocabulary

### Cons
- needs explicit declaration of “primary model” and support model boundaries
- more framework conventions required

## Model 3 — Collection as pure framework grouping over multiple models

### Pros
- flexible for complex domains
- fits richer app modules

### Cons
- risks making collection too vague
- harder CRUD/action/introspection semantics
- weaker default DX for admin generation

### Current recommendation for next grilling

Start from **Model 2** as the strongest candidate.

Reason:
- it preserves the current collection concept better than Model 1 or 3
- it gives relational freedom without dissolving the collection abstraction entirely
- it still allows a primary subject for CRUD, auth defaults, and admin surface generation

---

## Other Open Questions For A ZenStack-First Pivot

Only revisit these after the collection question is settled:

1. How should remote-backed collections materialize local relational projections?
2. How should framework-owned models be merged with user-authored ZModel?
3. How much policy logic belongs in ZenStack policies vs framework RBAC evaluation?
4. How should collection/action/app metadata be expressed if ZModel is primary?
5. What generation pipeline should produce handler helpers and typed action contexts?

---

## Suggested Next Step

Use this document plus `CONTEXT.md` as the handoff base.

Then run a focused design/grilling session on exactly one question:

> In a ZenStack-first relational redesign, what is the collection abstraction and how does it map onto one or more ZModel models?
