# Break down long TypeScript files

## Goal

Reduce maintenance risk in the document data layer by splitting oversized
TypeScript modules into cohesive smaller modules without changing runtime
behavior or public API contracts.

## Requirements

- Use `npx gitnexus` and `npx fallow` to guide and verify the refactor.
- Focus the first pass on the files currently driving size and health risk:
  - `server/data/documents/repository.ts` (1081 lines; top Fallow hotspot).
  - `server/data/documents/service.ts` (843 lines; 600-line service factory).
  - `server/data/documents/service.test.ts` (939 lines; large test hotspot).
- Preserve existing external imports from `server/data/documents/index.ts` and
  avoid removing exports solely because static analysis marks them unused.
- Keep the refactor structural: no database schema changes, no service behavior
  changes, and no remote adapter contract changes.
- Split modules along existing responsibility boundaries:
  - repository contracts and shared row/data mapping;
  - Drizzle-backed repository implementation and query helpers;
  - in-memory repository implementation and in-memory filter/sort helpers;
  - service input/result contracts and service implementation helpers;
  - test fixtures/helpers separated from behavior cases.
- Keep tests equivalent or better, with validation through the repository's
  existing test and typecheck commands.

## Acceptance Criteria

- [ ] `repository.ts`, `service.ts`, and `service.test.ts` are each materially
      shorter after splitting, with cohesive new modules in
      `server/data/documents/`.
- [ ] Existing document data layer public exports remain available through
      `server/data/documents/index.ts`.
- [ ] `npx gitnexus status` reports the index state before implementation and
      `npx gitnexus analyze` is run after structural edits.
- [ ] `npx fallow health`, `npx fallow dupes`, and a focused dead-code check are
      run before and after the refactor; new findings are not introduced.
- [ ] Fallow duplication in `repository.ts` is reduced or eliminated where it
      can be done without obscuring the code.
- [ ] `npm test` and `npm run typecheck` pass.

## Notes

- Confirmed evidence:
  - `npx gitnexus status` reports the repository index is up to date at commit
    `3f437ca`.
  - Fallow health identifies `repository.ts` as the top hotspot, with moderate
    CRAP findings in `update`, `buildFieldExpression`, `buildFilterCondition`,
    and `compareValues`.
  - Fallow health identifies `createDocumentService` as a 600-line function and
    `service.test.ts` as a large test hotspot.
  - Fallow duplication finds three clone groups, all inside `repository.ts`.
- Out of scope:
  - Removing public exports marked unused by static analysis.
  - Changing JSON patch behavior.
  - Changing database migrations or schema.
  - Introducing new runtime dependencies.
