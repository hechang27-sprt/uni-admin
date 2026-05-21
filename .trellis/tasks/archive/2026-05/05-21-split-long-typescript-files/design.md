# Technical Design

## Architecture and Boundaries

The refactor stays inside `server/data/documents/` and keeps
`server/data/documents/index.ts` as the public barrel. Existing consumers should
continue importing the same public symbols.

Target module boundaries:

- `repository/index.ts`: repository public facade and compatibility re-exports.
- `repository/types.ts`: repository public contracts.
- `repository/drizzle.ts`: `DrizzleDocumentRepository` and Drizzle-specific
  persistence operations.
- `repository/memory.ts`: `InMemoryDocumentRepository` and in-memory mutation
  operations.
- `repository/query.ts`: shared list normalization plus Drizzle filter/sort SQL
  builders and in-memory predicate/sort helpers, if those helpers can be shared
  cleanly.
- `repository/mapping.ts`: row/document cloning and row assertion helpers.
- `service/index.ts`: service public facade and compatibility re-exports.
- `service/create-service.ts`: `createDocumentService` implementation.
- `service/contracts.ts`: service input/result interfaces.
- `service/helpers.ts`: remote adapter lookup, projection parsing/upsert
  helpers, and reusable service internals.
- `service/test-helpers.ts`: fixtures, registry setup, repository setup, and
  remote adapter test doubles.
- `service.test.ts`: document service behavior cases.

The exact filenames can be adjusted during implementation if the code shows a
cleaner boundary, but the result should avoid circular dependencies and keep
imports local to the document data layer.

## Data Flow and Contracts

Repository contracts continue to operate on `StoredDocument`, document JSON
types, and normalized list inputs. Drizzle-specific modules may import
`documentsTable`, Drizzle SQL helpers, and database schema types. In-memory
modules should not import Drizzle-specific helpers.

Service contracts continue to depend on:

- collection registry lookups for schema parsing and remote adapter access;
- repository methods for persistence;
- JSON patch application for `patch`;
- remote adapter outputs passed through result objects.

No contract should move in a way that forces external consumers to import from a
new internal path.

## Compatibility and Migration Notes

This is a source-only refactor. There is no database migration and no persisted
data migration. Compatibility is maintained by preserving public exports through
the existing barrel file.

Fallow currently reports unused public re-exports. Those are treated as public
API surface until the user explicitly asks for API cleanup.

## Trade-offs

Splitting repository and service directory modules into implementation-specific
files adds more imports, but it makes the concrete implementations
independently readable and lets Fallow's complexity and duplication findings
point to smaller files.

Extracting too many one-off helpers would make control flow harder to follow, so
the implementation should prioritize natural boundaries and duplicated
repository logic over tiny mechanical splits.

## Rollback

Because this is structural, rollback is file-level: restore the original
repository/service module files and `service.test.ts` contents, then delete new
internal modules if validation shows unexpected behavior drift.
