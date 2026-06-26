# Enrich ZenStack prototype schema toward full framework data model

## Goal

Evolve the throwaway ZenStack prototype under `server/zenstack/prototype-relational-redesign/` so it more closely reflects the current framework data model and migration-backed PostgreSQL shape, while preserving the settled ZenStack-first redesign direction: explicit `DocumentBase` managed collections, app/catalog-owned collection identity, actor-context-rooted auth, and base-level RBAC policy over tenant + auth-scope targeting.

## What I already know

- The existing prototype already validates three core redesign bets against real ZenStack runtime behavior: `DocumentBase` delegate inheritance, actor-context-based policy, and catalog/discriminator separation. See `server/zenstack/prototype-relational-redesign/NOTES.md`.
- The current prototype is intentionally simplified: string ids without Postgres native types, a reduced catalog model, and only derived capability grants plus explicit reachable-scope materialization.
- The real codebase migration shape in `server/db/migrations/001-baseline.ts` includes richer framework-owned data than the prototype: apps, tenant app enablement, collections, users, password credentials, tenant memberships, auth scopes with closure + trigger semantics, roles, permissions, role-permission links, user-role assignments, and documents with remote identity, versioning, timestamps, and soft delete.
- `server/db/migrations/002-auth-sessions.ts` adds unlogged `auth_sessions`, tied to `(tenant_id, user_id)` membership eligibility.
- The redesign notes intentionally diverge from the current codebase in some places. The prototype should follow the settled redesign when source and notes conflict, but stay informed by real source contracts and vocabulary.
- The redesign notes already record one important prototype finding: direct closure traversal inside ZenStack policy became awkward in practice, so the prototype materialized reachable-scope rows for policy ergonomics.

## Requirements

- Use actual PostgreSQL-native types in the prototype schema where the framework would use them, especially `@db.Uuid` for UUID identities and timestamptz-compatible `DateTime` fields where relevant.
- Enrich the prototype so the framework-owned relational surface is materially closer to the current migrations, including:
  - app catalog metadata,
  - tenant app enablement,
  - user credentials / status metadata where meaningful,
  - memberships,
  - auth scopes + closure,
  - roles,
  - permissions,
  - role-permission links,
  - role assignments,
  - sessions,
  - managed document metadata for lifecycle / remote projection / optimistic versioning.
- Preserve the redesign’s explicit managed/unmanaged split: platform-managed collections extend `DocumentBase`; auxiliary/support models remain ordinary relational models.
- Keep row-level RBAC policy centered on tenant-bound actor context plus auth-scope targeting, with `DocumentBase` owning the baseline CRUD policy shape.
- Reduce avoidable denormalization relative to the current prototype. In particular, prefer keeping descendant reachability in shared closure data or other reusable framework-owned structures unless ZenStack policy/runtime constraints still justify selective materialization.
- Ensure the schema shape remains compatible with enforcing RBAC for `create`, not only `read` and `update`. That means create-time policy must have direct access to the needed owned fields and relations on the created model.
- Reflect the real framework vocabulary from `CONTEXT.md` where the redesign meaning is settled: tenant, auth scope, capability, permission, role assignment, document, collection, remote identity, session, app enablement.
- Keep this as a prototype, not a production cutover. Favor representative fidelity over exhaustively copying every current table or service behavior.
- Update the prototype runtime seeding and focused tests as needed so the richer schema is exercised end-to-end.

## Constraints

- The prototype lives under `server/zenstack/prototype-relational-redesign/` and `test/unit/server/zenstack/prototype-relational-redesign.test.ts`.
- Validation must use the real ZenStack toolchain already used by the prototype (`zen generate` / `zen db push` path via runtime helper) and focused Vitest coverage.
- The real codebase currently uses document storage and Kysely repositories; this prototype is allowed to diverge structurally when following the redesign, but should stay grounded in the actual framework data model and migration semantics.
- Prior finding from the prototype: deep closure traversal in policy was awkward under ZenStack, so any attempt to remove materialization must be proven by schema generation/tests rather than assumed.

## Acceptance Criteria

- [ ] `prototype.zmodel` uses PostgreSQL-native column annotations for framework-owned UUID/timestamp-style identity and lifecycle fields where appropriate.
- [ ] The prototype schema includes a richer framework-owned catalog/auth/RBAC/session/document surface that is recognizably aligned with `001-baseline.ts`, `002-auth-sessions.ts`, and the redesign direction.
- [ ] Managed collection rows still extend `DocumentBase`, and unmanaged support tables remain separate ordinary models.
- [ ] Baseline managed-row RBAC policy remains enforced through the ZenStack runtime for at least read, update, and create-relevant shape constraints.
- [ ] Focused prototype runtime/test setup is updated to seed and exercise the enriched schema successfully.
- [ ] `bunx zen generate --schema server/zenstack/prototype-relational-redesign/prototype.zmodel --output server/zenstack/prototype-relational-redesign/generated` passes.
- [ ] `bunx vitest run test/unit/server/zenstack/prototype-relational-redesign.test.ts` passes.

## Definition of Done

- Planning artifacts (`prd.md`, `design.md`, `implement.md`) exist and reflect the settled direction.
- Prototype schema, runtime seed data, and focused tests are updated coherently.
- Validation commands above pass.
- Any new durable prototype lesson discovered during implementation is captured back into specs/notes if warranted.

## Out of Scope

- Production migration rewrites under `server/db/migrations/`.
- Full service/repository integration with the existing Kysely document/auth layers.
- Frontend, routes, composables, or generated admin UI.
- Exhaustively implementing every current framework behavior in ZenStack.
- Deciding the final production mechanism for framework/user schema composition beyond what the prototype needs.

## Technical Notes

- Source references:
  - `server/db/migrations/001-baseline.ts`
  - `server/db/migrations/002-auth-sessions.ts`
  - `docs/zenstack-relational-redesign-grilling.md`
  - `CONTEXT.md`
  - `server/zenstack/prototype-relational-redesign/NOTES.md`
- The main design tension is denormalization vs policy ergonomics. The prior prototype notes already showed that fully normalized closure traversal may be awkward in ZenStack policy. This task should re-test that tradeoff rather than assuming either extreme.
- The current prototype uses string primary keys like `user-prototype`; moving to `@db.Uuid` will require seed ids to become actual UUID literals.
