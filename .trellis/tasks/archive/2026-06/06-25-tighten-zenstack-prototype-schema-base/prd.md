# tighten zenstack prototype schema base

## Goal

Use the working prototype as evidence, then tighten the ZModel base contract and surrounding auth/catalog models so the prototype is much closer to the full settled redesign direction from `docs/zenstack-relational-redesign-grilling.md`, not just a minimum schema that happened to validate the initial four questions.

## What I already know

- The prototype now passes under `bun run prototype:zenstack-relational-redesign`.
- Current prototype schema is intentionally thin: `Actor`, `AuthScope`, `AuthScopeClosure`, `Grant`, `CollectionCatalog`, `DocumentBase`, `ProjectDocument`, `LockedDocument`.
- The current base policy uses direct `auth().grants?[capabilityKey == 'document:read' && effectiveScopeId == this.authScopeId]` / `document:update` checks on a thin `Actor` auth model.
- The prototype notes exposed two important schema-level gaps:
  - base-model queries can only select base fields, so the base contract should stay sharply limited to true shared platform concerns;
  - the stricter subtype denial surfaced as `not-found`, so baseline versus tightened policy behavior needs clearer shaping and re-checking.
- The grilling doc's settled direction is richer than the current prototype in several ways:
  - `auth()` should be actor-context shaped, not a thin actor/user row;
  - derived access should prefer `(actor_context, capability, grant_scope)` plus shared closure semantics, not only a duplicated `effectiveScopeId` shortcut;
  - app/catalog ownership should stay metadata, while the managed base contract should carry only what truly belongs on every managed row;
  - the prototype should lean toward the draft sketch with tenant/membership/actor-context/catalog relations.
- The grilling notes contain one obsolete earlier statement about `collectionKey` as discriminator, but the later settled direction and current prototype both use `qualifiedCollectionKey` instead.

## Decision

The user chose full-scope tightening for this task.

That means:

- keep the work inside the existing prototype/test/docs slice;
- move the prototype materially closer to the draft relational sketch;
- tighten both `DocumentBase` and the auth/access model together, not one without the other;
- accept moderate schema/test churn inside the prototype as long as the prototype stays Bun-only, PGlite-backed, and ZenStack-first.

## Requirements

- Keep the work inside the existing prototype surface under `server/zenstack/prototype-relational-redesign/` and its focused Vitest spec.
- Preserve the Bun-only workflow and the PGlite + ZenStack runtime seam already proven by the prototype.
- Replace the thin `Actor`-only auth model with a more faithful actor-context shape aligned to the grilling notes.
- Prefer a derived grant model centered on `(actor_context, capability, grant_scope)` plus shared scope closure, instead of the current minimal direct-effective-scope shortcut where possible.
- Tighten `DocumentBase` so it carries only the shared managed-collection contract and aligns with the later settled `qualifiedCollectionKey` discriminator direction.
- Tighten catalog/app ownership modeling toward the draft sketch where it helps validate the architecture.
- Keep at least one stricter managed subtype proving submodels can tighten the inherited base policy without weakening it.
- Re-verify the prototype with the focused Bun runner after the schema/test changes.
- Update prototype notes and, if needed, the grilling document to reflect what the tightened prototype now proves or disproves.

## Acceptance Criteria

- [ ] The prototype schema materially moves toward the draft relational sketch: actor-context/auth relations, shared closure semantics, and catalog ownership are represented more faithfully than before.
- [ ] `DocumentBase` remains a sharp shared base contract, with `qualifiedCollectionKey` as discriminator and only truly shared managed-row fields on the base model.
- [ ] The focused prototype test still proves delegate inheritance, scope-aware access, subtype tightening, and catalog/discriminator separation.
- [ ] `bun run prototype:zenstack-relational-redesign` passes.
- [ ] Notes/docs are updated to capture the tightened schema's architectural implications.

## Definition of Done

- Tightening scope is explicit.
- Schema/test/docs are aligned.
- Prototype remains Bun-only and runnable.
- The resulting prototype gives a better signal about whether the full redesign direction still holds.

## Out of Scope

- Production migration of the document/Kysely stack.
- Full framework code generation pipeline.
- Non-prototype server modules outside the prototype/test/docs slice.
- Final production API/error-shaping work beyond what the prototype can prove.

## Technical Notes

- Main inputs: `server/zenstack/prototype-relational-redesign/prototype.zmodel`, `runtime.ts`, `NOTES.md`, `test/unit/server/zenstack/prototype-relational-redesign.test.ts`.
- Architectural target: `docs/zenstack-relational-redesign-grilling.md`.
- Keep an eye on the earlier-vs-later discriminator wording in the grilling doc; later settled sections currently win.
