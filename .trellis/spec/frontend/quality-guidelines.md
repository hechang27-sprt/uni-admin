# Quality Guidelines

Quality checks should match the current Nuxt/data-layer project rather than a
generic frontend app.

## Required Commands

Run these before treating data-layer or framework changes as complete:

```bash
bun run typecheck
bun run test
bun run build
```

For docs/spec-only edits, at minimum run:

```bash
git diff --check
rg "To be fille[d]|TODO: fil[l]|placeholde[r]" .trellis/spec
```

## Test Expectations

- Server data-layer behavior is covered in `test/unit/server/service.test.ts`.
- Shared test setup belongs in `test/unit/server/fixtures/service.ts`.
- Unit tests use pgLite through `createInMemoryDb()` and migrate the real
  Drizzle schema before exercising `DrizzleDocumentRepository`.
- Add tests for tenant isolation, optimistic concurrency, validation failures,
  batch all-or-nothing behavior, remote projection behavior, and local-only
  reads when those areas change.

## Review Checklist

- Does the change preserve tenant scoping?
- Does it preserve schema validation before persistence?
- Does it preserve `expectedVersion` semantics for existing-document
  mutations?
- Do remote mutations update local projections only after the remote call
  succeeds?
- Are docs/examples clear about what exists today versus future API sketches?
- Are generated files such as `.nuxt/` and Drizzle metadata handled
  intentionally?

## Anti-Patterns

- Do not rely on build success alone for data-layer behavior.
- Do not add tests that mock away the repository when the behavior depends on
  Drizzle SQL, transactions, migrations, or pgLite compatibility.
- Do not leave Trellis spec templates or filler text in `.trellis/spec/`.
