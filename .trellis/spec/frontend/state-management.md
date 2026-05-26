# State Management

Pinia is installed through `@pinia/nuxt`, but the project does not currently
define application stores. The implemented stateful behavior is server-side:
document rows in PostgreSQL/pgLite and service-level optimistic concurrency.

## Current State Sources

- Durable document state lives in the `documents` table defined by
  `server/db/schema.ts`.
- The document service returns `StoredDocument` objects with `version`,
  `createdAt`, `updatedAt`, and `deletedAt` metadata.
- Remote-backed collections store local JSONB projections and read locally.
- Tests construct state through `KyselyDocumentRepository` and
  `DocumentService`.

## When To Use Pinia

Use Pinia only when there is real client-side state to share across Nuxt views,
such as selection, filters, or workspace UI preferences. Do not move durable
document data or queue status into Pinia as the source of truth.

## Server State Rules

- Keep tenant-scoped persisted state behind the document service.
- Preserve `expectedVersion` on mutations that update existing documents.
- Treat remote adapter output metadata as pass-through data; the service does
  not interpret provider-specific cursors, request IDs, or hints.
- Keep remote reads explicit with `syncRemoteOne` and `syncRemoteList`; normal
  `getById` and `list` calls read local projections only.

## Anti-Patterns

- Do not store unsaved copies of full documents globally unless there is a
  specific workflow that requires draft state.
- Do not use frontend state to paper over stale-version conflicts.
- Do not treat Pinia installation as a requirement to add stores for every
  feature.
