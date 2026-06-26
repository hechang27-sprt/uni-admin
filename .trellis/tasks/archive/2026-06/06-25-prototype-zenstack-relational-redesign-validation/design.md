# Design — prototype zenstack relational redesign validation

## Problem

The redesign notes are intentionally bold, but they are still hypothesis-level. The highest-risk assumptions are about real ZenStack behavior: delegate polymorphism, inherited policies, `auth()` shape, and whether scope/capability checks remain readable enough when modeled relationally.

## Decision

Build a throwaway server-adjacent prototype around a real ZenStack v3 schema, implemented inside the current Nuxt scaffold and verified through a focused Vitest harness.

Prototype location: `server/zenstack/prototype-relational-redesign/`.

This is safe because:

- it stays near the future server-side relational work;
- it is visibly non-production;
- it does not disturb current Kysely/document service paths;
- it validates the riskiest assumptions with actual ZenStack compilation/runtime instead of a hand-rolled imitation.

## Question Being Answered

Can the proposed `DocumentBase` architecture be expressed and exercised cleanly enough in ZenStack v3 to justify continuing the redesign direction?

More specifically:

1. Does `DocumentBase` + `@@delegate` + `@@delegateMap` work for managed collection subtypes?
2. Can baseline access rules be expressed from tenant + `authScopeId` + `(actor, capability, grantScope)` + shared closure?
3. Can a subtype add a stricter rule without replacing the baseline contract?
4. Does `qualifiedCollectionKey` work cleanly as the global discriminator while catalog rows preserve app-local `collectionKey`?

## Prototype Shape

### Runtime

- TypeScript prototype.
- Real ZenStack schema (`schema.zmodel`).
- Scratch SQLite database under the prototype directory, wiped/recreated by the runner/test bootstrap.
- One `package.json` script drives code generation plus the focused Vitest prototype spec.

### Files

- `server/zenstack/prototype-relational-redesign/README.md` — question, run command, throwaway notice.
- `server/zenstack/prototype-relational-redesign/NOTES.md` — durable verdict/handoff.
- `server/zenstack/prototype-relational-redesign/schema.zmodel` — minimal schema under test.
- `server/zenstack/prototype-relational-redesign/scenarios.ts` — portable scenario definitions and expected observations.
- `server/zenstack/prototype-relational-redesign/runtime.ts` — ZenStack client/bootstrap helpers against the scratch DB.
- `test/unit/server/zenstack-relational-redesign.prototype.test.ts` — focused Vitest scenario harness that exercises and reports the validation cases.
- `server/zenstack/prototype-relational-redesign/generated/` — generated ZenStack output.

## Schema Scope

Only the minimum needed to validate the architectural claims:

- `App`
- `Collection`
- `User`
- `Tenant`
- `Membership`
- `ActorContext`
- `AuthScope`
- `AuthScopeClosure`
- `DerivedCapabilityGrant`
- `DocumentBase`
- `Post extends DocumentBase`
- `RestrictedPost extends DocumentBase`
- optional tiny support model only if required for policy expression clarity

The schema should use:

- `qualifiedCollectionKey` as the delegate discriminator on `DocumentBase`.
- `@@delegateMap("blog:post")` / `@@delegateMap("blog:restricted-post")` for concrete managed subtypes.
- an `Auth` type marked `@@auth`, bound from the current actor context.
- the policy plugin so `@@allow` / `@@deny` are enforced by runtime queries.

## Policy Shape

### Base contract on `DocumentBase`

The prototype should encode a baseline rule equivalent to:

- same tenant as the actor context;
- at least one derived grant row for the current actor context and capability key;
- grant scope reaches the row `authScopeId` through `AuthScopeClosure`.

The capability key can be row-local in the prototype for simplicity, e.g. `readCapabilityKey` / `updateCapabilityKey`, instead of generating a complete CRUD catalog. That still validates the join shape and discriminator/catalog identity.

### Stricter subtype rule

`RestrictedPost` should add an extra rule such as "only the owning user can update even if the base capability/scope grant exists". That proves tightening is composable.

## Scenario Model

The prototype should keep a small pure scenario definition layer that the Vitest harness drives:

- scenario id
- actor context
- target operation
- seeded row/grant state
- expected observation set

The runtime actions remain small and explicit:

- reset prototype database
- run baseline read scenario
- run scope-descendant allow/deny comparison
- run stricter subtype update comparison
- inspect catalog/discriminator metadata
- run the full scenario suite under Vitest

## Verification Strategy

Use the existing unit-test scaffold instead of a standalone TUI:

- each scenario seeds explicit state and prints/attaches the relevant observation payload on failure;
- the focused prototype spec becomes the one-command runner;
- agent verification runs the same focused Vitest command before yielding.

## Tradeoffs

### Why SQLite instead of PostgreSQL

Prototype speed and one-command startup beat exact database parity here. The question is ZenStack schema/policy/delegate viability, not Postgres-specific indexing or SQL tuning.

### Why real ZenStack instead of a fake reducer only

The dangerous unknown is framework behavior, not just conceptual state transitions. A fake reducer would miss compile/runtime failures around `@@delegate`, `auth()`, or policy expressions.

### Why use the existing Vitest scaffold anyway

The user explicitly wants this under the current Nuxt scaffold. A focused prototype spec still keeps the work throwaway, while making verification cheaper and more idiomatic for this repo.

## Risks

- ZenStack may reject or awkwardly constrain policy expressions that look fine on paper.
- `@@delegate` inheritance plus policies may not compose the way the redesign expects.
- CLI/runtime setup may require generated artifacts or plugin wiring that influences the final framework pipeline.

Those are acceptable prototype outcomes; a failure is still a useful answer.
