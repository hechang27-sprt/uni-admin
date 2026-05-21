# Data Layer Development Notes

This document explains the current data-layer design for maintainers. It is not
a public API reference yet; it records the contracts that exist today and the
constraints that future layers should preserve.

## Scope

Implemented today:

- Multi-tenant document storage in PostgreSQL using one `documents` table.
- Zod-backed collection registration.
- Local document CRUD, list, soft delete, restore, hard delete, and JSON Patch.
- Remote-backed collection registration.
- Explicit remote sync operations.
- Remote-first create, update, and delete wrappers.
- Remote response validation and projection mapping.

Not implemented yet:

- Operation records and queue worker.
- Custom action registration and dispatch.
- Document, collection, and workspace action scopes.
- `queueOnConflict` write modes.
- Nuxt API routes and composables.
- Generated table UI or UI schema runtime.

## Storage Model

The current database shape is intentionally small:

- `tenants`: tenant identity.
- `documents`: tenant-scoped collection records with JSONB data.

Document rows keep framework-owned identity separate from remote identity:

- `id`: internal UUID primary key.
- `tenant_id`: tenant boundary.
- `collection`: collection name.
- `schema_version`: version of the registered local document schema.
- `data`: JSONB local projection.
- `remote_source`: optional remote system name.
- `remote_id`: optional remote record identity.
- `version`: optimistic concurrency token.
- `deleted_at`: soft-delete marker.

Remote-backed rows are unique by:

```text
(tenant_id, collection, remote_source, remote_id)
```

Local-only rows leave `remote_source` and `remote_id` empty.

## Local Document Service

Collections are registered with a name, local document schema, and schema
version:

```ts
import { z } from "zod";
import {
  createCollectionRegistry,
  createDocumentService,
  InMemoryDocumentRepository,
} from "../server/data/documents";

const taskSchema = z.object({
  title: z.string(),
  status: z.enum(["draft", "submitted", "done"]),
  priority: z.number(),
  tags: z.array(z.string()).default([]),
});

const registry = createCollectionRegistry([
  {
    name: "tasks",
    schema: taskSchema,
    schemaVersion: 1,
  },
]);

const service = createDocumentService({
  registry,
  repository: new InMemoryDocumentRepository(),
});
```

The service validates document data before persistence. Mutating methods that
change existing rows require `expectedVersion`, and stale versions fail with
`CONFLICT_STALE_VERSION`.

JSON Patch supports the current RFC 6902-compatible subset:

- `add`
- `replace`
- `remove`
- `test`

`copy` and `move` are not part of the MVP.

## Remote Adapter Boundary

Remote collection adapters live above the local document service. They own:

- Remote API calls.
- Remote response validation.
- Remote identity extraction.
- Mapping remote payloads into local document projections.
- Optional idempotency metadata for future queue retry decisions.

The adapter contract is explicit:

```ts
interface RemoteCollectionAdapter<
  TData,
  TSyncOneInput,
  TSyncListInput,
  TCreateInput,
  TUpdateInput,
  TDeleteInput,
> {
  remoteSource: string;
  syncOne(input, context): Promise<RemoteAdapterProjection<TData> | null>;
  syncList(input, context): Promise<RemoteAdapterProjection<TData>[]>;
  createRemote(input, context): Promise<RemoteAdapterProjection<TData>>;
  updateRemote(input, context): Promise<RemoteAdapterProjection<TData>>;
  deleteRemote(input, context): Promise<RemoteDeleteResult<TData> | void>;
}
```

The real TypeScript interface uses typed callback properties with a bivariance
wrapper. This is deliberate: the registry stores heterogeneous adapters, so it
must erase input types at rest while individual adapter implementations still
keep concrete input types.

Do not replace that with `unknown` input defaults on the stored adapter type.
That makes concrete adapters fail assignment when `strictFunctionTypes` is
active in IDE or project-reference checks.

## Remote Projection Flow

Remote sync and remote-first writes all end in the same projection path:

```text
remote payload
  -> adapter validation
  -> adapter projection mapping
  -> local document schema validation
  -> upsert/update local JSONB projection
```

Normal reads do not call remotes:

- `getById` reads the local projection.
- `list` reads the local projection.

Remote refresh is explicit:

- `syncRemoteOne`
- `syncRemoteList`

Remote writes call the adapter first:

- `remoteCreate`
- `remoteUpdate`
- `remoteDelete`

If a remote call fails, local projection data must remain unchanged.

## Type-Checking Notes

The root `tsconfig.json` is a project-reference entrypoint with no files of its
own:

```json
{
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.app.json" },
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" }
  ]
}
```

Plain `tsc --noEmit` checks only the empty root project. Use build mode to
check referenced projects:

```bash
bun run typecheck
```

The script currently runs:

```bash
bunx tsc -b --noEmit
```

## Validation Commands

Run these before treating a data-layer change as complete:

```bash
bun run typecheck
bun run test
bun run build
```

`bun run build` currently emits Nuxt sourcemap and CSS resolution warnings, but
the build completes successfully.

## Maintainer Notes

Keep data-layer changes narrow:

- Preserve tenant scoping in all repository operations.
- Preserve schema validation before persistence.
- Preserve optimistic concurrency for existing document mutations.
- Keep remote calls outside local database transactions.
- Keep remote-backed read semantics local-only.
- Add tests for both `InMemoryDocumentRepository` and
  `DrizzleDocumentRepository`.

Future operation queue work should reuse the document service for projection
writes rather than allowing custom action code to mutate database rows directly.
