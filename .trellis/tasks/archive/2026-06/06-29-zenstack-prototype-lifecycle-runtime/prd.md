# make zenstack prototype runtime and tests reflect app data lifecycle

## Goal

Reshape the ZenStack relational-redesign prototype runtime and tests so they exercise data access and document lifecycle patterns closer to the intended platform/domain model, rather than primarily asserting policy behavior over pre-seeded static fixtures.

## What I already know

* Source of truth for domain direction is `CONTEXT.md` and `docs/zenstack-relational-redesign-grilling.md`.
* Existing legacy `server/` code is reference/example only and may lag the target domain model.
* Current prototype runtime (`server/zenstack/prototype-relational-redesign/runtime.ts`) is largely seed-oriented.
* Current prototype tests (`test/unit/server/zenstack/prototype-relational-redesign.test.ts`) are heavily fixture/ACL-oriented and only weakly reflect real collection/document lifecycle flows.
* The prototype already models core framework-owned surfaces: actor context, memberships, app/catalog metadata, scope tree, RBAC definitions, managed `DocumentBase` subtypes, and unmanaged support tables.

## Repo Findings

* Current prototype runtime is built around one bulk seeding function (`seedPrototypeState`) that pre-creates identities, memberships, sessions, catalog rows, scopes, permissions, role assignments, managed documents, and support rows.
* Current prototype tests mostly assert seeded graph shape and direct policy results (`findUnique`, `create`, `update`) rather than exercising higher-level lifecycle flows.
* Reference app behavior in `test/unit/server/service.test.ts` is lifecycle-oriented: create, list, update, patch, soft-delete, restore, hard-delete, batch create/update, tenant isolation, and remote failure ordering.
* Reference app setup in `test/unit/server/fixtures/service.ts` establishes tenant app enablement and registry sync before ordinary document operations; runtime collection access is not treated as a raw pre-seeded static world.
* Reference remote-backed semantics are explicit: ordinary reads stay local, sync is explicit, remote-backed writes are remote-first, and local projection changes only after successful remote execution.
* The prototype currently proves policy mechanics better than usage shape.
* It does not yet model the expected progression from actor/session context → tenant/app availability → collection-surface operation → managed row lifecycle transition.
* It also does not yet separate bootstrap/setup concerns from ordinary operational flows inside the runtime/test harness.

## Assumptions (temporary)

* This is a complex planning task and will need `design.md` and `implement.md` before activation.
* The refreshed prototype should stay grounded in the settled ZenStack-first relational redesign, not in current legacy service boundaries.
* The runtime/test redesign should favor realistic platform lifecycle flows over synthetic seed-only assertions.

## Open Questions

* None. Scope decision recorded: this task will pursue the service-shaped local lifecycle refresh and will not add a full remote-backed projection flow.

## Decision (ADR-lite)

**Context**: The prototype runtime/tests need to become more representative of the intended platform lifecycle without overcommitting the design to a speculative remote-adapter prototype.

**Decision**: Refresh the prototype around service-shaped local lifecycle flows first: actor/session setup, tenant app enablement, managed collection operations, lifecycle transitions, and scope-aware reads.

**Consequences**: The prototype will get closer to the real platform usage shape while staying grounded in the existing local `DocumentBase` validation surface. Full remote-backed projection behavior stays out of scope for this task unless revisited later.

## Requirements (evolving)

* Prototype runtime and tests should better reflect intended platform data access patterns and document lifecycle.
* Source-of-truth terminology and model shape should come from `CONTEXT.md` and `docs/zenstack-relational-redesign-grilling.md`.
* Existing `server/` code may inform examples/patterns but must not override the domain source of truth.
* The refresh should target service-shaped local lifecycle flows, not a full remote-backed prototype flow.

## Acceptance Criteria (evolving)

* [ ] Runtime and tests are redesigned around realistic lifecycle/data-access flows rather than primarily static seeded ACL checks.
* [ ] Prototype behavior and naming remain aligned with `CONTEXT.md` and `docs/zenstack-relational-redesign-grilling.md`.
* [ ] Runtime structure separates environment setup, bootstrap/setup state, and operational helper flows.
* [ ] Tests demonstrate actor setup, tenant app enablement, managed-row lifecycle transitions, scope-aware reads, and collection/app identity boundaries.
* [ ] Planning artifacts define the scope and validation commands before implementation starts.

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* Rewriting the main app with ZenStack in this task.
* Treating current legacy `server/` code as the authoritative domain model.
* Adding a full remote-backed projection flow to the prototype in this task.

## Technical Notes

* Current prototype runtime: `server/zenstack/prototype-relational-redesign/runtime.ts`
* Current prototype tests: `test/unit/server/zenstack/prototype-relational-redesign.test.ts`
* Domain source of truth: `CONTEXT.md`, `docs/zenstack-relational-redesign-grilling.md`
* Current notes/prototype findings: `server/zenstack/prototype-relational-redesign/NOTES.md`
