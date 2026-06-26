# Implementation Plan — tighten zenstack prototype schema base

## Ordered Checklist

1. Update task context manifests with prototype files, docs, and server specs.
2. Start the task after planning artifacts exist.
3. Tighten `prototype.zmodel` toward the richer auth/catalog/base sketch.
4. Update runtime seeding to match the new auth/catalog/grant shape.
5. Update the focused Vitest prototype spec to assert the tightened model behavior.
6. Update `NOTES.md` and any necessary grilling notes to reflect what the tightened prototype now proves.
7. Run `bun run prototype:zenstack-relational-redesign`.
8. Fix schema/runtime/policy issues until the Bun prototype passes.

## Validation Command

- `bun run prototype:zenstack-relational-redesign`

## Review Gates

Before completion, confirm:

- auth() is actor-context shaped, not a thin actor shortcut;
- grant semantics are closer to `(actorContext, capability, grantScope)` + closure than before;
- `DocumentBase` is sharper, not broader;
- catalog ownership/discriminator semantics remain explicit;
- the prototype still gives a clean architectural verdict.

## Exit Criteria

- If the richer model makes ZenStack policy shape too awkward, capture the exact friction in notes/docs instead of hiding it behind shortcuts.
- If one of the settled assumptions breaks under the tighter model, report that as the useful outcome.
