# prototype zenstack relational redesign validation

## Goal

Build a throwaway logic prototype that answers one question: does the proposed ZenStack-first `DocumentBase` architecture in `docs/zenstack-relational-redesign-grilling.md` actually hold up against a real ZenStack v3 schema, delegate-polymorphism, and policy runtime?

## User Value

- The redesign stops being a paper architecture only.
- We get a runnable proof, or a concrete failure, for the four validation items named in the grilling notes.
- Any breakage should happen in a small prototype folder instead of inside the current production-facing document/Kysely stack.

## Confirmed Facts

- The current repo is still Kysely/document-first; there is no existing ZenStack or `.zmodel` surface in `server/` or `package.json`.
- `docs/zenstack-relational-redesign-grilling.md` explicitly says the direction is only provisional until four prototype validations succeed:
  1. `DocumentBase` + `@@delegate` + inherited policy behavior on submodels.
  2. tenant/scope/capability rules joining derived grants with shared auth-scope closure.
  3. a concrete managed subtype that adds stricter rules without weakening the base contract.
  4. catalog/discriminator setup proving `qualifiedCollectionKey` aligns app ownership, collection identity, and capability namespace.
- The prototype skill points at the backend/logic branch, but the user clarified this should stay inside the current Nuxt scaffold and may verify behavior with Vitest instead of a standalone full program.
- The repo already uses TypeScript and Vitest; `package.json` has no current prototype script.
- Server specs say new behavior should stay source-backed and current patterns live under `server/`, but this task is a throwaway validation artifact rather than production code.

## Scope Decisions

- This task is a prototype, not the redesign itself.
- The prototype should validate real ZenStack behavior, not simulate ZenStack semantics in plain TypeScript.
- The prototype should live close to the future server-side relational work, be clearly marked throwaway, and use a scratch local SQLite database/file only for prototype runtime.
- The prototype should stay inside the current Nuxt/Vitest scaffold: a minimal prototype module plus a focused Vitest scenario file is acceptable.
- The task may add temporary ZenStack dependencies and a run script if needed to make the prototype runnable in one command.
- The prototype should leave a local `NOTES.md` capturing the question, what was validated, and what still remains uncertain.

## Requirements

- Add a clearly throwaway prototype directory near the future server-side ZenStack work.
- Add a minimal ZModel schema that encodes the proposed catalog, actor-context, scope-closure, derived-grant, and `DocumentBase` polymorphic design.
- Exercise real ZenStack v3 delegate-polymorphism and policy enforcement against that schema.
- Cover the four validation targets from `docs/zenstack-relational-redesign-grilling.md` with runnable prototype scenarios.
- Include at least one managed subtype whose stricter policy denies an operation that the base policy alone would otherwise allow.
- Include qualified collection metadata showing app-local `collectionKey` and global `qualifiedCollectionKey` separation.
- Provide one existing-runner command from `package.json` to run the prototype validation under Vitest.
- Surface full relevant seeded state and scenario observations in the prototype helpers/spec output, and record verdict/results inside the prototype directory.

## Acceptance Criteria

- [ ] `package.json` contains one prototype run command.
- [ ] The prototype directory contains a question statement, a throwaway marker, and a durable `NOTES.md` handoff.
- [ ] Running the prototype generates or uses a real ZenStack schema/client and executes against a scratch local database.
- [ ] The prototype demonstrates `DocumentBase` delegate inheritance on at least one managed subtype.
- [ ] The prototype demonstrates a tenant/scope/capability access check using derived grants plus shared scope closure.
- [ ] The prototype demonstrates a stricter subtype rule that tightens the inherited base contract without weakening it.
- [ ] The prototype demonstrates `qualifiedCollectionKey` as the discriminator while preserving app-scoped `collectionKey` in catalog metadata.
- [ ] The prototype can be exercised from the current Nuxt scaffold through a focused Vitest command.

## Definition of Done

- Requirements are persisted here.
- Prototype design and execution plan are captured in task artifacts.
- The prototype runs locally from one command.
- We have a grounded verdict about whether the current architectural direction still looks viable.

## Out of Scope

- Migrating the existing Kysely/document stack.
- Replacing `server/data/documents` or `server/auth/*` with ZenStack.
- Production-quality tests, lint hardening, or polished UX around the prototype.
- Full framework code generation, Nuxt integration, or route handlers.
- Finalizing the entire CRUD verb catalog or complete long-term schema pipeline.

## Technical Notes

- Primary design source: `docs/zenstack-relational-redesign-grilling.md`.
- Current implementation baseline: `docs/data-layer-development-notes.md`, `server/data/documents/**`, `server/auth/**`, `server/db/**`.
- Server guidance: `.trellis/spec/server/index.md`, `.trellis/spec/server/testing.md`.
- ZenStack setup/modeling/policy skills were loaded before planning; live docs were cross-checked via `zenstack.dev` search results for package names and policy/delegate features.
