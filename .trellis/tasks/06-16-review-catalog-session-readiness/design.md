# Review catalog identity and session readiness design

## Review Boundaries

This task is a code review plus targeted cleanup. It must not implement session endpoints. It may fix existing bugs and small design debt discovered while validating the catalog migration and session readiness.

Review surfaces:

- Catalog identity: `server/data/catalog/*`, `server/data/collections/*`, document service identity resolution, document repository persistence, schema/migration constraints.
- Auth/RBAC: permission sync, canonical permission key use, app/collection capability evaluation, grants.
- Session readiness: auth service/repository seams, DB/schema/migration stack, DI/runtime/Nuxt route boundary assumptions, archived session PRD/design/implement assumptions.
- Specs/docs/tests: `.trellis/spec/server/*`, `docs/*`, `test/unit/server/*`.

## Approach

1. Establish intended contracts from Trellis artifacts and specs.
2. Use GitNexus query/context/impact for flow-level review before modifying symbols.
3. Fan out independent review slices to subagents:
   - catalog migration validator;
   - auth/RBAC and permission identity reviewer;
   - session readiness reviewer;
   - tests/spec/docs consistency reviewer.
4. Main agent synthesizes findings, applies or coordinates confirmed fixes, and runs final verification.

## Finding Policy

Every reported bug/design smell must include:

- exact file/symbol reference;
- expected invariant from task/spec/code;
- observed violation;
- risk;
- fix applied or follow-up rationale.

False positives are expected in AI reviews. Main agent verifies findings against source before editing.

## Fix Policy

Fix immediately when:

- issue is concrete and source-backed;
- scope is local to current review surfaces;
- behavior is covered by or can be covered by targeted tests;
- no product decision is needed.

Record as follow-up when:

- issue requires session endpoint implementation;
- product/security policy is undecided;
- migration/backfill beyond current empty-baseline Kysely model is required;
- fix would broaden task beyond review/cleanup.

## Session Readiness Decision Frame

The archived session task can proceed only if:

- it is updated mentally/report-wise from Drizzle wording to Kysely implementation reality;
- current auth code exposes or can cleanly grow active-user/session-resolution primitives;
- catalog migration did not introduce permission-key or tenant/app identity ambiguity that would affect authenticated requests;
- route/runtime boundary remains cleanly separated from auth domain.
