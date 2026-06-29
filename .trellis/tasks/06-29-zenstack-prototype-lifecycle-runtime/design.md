# Design — lifecycle-reflective ZenStack prototype runtime/tests

## Problem

The current prototype proves that the ZenStack-first `DocumentBase` policy shape can run, but it does so mostly through a bulk-seeded static world plus direct policy assertions. That is weaker than the intended platform story in `CONTEXT.md` and `docs/zenstack-relational-redesign-grilling.md`, where callers move through actor establishment, tenant/app enablement, collection-surface operations, and document lifecycle transitions.

## Domain anchors

Source of truth:
- `CONTEXT.md`
- `docs/zenstack-relational-redesign-grilling.md`

Reference-only examples:
- `server/` implementation
- `test/unit/server/service.test.ts`
- `test/unit/server/fixtures/service.ts`

Important domain consequences:
- actor context, not raw user identity, is the auth root
- tenant app enablement is an access precondition, not just metadata
- managed rows have explicit tenant/scope targeting and a framework-owned lifecycle
- collection-surface operations should feel close to eventual framework CRUD/action APIs
- remote-backed semantics matter, but are adapter behavior above the local relational row model

## Current mismatch

### Runtime today
- one `seedPrototypeState(raw)` builds the entire world up front
- bootstrap/setup data and operational data are mixed together
- no higher-level helper layer models collection/document operations as a workflow

### Tests today
- many assertions read seeded rows directly
- several tests check catalog/auth graph shape rather than operational journeys
- policy is exercised, but mostly as isolated allow/deny checks over pre-existing rows

## Recommended target shape

### Recommendation: service-shaped flow

Keep storage local for now, but restructure runtime/tests around higher-level operations that resemble the intended platform surface:
- actor/session establishment
- tenant app enablement
- collection/document creation through helper operations
- document lifecycle transitions (create, update, soft delete, restore, hard delete)
- scope-aware reads from actor-bound clients
- optional sync/action-shaped seams in runtime, without fully modeling remote-backed adapters yet

Why this over the alternatives:
- closer to real app/platform access patterns than static fixture assertions
- less premature than inventing a remote-adapter prototype contract before the broader redesign is settled
- still lets the prototype validate `DocumentBase` policy and managed-row lifecycle in one place

## Runtime design

Split runtime responsibilities into three layers.

### 1. Environment layer
Responsibility:
- create database
- push schema
- create raw/protected clients

Likely keeps:
- `createPrototypeClients()`
- `pushPrototypeSchema()`

### 2. Bootstrap layer
Responsibility:
- create framework-owned baseline state that is prerequisite infrastructure, not business workflow
- users, credentials, tenant, memberships, actor contexts, sessions
- apps, collections catalog, tenant app enablement
- auth scopes + closure rows
- permission definitions, roles, role assignments

This should become explicit bootstrap/setup helpers rather than one monolithic seed function.

Candidate shape:
- `bootstrapPrototypeIdentity(raw)`
- `bootstrapPrototypeCatalog(raw)`
- `bootstrapPrototypeAuthz(raw)`
- `createPrototypeActors(raw)` or equivalent actor bundle helper

### 3. Operational helper layer
Responsibility:
- create and mutate managed rows using runtime helpers that mirror intended collection/document usage
- helpers should return created entities / ids so tests compose workflows instead of re-querying magic fixture ids everywhere

Candidate shape:
- `createProjectDocument(...)`
- `createLockedDocument(...)`
- `createPartnerProjectDocument(...)`
- `updateProjectStatus(...)`
- `softDeleteDocument(...)`
- `restoreDocument(...)`
- `hardDeleteDocument(...)`
- possibly `listVisibleProjects(...)` or thin query helpers when that improves readability

These helpers are not meant to become the final framework API. They are prototype orchestration helpers that make the tests read like lifecycle journeys.

## Test design

Restructure tests around realistic journeys.

### Keep
- one or two low-level invariant tests for catalog/discriminator alignment and auth graph sanity
- focused policy regression around exact capability key alignment / bottom-scope semantics

### Shift toward lifecycle tests

#### Actor/control-plane setup
- actor context can be established from membership/session bootstrap
- actor-bound client sees only enabled-app / authorized collection rows

#### Managed collection lifecycle
- create a managed row through an actor-bound path
- update it
- soft-delete it
- confirm ordinary reads hide it
- restore it
- hard-delete it

#### Scope targeting
- create rows at explicit scopes through actor-bound operations
- verify ancestor-vs-bottom behavior through reads and writes

#### Collection/app boundary
- operations for `default:projects` do not bleed into `partner:projects`
- collection identity and capability identity stay aligned through actual operations, not just seed inspection

#### Support-model coexistence
- unmanaged support rows (e.g. revisions) are created/queried as consequences of document activity or linked support data, not only as static seed facts

## Test data strategy

Prefer:
- minimal bootstrap baseline shared by the suite
- per-test operational setup via helpers
- avoid a giant world where every test depends on every seeded row

This should reduce accidental coupling and make each test describe one lifecycle slice.

## Out of scope for this task

- rewriting the main app to ZenStack
- proving full remote-backed adapter semantics in this prototype unless explicitly approved later
- replacing all low-level assertions with only high-level journey tests

## Risks

### Risk: overfitting helpers to current prototype
Mitigation:
- keep helpers small and obviously test-oriented
- avoid inventing broad abstraction layers

### Risk: mixing bootstrap and operation logic again
Mitigation:
- separate bootstrap helpers from operational helpers structurally

### Risk: drifting back toward legacy service contracts as source of truth
Mitigation:
- keep naming/semantics anchored to `CONTEXT.md` and grilling notes
- use legacy service tests only as examples of lifecycle coverage categories

## Validation plan

The refreshed prototype should still pass:
- `bun run prototype:zenstack-relational-redesign`

And tests should clearly demonstrate:
- actor/context setup
- tenant app enablement precondition
- managed-row lifecycle transitions
- scope-aware visibility rules
- collection/app identity boundaries
