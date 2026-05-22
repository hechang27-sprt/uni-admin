# Framework DX Guide

This guide shows how to use the framework as it exists today and what the
developer experience is aiming toward. The current API is service-level
TypeScript. The future API sketches are design targets, not implemented
contracts.

## Who This Is For

Use this document if you are:

- Building or testing the current data layer.
- Creating a remote-backed collection adapter.
- Trying to understand how today's low-level service calls should evolve into a
  higher-level Nuxt admin framework.

## Current Status

Today, the framework provides a local document service and a remote adapter
boundary. You write TypeScript code to:

1. Define a local document schema.
2. Register a collection.
3. Create a Drizzle-backed repository.
4. Create a document service.
5. Call service methods directly.

There are no generated routes, table views, form builders, or client
composables yet. Unit tests use pgLite to run the same repository contract
in-memory, but the public document repository is `DrizzleDocumentRepository`.

## Tutorial: Register a Local Collection

Define the data shape with Zod:

```ts
import { z } from "zod";

const taskSchema = z.object({
  title: z.string(),
  status: z.enum(["draft", "submitted", "done"]),
  priority: z.number(),
  tags: z.array(z.string()).default([]),
});

type TaskDocument = z.infer<typeof taskSchema>;
```

Create a registry and service:

```ts
import {
  createCollectionRegistry,
  createDocumentService,
  DrizzleDocumentRepository,
} from "../server/data/documents";
import { db } from "../server/util/drizzle";

const registry = createCollectionRegistry([
  {
    name: "tasks",
    schema: taskSchema,
    schemaVersion: 1,
  },
]);

const service = createDocumentService({
  registry,
  repository: new DrizzleDocumentRepository(db),
});
```

Create and read a document:

```ts
const created = await service.create<TaskDocument>({
  tenantId: "00000000-0000-4000-8000-000000000001",
  collection: "tasks",
  data: {
    title: "Draft task",
    status: "draft",
    priority: 1,
    tags: [],
  },
});

const listed = await service.list<TaskDocument>({
  tenantId: created.tenantId,
  collection: "tasks",
});
```

Update with optimistic concurrency:

```ts
const updated = await service.update<TaskDocument>({
  tenantId: created.tenantId,
  collection: "tasks",
  id: created.id,
  expectedVersion: created.version,
  data: {
    title: "Submitted task",
    status: "submitted",
    priority: 2,
    tags: ["review"],
  },
});
```

Batch local writes use explicit methods instead of array-overloaded scalar
methods. `getByIds` preserves input order and returns `null` for missing IDs;
`updateMany` rejects the whole batch when any item is missing or stale:

```ts
const batch = await service.createMany<TaskDocument>({
  tenantId: created.tenantId,
  collection: "tasks",
  items: [
    { data: { title: "Import A", status: "draft", priority: 1, tags: [] } },
    { data: { title: "Import B", status: "draft", priority: 2, tags: [] } },
  ],
});

const fetched = await service.getByIds<TaskDocument>({
  tenantId: created.tenantId,
  collection: "tasks",
  ids: batch.map((item) => item.id),
});

await service.updateMany<TaskDocument>({
  tenantId: created.tenantId,
  collection: "tasks",
  items: fetched.flatMap((item) =>
    item
      ? [
          {
            id: item.id,
            expectedVersion: item.version,
            data: { ...item.data, status: "submitted" },
          },
        ]
      : [],
  ),
});
```

Patch with the supported JSON Patch subset:

```ts
await service.patch<TaskDocument>({
  tenantId: updated.tenantId,
  collection: "tasks",
  id: updated.id,
  expectedVersion: updated.version,
  patch: [
    { op: "test", path: "/status", value: "submitted" },
    { op: "replace", path: "/status", value: "done" },
    { op: "add", path: "/tags/-", value: "closed" },
  ],
});
```

## Tutorial: Register a Remote-Backed Collection

A remote-backed collection still stores local JSONB projection documents. The
remote system remains the source of truth for remote records.

Define the remote payload and local projection:

```ts
const remoteTaskSchema = z.object({
  remote_id: z.string(),
  name: z.string(),
  phase: z.enum(["draft", "submitted", "done"]),
  priority: z.number(),
  labels: z.array(z.string()).default([]),
  owner: z.object({
    name: z.string(),
    score: z.number(),
  }),
});

type RemoteTask = z.infer<typeof remoteTaskSchema>;
```

Create a projection mapper:

```ts
import { createRemoteProjectionMapper } from "../server/data/documents";

const mapRemoteTask = createRemoteProjectionMapper<RemoteTask, TaskDocument>({
  schema: remoteTaskSchema,
  getRemoteId: (remote) => remote.remote_id,
  mapData: (remote) => ({
    title: remote.name,
    status: remote.phase,
    priority: remote.priority,
    tags: remote.labels,
    nested: {
      owner: remote.owner.name,
      score: remote.owner.score,
    },
  }),
});
```

Register an adapter:

```ts
import type { RemoteCollectionAdapter } from "../server/data/documents";

const adapter: RemoteCollectionAdapter<
  TaskDocument,
  { remoteId: string },
  Record<string, never>,
  RemoteTask,
  Partial<RemoteTask>,
  Record<string, never>
> = {
  remoteSource: "fixture-api",
  idempotency: {
    create: {
      stableKey: (input) => `create:${input.remote_id}`,
    },
  },
  async syncOne(input) {
    const remote = await fetchRemoteTask(input.remoteId);
    return { projection: remote ? mapRemoteTask(remote) : null };
  },
  async syncList() {
    const page = await fetchRemoteTasks();
    return {
      projections: page.rows.map(mapRemoteTask),
      output: { nextCursor: page.nextCursor },
    };
  },
  async createRemote(input) {
    const created = await createRemoteTask(input);
    return { projection: mapRemoteTask(created) };
  },
  async updateRemote(input, context) {
    const remoteId = context.current.remoteId;
    if (!remoteId) throw new Error("Missing remote id");

    const updated = await updateRemoteTask(remoteId, input);
    return { projection: mapRemoteTask(updated) };
  },
  async deleteRemote(input, context) {
    if (!context.current.remoteId) throw new Error("Missing remote id");
    await deleteRemoteTask(context.current.remoteId);
  },
};
```

Attach the adapter to the collection registration:

```ts
const registry = createCollectionRegistry([
  {
    name: "remoteTasks",
    schema: taskSchema,
    schemaVersion: 1,
    remoteAdapter: adapter,
  },
]);
```

Refresh a projection explicitly:

```ts
const synced = await service.syncRemoteOne<TaskDocument, { remoteId: string }>({
  tenantId,
  collection: "remoteTasks",
  input: { remoteId: "remote-1" },
});
const syncedDocument = synced.document;
```

Read from the local projection:

```ts
const rows = await service.list<TaskDocument>({
  tenantId,
  collection: "remoteTasks",
});
```

`list` and `getById` do not call the remote adapter. Remote refresh is always
explicit today.

Run a remote-first update:

```ts
if (!syncedDocument) throw new Error("Document was not synced");

const updated = await service.remoteUpdate<TaskDocument, Partial<RemoteTask>>({
  tenantId,
  collection: "remoteTasks",
  id: syncedDocument.id,
  expectedVersion: syncedDocument.version,
  input: {
    phase: "done",
    name: "Remote done",
  },
});
const updatedDocument = updated.document;
```

The local projection is updated only after `updateRemote` succeeds.

## Service-Level Auth/RBAC

The backend now has a service-level auth/RBAC foundation. It does not add
routes, composables, or generated management UI yet.

Create the auth/RBAC service beside the document service:

```ts
import { DrizzleAuthRbacRepository, createAuthRbacService } from "#server/auth";
import {
  DrizzleDocumentRepository,
  createCollectionRegistry,
  createDocumentService,
} from "#server/data/documents";

const auth = createAuthRbacService({
  repository: new DrizzleAuthRbacRepository(db),
});

const registry = createCollectionRegistry([
  {
    name: "tasks",
    schema: taskSchema,
    schemaVersion: 1,
    auth: {
      resourceScope: "document",
    },
  },
]);

await auth.syncBuiltInAdminPermissions();
await auth.syncCollectionPermissions(registry);

const service = createDocumentService({
  registry,
  repository: new DrizzleDocumentRepository(db),
  authorizer: auth,
});
```

Trusted setup code can create users, credentials, memberships, scopes, roles,
permission grants, and assignments. Runtime code should resolve an actor
context and then pass it through `DocumentServiceOptions`:

```ts
const actor = await auth.resolveActor({ tenantId, userId });

await service.create(
  {
    tenantId: actor.tenantId,
    collection: "tasks",
    authScopeId: departmentScopeId,
    data: {
      title: "Inspect conveyor",
      status: "draft",
      priority: 1,
    },
  },
  { actor: actor.actor },
);
```

`authScopeId` is framework metadata, not application JSON. Omitting it stores
`null`, which means tenant-root/global resource. Normal update and patch calls
do not change it; use `setDocumentAuthScope` for explicit reassignment guarded
by `admin:documents:set-scope`.

## Local Testing Setup

Unit tests create a pgLite database, run the Drizzle migrations, seed tenants,
and then construct the same repository class used by application code:

```ts
import { migrate } from "drizzle-orm/pglite/migrator";

import { tenantsTable } from "#server/db/schema";
import { createInMemoryDb } from "#server/util/drizzle";
import { DrizzleDocumentRepository } from "#server/data/documents";

const database = createInMemoryDb();
await migrate(database, { migrationsFolder: "drizzle" });
await database
  .insert(tenantsTable)
  .values([{ id: tenantId, name: "Test Tenant" }]);

const repository = new DrizzleDocumentRepository(database);
```

Close the pgLite client after the test suite with `database.$client.close()`.

## Current Error Handling

The data layer normalizes framework errors with `DocumentServiceError`.

Important current codes:

- `UNKNOWN_COLLECTION`
- `VALIDATION_FAILED`
- `NOT_FOUND`
- `CONFLICT_STALE_VERSION`
- `CONFLICT_PATCH_TEST_FAILED`
- `UNSUPPORTED_OPERATION`
- `HARD_DELETE_NOT_CONFIRMED`
- `AUTHORIZER_REQUIRED`
- `AUTHORIZATION_DENIED`
- `INVALID_AUTH_SCOPE`

Remote adapter exceptions are not yet normalized into operation error records.
That will happen with the queue/action layer.

## Desired Future DX

The future framework should let developers describe collections and actions at a
higher level, then get server routes, composables, and admin table behavior from
that declaration.

The target shape is closer to:

```ts
export default defineAdminCollection({
  name: "tasks",
  tenantScoped: true,
  data: taskSchema,
  table: {
    columns: [
      { key: "title", label: "Title" },
      { key: "status", label: "Status" },
      { key: "priority", label: "Priority" },
    ],
  },
  remote: {
    source: "fixture-api",
    sync: {
      one: async ({ remoteId, clients }) => clients.fixture.getTask(remoteId),
      list: async ({ clients }) => clients.fixture.listTasks(),
      map: mapRemoteTask,
    },
    mutations: {
      update: {
        idempotencyKey: ({ input }) => input.requestId,
        run: async ({ remoteId, input, clients }) =>
          clients.fixture.updateTask(remoteId, input),
        project: mapRemoteTask,
      },
    },
  },
  actions: {
    submit: defineDocumentAction({
      input: z.object({ comment: z.string().optional() }),
      scope: ({ document }) => ({
        kind: "document",
        collection: "tasks",
        documentId: document.id,
      }),
      run: async ({ document, input, clients }) =>
        clients.fixture.submitTask(document.remoteId, input),
      project: async ({ response, documents }) => {
        await documents.patch("tasks", response.documentId, [
          { op: "replace", path: "/status", value: "submitted" },
        ]);
      },
    }),
  },
});
```

From that, application code should be able to use Nuxt-friendly helpers:

```ts
const { data, refresh } = await useAdminCollection("tasks").list();

await useAdminMutation("tasks").patch(document.id, {
  expectedVersion: document.version,
  patch: [{ op: "replace", path: "/priority", value: 3 }],
});
```

Queued operations should be hidden by default:

```ts
const result = await useAdminAction("tasks", "submit").run(document.id, {
  comment: "Ready for review",
});

if (result.pending) {
  // The helper timed out while the operation was still queued/running.
  // The caller can show a pending state and keep polling.
}
```

## Gap Between Today and the Future

| Area                   | Today                            | Shiny Future                                                  |
| ---------------------- | -------------------------------- | ------------------------------------------------------------- |
| Collection declaration | Manual registry object           | `defineAdminCollection`                                       |
| Reads                  | Direct service calls             | Nuxt composables and API routes                               |
| Writes                 | Direct service calls             | Async mutation helpers                                        |
| Remote sync            | Explicit service methods         | UI action plus server route wrapper                           |
| Remote mutations       | Service-level adapter calls      | Operation-aware mutation helpers                              |
| Custom actions         | Not implemented                  | `defineDocumentAction`, collection actions, workspace actions |
| Queue                  | Not implemented                  | PostgreSQL operation records and worker                       |
| Conflict behavior      | Immediate optimistic concurrency | `immediate`, `queueOnConflict`, `queued`                      |
| UI                     | Not implemented                  | Generated tables/forms with escape hatch pages                |
| Status                 | Not implemented                  | Pollable operation status                                     |

## Development Workflow

Use these commands while changing the framework:

```bash
bun run typecheck
bun run test
bun run build
```

Use `bun run typecheck`, not plain `bunx tsc --noEmit`. The root TypeScript
config is a project-reference entrypoint with no files of its own; build mode is
required to check the referenced Nuxt projects.

## What To Read Next

- Read [Data Layer Development Notes](./data-layer-development-notes.md) for
  maintainer-level contracts and implementation boundaries.
- Read `test/unit/server/service.test.ts` for executable examples of the
  current data-layer behavior.
- Read Trellis task artifacts under
  `.trellis/tasks/archive/2026-05/05-19-remote-collection-adapters/` for the
  archived remote adapter planning context.
