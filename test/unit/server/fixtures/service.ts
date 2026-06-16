import { z } from "zod";

import { CollectionRegistry } from "#server/data/collections";
import {
  createRemoteProjectionMapper,
  type DocumentService,
  type RemoteCollectionAdapter,
} from "#server/data/documents";
import { createServerContainer, SERVER_DI_TYPES } from "#server/di";
import type { CatalogService } from "#server/data/catalog";

export const tenantA = "00000000-0000-4000-8000-000000000001";
export const tenantB = "00000000-0000-4000-8000-000000000002";

const taskSchema = z.object({
  title: z.string(),
  status: z.enum(["draft", "submitted", "done"]),
  priority: z.number(),
  tags: z.array(z.string()).default([]),
  external_ref: z.string().optional(),
  nested: z
    .object({
      score: z.number(),
      owner: z.string(),
    })
    .optional(),
});

export type TaskDocument = z.infer<typeof taskSchema>;

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

export type RemoteTask = z.infer<typeof remoteTaskSchema>;

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

export async function createService(
  database: DatabaseClient,
): Promise<DocumentService> {
  const registry = CollectionRegistry.fromRegistrations([
    {
      name: "tasks",
      schema: taskSchema,
      schemaVersion: 1,
    },
  ]);
  const container = createServerContainer({ database, registry });
  const catalog = container.get<CatalogService>(SERVER_DI_TYPES.CatalogService);
  await catalog.enableTenantApp({ tenantId: tenantA });
  await catalog.enableTenantApp({ tenantId: tenantB });
  await catalog.syncRegistryCollections();
  return container.get<DocumentService>(SERVER_DI_TYPES.DocumentService);
}

interface RemoteAdapterCalls {
  syncOne: number;
  syncList: number;
  createRemote: number;
  updateRemote: number;
  deleteRemote: number;
}

export interface RemoteAdapterOutputs {
  syncOne: { requestId: string };
  syncList: { nextCursor: string | null };
  create: { requestId: string };
  update: { requestId: string };
  delete: { requestId: string };
}

export async function createRemoteService(database: DatabaseClient): Promise<{
  service: DocumentService;
  calls: RemoteAdapterCalls;
  setRemoteFailure: (failure: Error | null) => void;
}> {
  const calls: RemoteAdapterCalls = {
    syncOne: 0,
    syncList: 0,
    createRemote: 0,
    updateRemote: 0,
    deleteRemote: 0,
  };
  let remoteFailure: Error | null = null;
  const remoteRows = new Map<string, RemoteTask>([
    [
      "remote-1",
      {
        remote_id: "remote-1",
        name: "Remote draft",
        phase: "draft",
        priority: 1,
        labels: ["remote"],
        owner: { name: "Ada", score: 10 },
      },
    ],
  ]);

  const adapter: RemoteCollectionAdapter<
    TaskDocument,
    { remoteId: string },
    Record<string, never>,
    RemoteTask,
    Partial<RemoteTask>,
    Record<string, never>,
    RemoteAdapterOutputs
  > = {
    remoteSource: "fixture-api",
    idempotency: {
      create: {
        stableKey: (input) => `create:${input.remote_id}`,
      },
    },
    async syncOne(input) {
      calls.syncOne += 1;
      const row = remoteRows.get(input.remoteId);
      return {
        projection: row ? mapRemoteTask(row) : null,
        output: { requestId: `sync-one-${calls.syncOne}` },
      };
    },
    async syncList() {
      calls.syncList += 1;
      return {
        projections: remoteRows
          .values()
          .map((row) => mapRemoteTask(row))
          .toArray(),
        output: { nextCursor: null },
      };
    },
    async createRemote(input) {
      calls.createRemote += 1;
      if (remoteFailure) {
        throw remoteFailure;
      }
      remoteRows.set(input.remote_id, input);
      return {
        projection: mapRemoteTask(input),
        output: { requestId: `create-${calls.createRemote}` },
      };
    },
    async updateRemote(input, context) {
      calls.updateRemote += 1;
      if (remoteFailure) {
        throw remoteFailure;
      }
      const remoteId = context.current.remoteId ?? input.remote_id;
      if (!remoteId) {
        throw new Error("Missing remote id");
      }
      const current = remoteRows.get(remoteId);
      if (!current) {
        throw new Error("Remote row not found");
      }
      const updated = {
        ...current,
        ...input,
        remote_id: remoteId,
      };
      remoteRows.set(remoteId, updated);
      return {
        projection: mapRemoteTask(updated),
        output: { requestId: `update-${calls.updateRemote}` },
      };
    },
    async deleteRemote() {
      calls.deleteRemote += 1;
      if (remoteFailure) {
        throw remoteFailure;
      }
      return { output: { requestId: `delete-${calls.deleteRemote}` } };
    },
  };

  const registry = CollectionRegistry.fromRegistrations([
    {
      name: "remote-tasks",
      schema: taskSchema,
      schemaVersion: 1,
      remoteAdapter: adapter,
    },
  ]);
  const container = createServerContainer({ database, registry });
  const catalog = container.get<CatalogService>(SERVER_DI_TYPES.CatalogService);
  await catalog.enableTenantApp({ tenantId: tenantA });
  await catalog.enableTenantApp({ tenantId: tenantB });
  await catalog.syncRegistryCollections();

  return {
    service: container.get<DocumentService>(SERVER_DI_TYPES.DocumentService),
    calls,
    setRemoteFailure: (failure) => {
      remoteFailure = failure;
    },
  };
}
