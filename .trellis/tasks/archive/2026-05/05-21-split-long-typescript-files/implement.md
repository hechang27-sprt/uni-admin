# Implementation Plan

## Checklist

- [x] Load pre-development guidance before editing.
- [x] Reconfirm dirty state and avoid touching unrelated existing changes.
- [x] Run GitNexus impact analysis where available before modifying exported
      symbols/classes/functions; if only the CLI is available, record that the
      MCP impact tool is unavailable and use `npx gitnexus status/analyze`.
- [x] Refactor repository modules first:
  - [x] Move repository record interfaces and `DocumentRepository` contract into
        a stable public module.
  - [x] Extract `DrizzleDocumentRepository` into a Drizzle-specific module.
  - [x] Extract `InMemoryDocumentRepository` into an in-memory module.
  - [x] Extract shared mapping/cloning/query helpers where they reduce file size
        or Fallow duplication without creating circular imports.
  - [x] Preserve repository public exports through `repository.ts` and
        `index.ts`.
- [x] Refactor service modules second:
  - [x] Move service contracts if it makes `service.ts` smaller and clearer.
  - [x] Extract service helper logic only when dependency direction remains
        straightforward.
  - [x] Preserve `createDocumentService` behavior and public exports.
- [x] Split test helpers from `service.test.ts` while keeping behavior cases easy
      to scan.
- [x] Run validation:
  - [x] `npm test`
  - [x] `npm run typecheck`
  - [x] `npx --yes fallow health --format json --quiet --explain --top 25 2>/dev/null || true`
  - [x] `npx --yes fallow dupes --format json --quiet --top 20 2>/dev/null || true`
  - [x] `npx --yes fallow dead-code --format json --quiet --unused-exports --unused-files 2>/dev/null || true`
  - [x] `npx gitnexus analyze`

## Risky Files

- `server/data/documents/repository.ts`: highest blast radius in this task;
  contains two concrete repository implementations, query logic, mapping, and
  batch update SQL.
- `server/data/documents/service.ts`: large closure-based factory; helper
  extraction can accidentally change access to `registry` and `repository`.
- `server/data/documents/service.test.ts`: large test file; splitting helpers
  can accidentally hide per-test state or shared mutable fixtures.
- `server/data/documents/index.ts`: public barrel; changes here can break
  external imports.

## Review Gates

- Do not remove exports simply because Fallow marks them unused.
- Avoid changing test assertions except where imports/helper locations change.
- After each major split, check for circular imports and type errors before
  continuing.
