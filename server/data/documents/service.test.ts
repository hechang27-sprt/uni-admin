import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createCollectionRegistry,
  createDocumentService,
  DocumentServiceError,
  InMemoryDocumentRepository,
  type DocumentService,
} from ".";

const tenantA = "00000000-0000-4000-8000-000000000001";
const tenantB = "00000000-0000-4000-8000-000000000002";

const taskSchema = z.object({
  title: z.string(),
  status: z.enum(["draft", "submitted", "done"]),
  priority: z.number(),
  tags: z.array(z.string()).default([]),
  nested: z
    .object({
      score: z.number(),
      owner: z.string(),
    })
    .optional(),
});

type TaskDocument = z.infer<typeof taskSchema>;

function createService(): DocumentService {
  const registry = createCollectionRegistry([
    {
      name: "tasks",
      schema: taskSchema,
      schemaVersion: 1,
    },
  ]);

  return createDocumentService({
    registry,
    repository: new InMemoryDocumentRepository(),
  });
}

describe("local document service", () => {
  it("rejects unknown collections and invalid data before persistence", async () => {
    const service = createService();

    await expect(
      service.create({
        tenantId: tenantA,
        collection: "unknown",
        data: { title: "Draft", status: "draft", priority: 1 },
      }),
    ).rejects.toMatchObject({ code: "UNKNOWN_COLLECTION" });

    await expect(
      service.create({
        tenantId: tenantA,
        collection: "tasks",
        data: { title: "Draft", status: "invalid", priority: 1 },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("covers create, getById, list, update, patch, softDelete, restore, and hardDelete", async () => {
    const service = createService();
    const created = await service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      data: { title: "Draft", status: "draft", priority: 1, tags: [] },
    });

    expect(created.version).toBe(1);
    expect(created.schemaVersion).toBe(1);

    const updated = await service.update<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      id: created.id,
      expectedVersion: created.version,
      data: {
        title: "Submitted",
        status: "submitted",
        priority: 2,
        tags: ["review"],
      },
    });

    expect(updated.version).toBe(2);

    const patched = await service.patch<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      id: created.id,
      expectedVersion: updated.version,
      patch: [
        { op: "test", path: "/status", value: "submitted" },
        { op: "replace", path: "/status", value: "done" },
        { op: "add", path: "/tags/-", value: "closed" },
      ],
    });

    expect(patched.data).toMatchObject({
      status: "done",
      tags: ["review", "closed"],
    });

    const listed = await service.list<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      sort: [
        { field: { kind: "metadata", name: "createdAt" }, direction: "asc" },
      ],
    });

    expect(listed.items).toHaveLength(1);
    expect(listed.hasMore).toBe(false);

    const deleted = await service.softDelete({
      tenantId: tenantA,
      collection: "tasks",
      id: created.id,
      expectedVersion: patched.version,
    });

    expect(deleted.deletedAt).toBeInstanceOf(Date);
    await expect(
      service.getById({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
      }),
    ).resolves.toBeNull();

    const restored = await service.restore({
      tenantId: tenantA,
      collection: "tasks",
      id: created.id,
      expectedVersion: deleted.version,
    });

    expect(restored.deletedAt).toBeNull();

    await service.hardDelete({
      tenantId: tenantA,
      collection: "tasks",
      id: created.id,
      confirmHardDelete: true,
    });

    await expect(
      service.getById({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        includeDeleted: true,
      }),
    ).resolves.toBeNull();
  });

  it("enforces tenant isolation on reads and mutations", async () => {
    const service = createService();
    const created = await service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      data: { title: "Private", status: "draft", priority: 1, tags: [] },
    });

    await expect(
      service.getById({
        tenantId: tenantB,
        collection: "tasks",
        id: created.id,
      }),
    ).resolves.toBeNull();

    await expect(
      service.update<TaskDocument>({
        tenantId: tenantB,
        collection: "tasks",
        id: created.id,
        expectedVersion: created.version,
        data: { title: "Cross tenant", status: "done", priority: 5, tags: [] },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("supports JSONB-path filters, metadata filters, sorting, pagination bounds, and deleted inclusion", async () => {
    const service = createService();

    const low = await service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      data: {
        title: "Low",
        status: "draft",
        priority: 1,
        tags: [],
        nested: { score: 10, owner: "Ada" },
      },
    });
    await service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      data: {
        title: "High",
        status: "submitted",
        priority: 3,
        tags: [],
        nested: { score: 30, owner: "Grace" },
      },
    });
    await service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      data: {
        title: "Mid",
        status: "draft",
        priority: 2,
        tags: [],
        nested: { score: 20, owner: "Ada" },
      },
    });

    const filtered = await service.list<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      filter: {
        and: [
          {
            field: { kind: "data", path: ["nested", "owner"] },
            op: "eq",
            value: "Ada",
          },
          { field: { kind: "metadata", name: "version" }, op: "eq", value: 1 },
        ],
      },
      sort: [
        { field: { kind: "data", path: ["priority"] }, direction: "desc" },
      ],
      limit: 1,
    });

    expect(filtered.items.map((item) => item.data.title)).toEqual(["Mid"]);
    expect(filtered.hasMore).toBe(true);
    expect(filtered.limit).toBe(1);

    const bounded = await service.list<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      limit: 500,
    });
    expect(bounded.limit).toBe(100);

    const deleted = await service.softDelete({
      tenantId: tenantA,
      collection: "tasks",
      id: low.id,
      expectedVersion: low.version,
    });

    const withoutDeleted = await service.list<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
    });
    const withDeleted = await service.list<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      includeDeleted: true,
    });

    expect(withoutDeleted.items.some((item) => item.id === deleted.id)).toBe(
      false,
    );
    expect(withDeleted.items.some((item) => item.id === deleted.id)).toBe(true);
  });

  it("rejects stale version updates", async () => {
    const service = createService();
    const created = await service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      data: { title: "Draft", status: "draft", priority: 1, tags: [] },
    });

    await service.update<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      id: created.id,
      expectedVersion: created.version,
      data: { title: "Submitted", status: "submitted", priority: 2, tags: [] },
    });

    await expect(
      service.update<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        expectedVersion: created.version,
        data: { title: "Stale", status: "done", priority: 3, tags: [] },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT_STALE_VERSION" });
  });

  it("preserves JSON Patch RFC edge behavior", async () => {
    const service = createService();
    const created = await service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      data: { title: "Draft", status: "draft", priority: 1, tags: ["a"] },
    });

    const added = await service.patch<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      id: created.id,
      expectedVersion: created.version,
      patch: [{ op: "add", path: "/tags/0", value: "first" }],
    });

    expect(added.data.tags).toEqual(["first", "a"]);

    await expect(
      service.patch<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        expectedVersion: added.version,
        patch: [{ op: "replace", path: "/missing", value: "nope" }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await expect(
      service.patch<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        expectedVersion: added.version,
        patch: [{ op: "remove", path: "/missing" }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await expect(
      service.patch<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        expectedVersion: added.version,
        patch: [{ op: "test", path: "/status", value: "done" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT_PATCH_TEST_FAILED" });

    await expect(
      service.patch<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        id: created.id,
        expectedVersion: added.version,
        patch: [{ op: "copy", path: "/title", value: "nope" }],
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPERATION" });
  });

  it("exposes normalized document service errors", async () => {
    const service = createService();

    await expect(
      service.create({
        tenantId: tenantA,
        collection: "tasks",
        data: { title: "Draft", status: "invalid", priority: 1 },
      }),
    ).rejects.toBeInstanceOf(DocumentServiceError);
  });
});
