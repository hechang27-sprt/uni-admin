import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sql } from "kysely";
import { z } from "zod";

import {
  builtInAdminPermissions,
  buildPermissionKey,
  type AuthRbacService,
  type AuthRbacRepository,
} from "#server/auth/um";
import { migrateToLatest } from "#server/db/migrate";
import { CollectionRegistry, defineCollection } from "#server/data/collections";
import type {
  DocumentService,
  RemoteCollectionAdapter,
} from "#server/data/documents";
import { createServerContainer, SERVER_DI_TYPES } from "#server/di";
import type { CatalogService } from "#server/data/catalog";
import { tenantA, tenantB } from "./fixtures/service";
import { ADMIN_TENANT_OVERRIDE_KEY } from "#server/auth/um/repository";

const taskSchema = z.object({
  title: z.string(),
  status: z.enum(["draft", "submitted", "done"]),
});

type TaskDocument = z.infer<typeof taskSchema>;

describe("auth/RBAC service integration", () => {
  let database: ReturnType<typeof createInMemoryDb> | null = null;

  beforeAll(() => {
    database = createInMemoryDb();
  });

  beforeEach(async () => {
    const db = getTestDatabase();
    await migrateToLatest(db);
    await db
      .insertInto("tenants")
      .values([
        { id: tenantA, name: "Tenant A" },
        { id: tenantB, name: "Tenant B" },
      ])
      .execute();
  });

  afterEach(async () => {
    const db = getTestDatabase();
    await sql`drop schema if exists public cascade`.execute(db);
    await sql`create schema public`.execute(db);
  });

  afterAll(async () => {
    await database?.destroy();
    database = null;
  });

  it("authenticates username/password credentials and resolves tenant actors", async () => {
    const auth = createTestAuthService();
    const user = await auth.createUser({ displayName: "Ada" });
    await auth.setUsernamePasswordCredential({
      userId: user.userId,
      username: "ada",
      password: "correct horse battery staple",
    });
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });

    await expect(
      auth.verifyUsernamePassword({
        username: "ada",
        password: "wrong",
      }),
    ).resolves.toBeNull();
    await expect(
      auth.verifyUsernamePassword({
        username: "ada",
        password: "correct horse battery staple",
      }),
    ).resolves.toMatchObject({ userId: user.userId });
    await expect(
      auth.resolveActor({ tenantId: tenantA, userId: user.userId }),
    ).resolves.toEqual({
      tenantId: tenantA,
      actor: { userId: user.userId },
    });
    await expect(
      auth.resolveActor({ tenantId: tenantB, userId: user.userId }),
    ).rejects.toMatchObject({ code: "AUTH_TENANT_MEMBERSHIP_REQUIRED" });
  });
  it("rejects actor resolution after the user becomes inactive", async () => {
    const auth = createTestAuthService();
    const db = getTestDatabase();
    const user = await auth.createUser({ displayName: "Ada" });
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });

    await expect(
      auth.resolveActor({ tenantId: tenantA, userId: user.userId }),
    ).resolves.toEqual({
      tenantId: tenantA,
      actor: { userId: user.userId },
    });

    await db
      .updateTable("users")
      .set({ status: "inactive" })
      .where("userId", "=", user.userId)
      .execute();

    await expect(
      auth.resolveActor({ tenantId: tenantA, userId: user.userId }),
    ).rejects.toMatchObject({ code: "AUTH_TENANT_MEMBERSHIP_REQUIRED" });
  });
  it("resolves tenant-root collection auth declarations explicitly", () => {
    const registry = CollectionRegistry.fromRegistrations([
      {
        name: "tasks",
        schema: taskSchema,
        schemaVersion: 1,
        actions: {
          archive: {
            handler: () => {},
          },
        },
        auth: {
          resourceScope: "tenant-root",
          actions: {
            archive: {
              resourceScope: "tenant-root",
            },
          },
        },
      },
    ]);
    const collection = registry.get("tasks");

    expect(CollectionRegistry.resolveOperationAuth(collection, "read")).toEqual(
      {
        capability: "read",
        resourceScope: "tenant-root",
      },
    );
    expect(CollectionRegistry.resolveActionAuth(collection, "archive")).toEqual(
      {
        capability: "action-archive",
        resourceScope: "tenant-root",
      },
    );
  });
  it("resolves none collection auth declarations explicitly", () => {
    const registry = CollectionRegistry.fromRegistrations([
      {
        name: "tasks",
        schema: taskSchema,
        schemaVersion: 1,
        actions: {
          archive: {
            handler: () => {},
          },
        },
        auth: {
          resourceScope: "none",
          actions: {
            archive: {
              resourceScope: "none",
            },
          },
        },
      },
    ]);
    const collection = registry.get("tasks");

    expect(CollectionRegistry.resolveOperationAuth(collection, "read")).toEqual(
      {
        capability: "read",
        resourceScope: "none",
      },
    );
    expect(CollectionRegistry.resolveActionAuth(collection, "archive")).toEqual(
      {
        capability: "action-archive",
        resourceScope: "none",
      },
    );
  });

  it("defaults collection app and definition metadata", () => {
    const registry = CollectionRegistry.fromRegistrations([
      {
        name: "tasks",
        schema: taskSchema,
        schemaVersion: 1,
      },
    ]);

    expect(registry.get("tasks")).toMatchObject({
      appKey: "default",
      definitionKey: "tasks",
      name: "tasks",
    });
    expect(registry.has("tasks")).toBe(true);
    expect(registry.hasForApp("default", "tasks")).toBe(true);
  });

  it("rejects non-object collection schemas", () => {
    const invalidRegistration = {
      name: "tasks",
      schema: z.string(),
      schemaVersion: 1,
    };

    expect(() =>
      // @ts-expect-error Runtime validation still rejects untyped callers.
      CollectionRegistry.fromRegistrations([invalidRegistration]),
    ).toThrow(/schema/i);
  });
  it("rejects duplicate collection names within the same app", () => {
    expect(() =>
      CollectionRegistry.fromRegistrations([
        {
          appKey: "crm",
          name: "tasks",
          schema: taskSchema,
          schemaVersion: 1,
        },
        {
          appKey: "crm",
          name: "tasks",
          schema: taskSchema,
          schemaVersion: 2,
        },
      ]),
    ).toThrow(/collection/i);
  });

  it("allows duplicate collection names across different apps", () => {
    const registry = CollectionRegistry.fromRegistrations([
      {
        appKey: "crm",
        name: "tasks",
        definitionKey: "crm-tasks",
        schema: taskSchema,
        schemaVersion: 1,
      },
      {
        appKey: "ops",
        name: "tasks",
        definitionKey: "ops-tasks",
        schema: taskSchema,
        schemaVersion: 2,
      },
    ]);

    expect(registry.getForApp("crm", "tasks")).toMatchObject({
      appKey: "crm",
      definitionKey: "crm-tasks",
      schemaVersion: 1,
    });
    expect(registry.getForApp("ops", "tasks")).toMatchObject({
      appKey: "ops",
      definitionKey: "ops-tasks",
      schemaVersion: 2,
    });
    expect(registry.listForApp("crm")).toHaveLength(1);
  });

  it("derives distinct canonical permission keys for same collection key across apps", async () => {
    const registry = CollectionRegistry.fromRegistrations([
      {
        appKey: "crm",
        name: "tasks",
        definitionKey: "crm-tasks",
        schema: taskSchema,
        schemaVersion: 1,
      },
      {
        appKey: "ops",
        name: "tasks",
        definitionKey: "ops-tasks",
        schema: taskSchema,
        schemaVersion: 1,
      },
    ]);
    const auth = createTestAuthService();

    await auth.syncCollectionPermissions(registry);

    const rows = await getTestDatabase()
      .selectFrom("permissions")
      .innerJoin(
        "collections",
        "collections.collectionId",
        "permissions.collectionId",
      )
      .innerJoin("apps", "apps.appId", "permissions.appId")
      .select([
        "apps.appId",
        "apps.key as appKey",
        "collections.collectionId",
        "permissions.key",
      ])
      .where("collections.key", "=", "tasks")
      .where("permissions.capabilityId", "=", "read")
      .orderBy("apps.key")
      .execute();

    expect(rows).toHaveLength(2);
    expect(rows[0]!.appKey).toBe("crm");
    expect(rows[1]!.appKey).toBe("ops");
    expect(rows[0]!.key).not.toBe(rows[1]!.key);
    expect(rows[0]!.key).toBe(
      buildPermissionKey(rows[0]!.appId, rows[0]!.collectionId, "read"),
    );
    expect(rows[1]!.key).toBe(
      buildPermissionKey(rows[1]!.appId, rows[1]!.collectionId, "read"),
    );
  });
  it("persists collection permission resource scope metadata", async () => {
    const registry = CollectionRegistry.fromRegistrations([
      {
        name: "tasks",
        schema: taskSchema,
        schemaVersion: 1,
        actions: {
          archive: {
            handler: () => {},
          },
        },
        auth: {
          resourceScope: "none",
          actions: {
            archive: {
              resourceScope: "tenant-root",
            },
          },
        },
      },
    ]);
    const auth = createTestAuthService();

    await auth.syncCollectionPermissions(registry);

    const rows = await getTestDatabase()
      .selectFrom("permissions")
      .select(["capabilityId", "resourceScope"])
      .where("capabilityId", "in", ["read", "action-archive"])
      .orderBy("capabilityId")
      .execute();

    expect(rows).toEqual([
      { capabilityId: "action-archive", resourceScope: "tenant-root" },
      { capabilityId: "read", resourceScope: "none" },
    ]);
  });
  it("rejects unsafe collection keys and action names before deriving permissions", () => {
    expect(() =>
      CollectionRegistry.fromRegistrations([
        {
          name: "tasks",
          schema: taskSchema,
          schemaVersion: 1,
          actions: {
            "archive:read": {
              handler: () => {},
            },
          },
        },
      ]),
    ).toThrow(/action/i);

    expect(() =>
      CollectionRegistry.fromRegistrations([
        {
          key: "tasks:archive",
          schema: taskSchema,
          schemaVersion: 1,
        },
      ]),
    ).toThrow(/collection/i);
  });

  it("rejects action auth without a matching action callback", () => {
    expect(() =>
      CollectionRegistry.fromRegistrations([
        {
          name: "tasks",
          schema: taskSchema,
          schemaVersion: 1,
          actions: {
            archive: {
              handler: () => {},
            },
          },
          auth: {
            actions: {
              archive: {},
              approve: {},
            },
          },
        },
      ]),
    ).toThrow(/auth\.actions\.approve/i);
  });

  it("type-checks action auth keys against action callbacks", () => {
    const collection = defineCollection({
      name: "tasks",
      schema: taskSchema,
      schemaVersion: 1,
      actions: {
        archive: {
          handler: () => {},
        },
      },
      auth: {
        actions: {
          archive: {},
        },
      },
    });

    expect(CollectionRegistry.resolveActionAuth(collection, "archive")).toEqual(
      {
        capability: "action-archive",
        resourceScope: "document",
      },
    );

    expect(() =>
      defineCollection({
        name: "tasks",
        schema: taskSchema,
        schemaVersion: 1,
        actions: {
          archive: {
            handler: () => {},
          },
        },
        auth: {
          actions: {
            // @ts-expect-error Auth action keys must match action callbacks.
            approve: {},
          },
        },
      }),
    ).toThrow(/auth\.actions\.approve/i);
  });
  it("rejects built-in collection capability overrides", () => {
    expect(() =>
      CollectionRegistry.fromRegistrations([
        {
          name: "tasks",
          schema: taskSchema,
          schemaVersion: 1,
          auth: {
            // @ts-expect-error Capability ids are framework-defined for CRUD operations.
            read: { capability: "custom-duplicate" },
          },
        },
      ]),
    ).toThrow(/auth\.read/i);
  });

  it("rejects custom action capability overrides", () => {
    expect(() =>
      CollectionRegistry.fromRegistrations([
        {
          name: "tasks",
          schema: taskSchema,
          schemaVersion: 1,
          actions: {
            archive: {
              handler: () => {},
            },
          },
          auth: {
            actions: {
              // @ts-expect-error Action capability ids derive from action keys.
              archive: { capability: "custom-archive" },
            },
          },
        },
      ]),
    ).toThrow(/auth\.actions\.archive/i);
  });

  it("filters and mutates documents through resource-scoped role assignments", async () => {
    const { auth, service, permissionKeys } = await createTaskServiceWithAuth();
    const root = await auth.ensureTenantRootScope(tenantA);
    const deptA = await auth.createScope({
      tenantId: tenantA,
      parentScopeId: root.scopeId,
      type: "department",
      key: "dept-a",
      name: "Dept A",
    });
    const deptB = await auth.createScope({
      tenantId: tenantA,
      parentScopeId: root.scopeId,
      type: "department",
      key: "dept-b",
      name: "Dept B",
    });
    const user = await auth.createUser({ displayName: "Manager" });
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });
    const role = await auth.createRole({
      tenantId: tenantA,
      key: "dept-manager",
      name: "Department manager",
    });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: role.roleId,
      permissionKey: permissionKeys.read,
    });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: role.roleId,
      permissionKey: permissionKeys.update,
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: user.userId,
      roleId: role.roleId,
      scopeId: deptA.scopeId,
    });
    const serviceOptions = { actor: { userId: user.userId } };
    const deptATask = await service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      authScopeId: deptA.scopeId,
      data: { title: "A", status: "draft" },
    });
    const deptBTask = await service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      authScopeId: deptB.scopeId,
      data: { title: "B", status: "draft" },
    });
    await service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      data: { title: "Root", status: "draft" },
    });

    const listed = await service.list<TaskDocument>(
      {
        tenantId: tenantA,
        collection: "tasks",
      },
      serviceOptions,
    );
    expect(listed.items.map((item) => item.id)).toEqual([deptATask.id]);

    await expect(
      service.update<TaskDocument>(
        {
          tenantId: tenantA,
          collection: "tasks",
          id: deptATask.id,
          expectedVersion: deptATask.version,
          data: { title: "A done", status: "done" },
        },
        serviceOptions,
      ),
    ).resolves.toMatchObject({ data: { title: "A done" } });
    await expect(
      service.update<TaskDocument>(
        {
          tenantId: tenantA,
          collection: "tasks",
          id: deptBTask.id,
          expectedVersion: deptBTask.version,
          data: { title: "B done", status: "done" },
        },
        serviceOptions,
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("checks create target scope and exposes creatable document scopes", async () => {
    const { auth, service, permissionKeys } = await createTaskServiceWithAuth();
    const root = await auth.ensureTenantRootScope(tenantA);
    const child = await auth.createScope({
      tenantId: tenantA,
      parentScopeId: root.scopeId,
      type: "team",
      key: "team-a",
    });
    const user = await auth.createUser();
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });
    const role = await auth.createRole({ tenantId: tenantA, key: "creator" });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: role.roleId,
      permissionKey: permissionKeys.create,
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: user.userId,
      roleId: role.roleId,
      scopeId: root.scopeId,
    });
    const serviceOptions = { actor: { userId: user.userId } };

    await expect(
      service.create<TaskDocument>(
        {
          tenantId: tenantA,
          collection: "tasks",
          authScopeId: child.scopeId,
          data: { title: "Child", status: "draft" },
        },
        serviceOptions,
      ),
    ).resolves.toMatchObject({ authScopeId: child.scopeId });
    await expect(
      service.create<TaskDocument>(
        {
          tenantId: tenantA,
          collection: "tasks",
          data: { title: "Root", status: "draft" },
        },
        serviceOptions,
      ),
    ).resolves.toMatchObject({ authScopeId: null });
    await expect(
      service.listCreatableScopes(
        { tenantId: tenantA, collection: "tasks" },
        serviceOptions,
      ),
    ).resolves.toEqual([root.scopeId]);
  });
  it("authorizes bottom-scope collection access without exposing document scopes", async () => {
    const { auth, service, permissionKeys } = await createTaskServiceWithAuth({
      resourceScope: "none",
    });
    const root = await auth.ensureTenantRootScope(tenantA);
    const allowedUser = await auth.createUser();
    const deniedUser = await auth.createUser();
    await Promise.all([
      auth.createTenantMembership({ tenantId: tenantA, userId: allowedUser.userId }),
      auth.createTenantMembership({ tenantId: tenantA, userId: deniedUser.userId }),
    ]);
    const allowedRole = await auth.createRole({ tenantId: tenantA, key: "bottom-creator" });
    const deniedRole = await auth.createRole({ tenantId: tenantA, key: "root-only-creator" });
    await Promise.all(
      [allowedRole, deniedRole].map((role) =>
        auth.assignPermissionToRole({
          tenantId: tenantA,
          roleId: role.roleId,
          permissionKey: permissionKeys.create,
        }),
      ),
    );
    await auth.assignRole({
      tenantId: tenantA,
      userId: allowedUser.userId,
      roleId: allowedRole.roleId,
      scopeId: null,
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: deniedUser.userId,
      roleId: deniedRole.roleId,
      scopeId: root.scopeId,
    });

    const serviceOptions = { actor: { userId: allowedUser.userId } };
    await expect(
      service.create<TaskDocument>(
        {
          tenantId: tenantA,
          collection: "tasks",
          data: { title: "Bottom", status: "draft" },
        },
        serviceOptions,
      ),
    ).resolves.toMatchObject({ authScopeId: null });
    await expect(
      service.listCreatableScopes(
        { tenantId: tenantA, collection: "tasks" },
        serviceOptions,
      ),
    ).resolves.toEqual([]);

    await expect(
      service.create<TaskDocument>(
        {
          tenantId: tenantA,
          collection: "tasks",
          data: { title: "Denied root-only", status: "draft" },
        },
        { actor: { userId: deniedUser.userId } },
      ),
    ).resolves.toMatchObject({ authScopeId: null });
    await expect(
      service.listCreatableScopes(
        { tenantId: tenantA, collection: "tasks" },
        { actor: { userId: deniedUser.userId } },
      ),
    ).resolves.toEqual([]);
    
    await expect(
      service.listCreatableScopes(
        { tenantId: tenantA, collection: "tasks" },
        serviceOptions,
      ),
    ).resolves.toEqual([]);
  });

  it("authorizes protected document batches through one check per operation", async () => {
    const { auth, service, permissionKeys } = await createTaskServiceWithAuth();
    const evaluateAccess = vi.spyOn(auth, "evaluateAccess");
    const listGrantedScopeIdsForCapability = vi.spyOn(
      auth,
      "listGrantedScopeIdsForCapability",
    );
    const root = await auth.ensureTenantRootScope(tenantA);
    const [childA, childB] = await Promise.all([
      auth.createScope({
        tenantId: tenantA,
        parentScopeId: root.scopeId,
        type: "team",
        key: "batch-team-a",
      }),
      auth.createScope({
        tenantId: tenantA,
        parentScopeId: root.scopeId,
        type: "team",
        key: "batch-team-b",
      }),
    ]);
    const user = await auth.createUser();
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });
    const role = await auth.createRole({
      tenantId: tenantA,
      key: "batch-editor",
    });
    await Promise.all(
      [permissionKeys.create, permissionKeys.read, permissionKeys.update].map(
        (permissionKey) =>
          auth.assignPermissionToRole({
            tenantId: tenantA,
            roleId: role.roleId,
            permissionKey,
          }),
      ),
    );
    await auth.assignRole({
      tenantId: tenantA,
      userId: user.userId,
      roleId: role.roleId,
      scopeId: root.scopeId,
    });
    const options = { actor: { userId: user.userId } };

    evaluateAccess.mockClear();
    const created = await service.createMany<TaskDocument>(
      {
        tenantId: tenantA,
        collection: "tasks",
        items: [
          {
            authScopeId: childA.scopeId,
            data: { title: "A1", status: "draft" },
          },
          {
            authScopeId: childA.scopeId,
            data: { title: "A2", status: "draft" },
          },
          {
            authScopeId: childB.scopeId,
            data: { title: "B", status: "draft" },
          },
        ],
      },
      options,
    );
    expect(evaluateAccess).toHaveBeenCalledTimes(1);
    expect(evaluateAccess.mock.calls[0]![0].checks).toEqual([
      {
        capabilities: [permissionKeys.create],
        targetScopeIds: [childA.scopeId, childB.scopeId],
      },
    ]);

    evaluateAccess.mockClear();
    const readResult = await service.list<TaskDocument>(
      {
        tenantId: tenantA,
        collection: "tasks",
        ids: created.map((document) => document.id),
      },
      options,
    );
    expect(readResult.items).toHaveLength(3);
    expect(evaluateAccess).toHaveBeenCalledTimes(1);
    expect(evaluateAccess.mock.calls[0]![0].checks).toEqual([]);

    evaluateAccess.mockClear();
    listGrantedScopeIdsForCapability.mockClear();
    const updateAccessResult = await service.list<TaskDocument>(
      {
        tenantId: tenantA,
        collection: "tasks",
        ids: created.map((document) => document.id),
        operation: "update",
      },
      options,
    );
    expect(updateAccessResult.items).toHaveLength(3);
    expect(listGrantedScopeIdsForCapability).toHaveBeenCalledWith({
      context: { tenantId: tenantA, actor: { userId: user.userId } },
      capability: permissionKeys.update,
    });

    evaluateAccess.mockClear();
    const updated = await service.updateMany<TaskDocument>(
      {
        tenantId: tenantA,
        collection: "tasks",
        items: created.map((document) => ({
          id: document.id,
          expectedVersion: document.version,
          data: { title: `${document.data.title} done`, status: "done" },
        })),
      },
      options,
    );
    expect(updated).toHaveLength(3);
    expect(evaluateAccess).toHaveBeenCalledTimes(1);
    expect(evaluateAccess.mock.calls[0]![0].checks).toEqual([
      {
        capabilities: [permissionKeys.update],
        targetScopeIds: [childA.scopeId, childB.scopeId],
      },
    ]);

    const limitedUser = await auth.createUser();
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: limitedUser.userId,
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: limitedUser.userId,
      roleId: role.roleId,
      scopeId: childA.scopeId,
    });
    evaluateAccess.mockClear();
    await expect(
      service.updateMany<TaskDocument>(
        {
          tenantId: tenantA,
          collection: "tasks",
          items: [updated[0]!, updated[2]!].map((document) => ({
            id: document.id,
            expectedVersion: document.version,
            data: { title: "Denied", status: "done" },
          })),
        },
        { actor: { userId: limitedUser.userId } },
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(evaluateAccess).toHaveBeenCalledTimes(1);
    expect(evaluateAccess.mock.calls[0]![0].checks).toEqual([
      {
        capabilities: [permissionKeys.update],
        targetScopeIds: [updated[0]!.authScopeId, updated[2]!.authScopeId],
      },
    ]);
  });
  it("translates document-service tenant-root, document-null, and bottom targets before evaluation", async () => {
    const tenantRootSetup = await createTaskServiceWithAuth({
      resourceScope: "tenant-root",
    });
    const tenantRootEvaluateAccess = vi.spyOn(
      tenantRootSetup.auth,
      "evaluateAccess",
    );
    const root = await tenantRootSetup.auth.ensureTenantRootScope(tenantA);
    const user = await tenantRootSetup.auth.createUser();
    await tenantRootSetup.auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });
    const role = await tenantRootSetup.auth.createRole({
      tenantId: tenantA,
      key: "tenant-root-reader",
    });
    await tenantRootSetup.auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: role.roleId,
      permissionKey: tenantRootSetup.permissionKeys.read,
    });
    await tenantRootSetup.auth.assignRole({
      tenantId: tenantA,
      userId: user.userId,
      roleId: role.roleId,
      scopeId: root.scopeId,
    });

    const created = await tenantRootSetup.service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      data: { title: "tenant-root translation", status: "draft" },
    });
    expect(created.authScopeId).toBeNull();

    tenantRootEvaluateAccess.mockClear();
    await expect(
      tenantRootSetup.service.list<TaskDocument>(
        {
          tenantId: tenantA,
          collection: "tasks",
          ids: [created.id],
        },
        { actor: { userId: user.userId } },
      ),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: created.id, authScopeId: null })],
    });
    expect(tenantRootEvaluateAccess).toHaveBeenCalledTimes(1);
    expect(tenantRootEvaluateAccess.mock.calls[0]![0].checks).toEqual([
      {
        capabilities: [tenantRootSetup.permissionKeys.read],
        targetScopeIds: [root.scopeId],
      },
    ]);

    const documentSetup = await createTaskServiceWithAuth();
    const documentEvaluateAccess = vi.spyOn(documentSetup.auth, "evaluateAccess");
    const documentRoot = await documentSetup.auth.ensureTenantRootScope(tenantA);
    const documentUser = await documentSetup.auth.createUser();
    await documentSetup.auth.createTenantMembership({
      tenantId: tenantA,
      userId: documentUser.userId,
    });
    const documentRole = await documentSetup.auth.createRole({
      tenantId: tenantA,
      key: "document-root-updater",
    });
    await documentSetup.auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: documentRole.roleId,
      permissionKey: documentSetup.permissionKeys.update,
    });
    await documentSetup.auth.assignRole({
      tenantId: tenantA,
      userId: documentUser.userId,
      roleId: documentRole.roleId,
      scopeId: documentRoot.scopeId,
    });

    const documentCreated = await documentSetup.service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      data: { title: "document null translation", status: "draft" },
    });
    expect(documentCreated.authScopeId).toBeNull();

    documentEvaluateAccess.mockClear();
    await expect(
      documentSetup.service.update<TaskDocument>(
        {
          tenantId: tenantA,
          collection: "tasks",
          id: documentCreated.id,
          expectedVersion: documentCreated.version,
          data: { title: "document null translated", status: "done" },
        },
        { actor: { userId: documentUser.userId } },
      ),
    ).resolves.toMatchObject({ id: documentCreated.id, authScopeId: null });
    expect(documentEvaluateAccess).toHaveBeenCalledTimes(1);
    expect(documentEvaluateAccess.mock.calls[0]![0].checks).toEqual([
      {
        capabilities: [documentSetup.permissionKeys.update],
        targetScopeIds: [documentRoot.scopeId],
      },
    ]);

    const bottomSetup = await createTaskServiceWithAuth({ resourceScope: "none" });
    const bottomEvaluateAccess = vi.spyOn(bottomSetup.auth, "evaluateAccess");
    const bottomUser = await bottomSetup.auth.createUser();
    await bottomSetup.auth.createTenantMembership({
      tenantId: tenantA,
      userId: bottomUser.userId,
    });
    const bottomRole = await bottomSetup.auth.createRole({
      tenantId: tenantA,
      key: "bottom-reader-translation",
    });
    await bottomSetup.auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: bottomRole.roleId,
      permissionKey: bottomSetup.permissionKeys.read,
    });
    await bottomSetup.auth.assignRole({
      tenantId: tenantA,
      userId: bottomUser.userId,
      roleId: bottomRole.roleId,
      scopeId: null,
    });

    const bottomCreated = await bottomSetup.service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      data: { title: "bottom translation", status: "draft" },
    });
    expect(bottomCreated.authScopeId).toBeNull();

    bottomEvaluateAccess.mockClear();
    await expect(
      bottomSetup.service.list<TaskDocument>(
        {
          tenantId: tenantA,
          collection: "tasks",
          ids: [bottomCreated.id],
        },
        { actor: { userId: bottomUser.userId } },
      ),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: bottomCreated.id, authScopeId: null })],
    });
    expect(bottomEvaluateAccess).toHaveBeenCalledTimes(1);
    expect(bottomEvaluateAccess.mock.calls[0]![0].checks).toEqual([
      {
        capabilities: [bottomSetup.permissionKeys.read],
        targetScopeIds: [null],
      },
    ]);
  });

  it("rejects trusted document writes with cross-tenant auth scopes", async () => {
    const { auth, service } = await createTaskServiceWithAuth();
    await auth.ensureTenantRootScope(tenantA);
    const tenantBRoot = await auth.ensureTenantRootScope(tenantB);

    await expect(
      service.create<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        authScopeId: tenantBRoot.scopeId,
        data: { title: "Wrong tenant", status: "draft" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_SCOPE" });

    await expect(
      service.createMany<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        items: [
          {
            data: { title: "Root", status: "draft" },
          },
          {
            authScopeId: tenantBRoot.scopeId,
            data: { title: "Wrong tenant batch", status: "draft" },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_SCOPE" });
    await expect(
      service.list<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
      }),
    ).resolves.toMatchObject({ items: [] });

    const created = await service.createMany<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      items: [
        { data: { title: "Local A", status: "draft" } },
        { data: { title: "Local B", status: "draft" } },
      ],
    });

    const initialRead = await service.list<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      ids: created.map((document) => document.id),
    });
    expect(initialRead.items).toEqual([
      expect.objectContaining({ authScopeId: null }),
      expect.objectContaining({ authScopeId: null }),
    ]);

    const owner = await auth.bootstrapTenantOwner({
      tenantId: tenantA,
      username: "owner@example.com",
      password: "correct horse battery staple",
    });
    await expect(
      service.setDocumentAuthScope(
        {
          tenantId: tenantA,
          collection: "tasks",
          id: created[0]!.id,
          expectedVersion: created[0]!.version,
          authScopeId: tenantBRoot.scopeId,
        },
        { actor: owner.context.actor },
      ),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_SCOPE" });
    const afterRejectedScope = await service.list<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      ids: created.map((document) => document.id),
    });
    expect(afterRejectedScope.items).toEqual([
      expect.objectContaining({ authScopeId: null }),
      expect.objectContaining({ authScopeId: null }),
    ]);

    const calls = { syncOne: 0 };
    const adapter: RemoteCollectionAdapter<
      TaskDocument,
      Record<string, never>
    > = {
      remoteSource: "invalid-scope-fixture",
      async syncOne() {
        calls.syncOne += 1;
        return {
          projection: {
            remoteId: "wrong-scope",
            authScopeId: tenantBRoot.scopeId,
            data: { title: "Remote", status: "draft" },
          },
        };
      },
      async syncList() {
        return { projections: [] };
      },
      async createRemote() {
        throw new Error("not used");
      },
      async updateRemote() {
        throw new Error("not used");
      },
      async deleteRemote() {
        throw new Error("not used");
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
    await auth.syncCollectionPermissions(registry);
    const remoteContainer = createTestContainer(registry);
    const remoteAuth = remoteContainer.get<AuthRbacService>(
      SERVER_DI_TYPES.AuthRbacService,
    );
    await remoteAuth.syncCollectionPermissions(registry);
    const remoteCatalog = remoteContainer.get<CatalogService>(
      SERVER_DI_TYPES.CatalogService,
    );
    await remoteCatalog.enableTenantApp({ tenantId: tenantA });
    const remoteService = remoteContainer.get<DocumentService>(
      SERVER_DI_TYPES.DocumentService,
    );
    await expect(
      remoteService.syncRemoteOne<TaskDocument, Record<string, never>>({
        tenantId: tenantA,
        collection: "remote-tasks",
        input: {},
      }),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_SCOPE" });
    expect(calls.syncOne).toBe(1);
    await expect(
      remoteService.list<TaskDocument>({
        tenantId: tenantA,
        collection: "remote-tasks",
      }),
    ).resolves.toMatchObject({ items: [] });
  });

  it("validates direct grants and assignments at the service boundary", async () => {
    const container = createTestContainer();
    const repository = container.get<AuthRbacRepository>(
      SERVER_DI_TYPES.AuthRbacRepository,
    );
    const grantPermissions = vi.spyOn(repository, "assignPermissionsToRole");
    const assignRoles = vi.spyOn(repository, "assignRoles");
    const auth = container.get<AuthRbacService>(
      SERVER_DI_TYPES.AuthRbacService,
    );
    const [tenantARoot, tenantBRoot] = await Promise.all([
      auth.ensureTenantRootScope(tenantA),
      auth.ensureTenantRootScope(tenantB),
    ]);
    const [tenantARole, tenantBRole] = await Promise.all([
      auth.createRole({ tenantId: tenantA, key: "tenant-a-role" }),
      auth.createRole({ tenantId: tenantB, key: "tenant-b-role" }),
    ]);
    const [member, noMembership] = await Promise.all([
      auth.createUser(),
      auth.createUser(),
    ]);
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: member.userId,
    });
    await auth.syncPermissions([
      { key: "collection:tasks:read", source: "tasks" },
    ]);

    grantPermissions.mockClear();
    await expect(
      auth.assignPermissionToRole({
        tenantId: tenantA,
        roleId: tenantARole.roleId,
        permissionKey: "collection:tasks:write",
      }),
    ).rejects.toMatchObject({
      code: "AUTH_PERMISSION_NOT_FOUND",
      details: { permissionKey: "collection:tasks:write" },
    });
    expect(grantPermissions).not.toHaveBeenCalled();

    grantPermissions.mockClear();

    await expect(
      auth.assignPermissionToRole({
        tenantId: tenantA,
        roleId: tenantBRole.roleId,
        permissionKey: "collection:tasks:read",
      }),
    ).rejects.toMatchObject({ code: "AUTH_ROLE_NOT_FOUND" });
    expect(grantPermissions).not.toHaveBeenCalled();

    assignRoles.mockClear();
    await expect(
      auth.assignRole({
        tenantId: tenantA,
        userId: noMembership.userId,
        roleId: tenantARole.roleId,
        scopeId: tenantARoot.scopeId,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_TENANT_MEMBERSHIP_REQUIRED",
      details: { userId: noMembership.userId },
    });
    expect(assignRoles).not.toHaveBeenCalled();

    await expect(
      auth.assignRole({
        tenantId: tenantA,
        userId: member.userId,
        roleId: tenantBRole.roleId,
        scopeId: tenantARoot.scopeId,
      }),
    ).rejects.toMatchObject({ code: "AUTH_ROLE_NOT_FOUND" });
    expect(assignRoles).not.toHaveBeenCalled();

    await expect(
      auth.assignRole({
        tenantId: tenantA,
        userId: member.userId,
        roleId: tenantARole.roleId,
        scopeId: tenantBRoot.scopeId,
      }),
    ).rejects.toMatchObject({ code: "AUTH_SCOPE_NOT_FOUND" });
    expect(assignRoles).not.toHaveBeenCalled();
  });

  it("rejects list-grant requests without membership", async () => {
    const auth = createTestAuthService();
    const user = await auth.createUser();

    await expect(
      auth.listGrantedScopeIdsForCapability({
        context: { tenantId: tenantA, actor: { userId: user.userId } },
        capability: "collection:tasks:read",
      }),
    ).rejects.toMatchObject({ code: "AUTH_TENANT_MEMBERSHIP_REQUIRED" });

    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });
    await expect(
      auth.listGrantedScopeIdsForCapability({
        context: { tenantId: tenantA, actor: { userId: user.userId } },
        capability: "collection:tasks:read",
      }),
    ).rejects.toMatchObject({ code: "AUTH_PERMISSION_NOT_FOUND" });
  });

  it("preserves bottom grants as bottom in the grant-list API", async () => {
    const auth = createTestAuthService();
    await auth.syncPermissions([
      { key: "collection:tasks:read", source: "tasks" },
    ]);
    const user = await auth.createUser();
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });
    const role = await auth.createRole({ tenantId: tenantA, key: "bottom-reader" });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: role.roleId,
      permissionKey: "collection:tasks:read",
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: user.userId,
      roleId: role.roleId,
      scopeId: null,
    });

    await expect(
      auth.listGrantedScopeIdsForCapability({
        context: { tenantId: tenantA, actor: { userId: user.userId } },
        capability: "collection:tasks:read",
      }),
    ).resolves.toEqual([null]);
  });

  it("returns concrete grant scopes for scoped roles", async () => {
    const auth = createTestAuthService();
    await auth.syncPermissions([
      { key: "collection:tasks:read", source: "tasks" },
    ]);
    const root = await auth.ensureTenantRootScope(tenantA);
    const child = await auth.createScope({
      tenantId: tenantA,
      parentScopeId: root.scopeId,
      type: "department",
      key: "dept-a",
      name: "Dept A",
    });
    const user = await auth.createUser();
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });
    const role = await auth.createRole({ tenantId: tenantA, key: "reader" });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: role.roleId,
      permissionKey: "collection:tasks:read",
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: user.userId,
      roleId: role.roleId,
      scopeId: child.scopeId,
    });

    await expect(
      auth.listGrantedScopeIdsForCapability({
        context: { tenantId: tenantA, actor: { userId: user.userId } },
        capability: "collection:tasks:read",
      }),
    ).resolves.toEqual([child.scopeId]);
  });

  it("returns concrete root grants unchanged and keeps document list semantics separate", async () => {
    const auth = createTestAuthService();
    await auth.syncPermissions([
      { key: "collection:tasks:read", source: "tasks" },
    ]);
    const root = await auth.ensureTenantRootScope(tenantA);
    await auth.createScope({
      tenantId: tenantA,
      parentScopeId: root.scopeId,
      type: "department",
      key: "dept-a",
      name: "Dept A",
    });
    const user = await auth.createUser();
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });
    const role = await auth.createRole({ tenantId: tenantA, key: "reader" });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: role.roleId,
      permissionKey: "collection:tasks:read",
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: user.userId,
      roleId: role.roleId,
      scopeId: root.scopeId,
    });

    await expect(
      auth.listGrantedScopeIdsForCapability({
        context: { tenantId: tenantA, actor: { userId: user.userId } },
        capability: "collection:tasks:read",
      }),
    ).resolves.toEqual([root.scopeId]);

    await expect(
      auth.listCreatableDocumentScopeIds({
        context: { tenantId: tenantA, actor: { userId: user.userId } },
        capability: "collection:tasks:read",
      }),
    ).resolves.toEqual([root.scopeId]);
  });
  it("distinguishes tenant-root and bottom targets in repository capability checks", async () => {
    const auth = createTestAuthService();
    await auth.syncPermissions([
      { key: "collection:tasks:create", source: "tasks" },
    ]);
    const root = await auth.ensureTenantRootScope(tenantA);
    const child = await auth.createScope({
      tenantId: tenantA,
      parentScopeId: root.scopeId,
      type: "department",
      key: "repo-bottom-child",
      name: "Repo Bottom Child",
    });
    const rootOnlyUser = await auth.createUser();
    const bottomOnlyUser = await auth.createUser();
    const childOnlyUser = await auth.createUser();
    await Promise.all(
      [rootOnlyUser, bottomOnlyUser, childOnlyUser].map((user) =>
        auth.createTenantMembership({
          tenantId: tenantA,
          userId: user.userId,
        }),
      ),
    );
    const rootRole = await auth.createRole({ tenantId: tenantA, key: "root-grant" });
    const bottomRole = await auth.createRole({
      tenantId: tenantA,
      key: "bottom-grant",
    });
    const childRole = await auth.createRole({ tenantId: tenantA, key: "child-grant" });
    await Promise.all(
      [rootRole, bottomRole, childRole].map((role) =>
        auth.assignPermissionToRole({
          tenantId: tenantA,
          roleId: role.roleId,
          permissionKey: "collection:tasks:create",
        }),
      ),
    );
    await auth.assignRole({
      tenantId: tenantA,
      userId: rootOnlyUser.userId,
      roleId: rootRole.roleId,
      scopeId: root.scopeId,
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: bottomOnlyUser.userId,
      roleId: bottomRole.roleId,
      scopeId: null,
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: childOnlyUser.userId,
      roleId: childRole.roleId,
      scopeId: child.scopeId,
    });

    const container = createTestContainer();
    const repository = container.get<AuthRbacRepository>(
      SERVER_DI_TYPES.AuthRbacRepository,
    );

    await expect(
      repository.checkCapabilities({
        tenantId: tenantA,
        checks: [
          {
            userId: rootOnlyUser.userId,
            capabilities: ["collection:tasks:create"],
            targetScopeIds: [root.scopeId],
          },
          {
            userId: bottomOnlyUser.userId,
            capabilities: ["collection:tasks:create"],
            targetScopeIds: [root.scopeId],
          },
          {
            userId: childOnlyUser.userId,
            capabilities: ["collection:tasks:create"],
            targetScopeIds: [root.scopeId],
          },
        ],
      }),
    ).resolves.toEqual([
      {
        userId: rootOnlyUser.userId,
        allowed: true,
        hasOverride: false,
        missingCaps: [],
      },
      {
        userId: bottomOnlyUser.userId,
        allowed: false,
        hasOverride: false,
        missingCaps: [
          {
            capability: "collection:tasks:create",
            permissionKey: "collection:tasks:create",
            roleId: null,
            targetScopeId: root.scopeId,
          },
        ],
      },
      {
        userId: childOnlyUser.userId,
        allowed: false,
        hasOverride: false,
        missingCaps: [
          {
            capability: "collection:tasks:create",
            permissionKey: "collection:tasks:create",
            roleId: null,
            targetScopeId: root.scopeId,
          },
        ],
      },
    ]);

    await expect(
      repository.checkCapabilities({
        tenantId: tenantA,
        checks: [
          {
            userId: rootOnlyUser.userId,
            capabilities: ["collection:tasks:create"],
            targetScopeIds: [null],
          },
          {
            userId: bottomOnlyUser.userId,
            capabilities: ["collection:tasks:create"],
            targetScopeIds: [null],
          },
          {
            userId: childOnlyUser.userId,
            capabilities: ["collection:tasks:create"],
            targetScopeIds: [null],
          },
        ],
      }),
    ).resolves.toEqual([
      {
        userId: rootOnlyUser.userId,
        allowed: true,
        hasOverride: false,
        missingCaps: [],
      },
      {
        userId: bottomOnlyUser.userId,
        allowed: true,
        hasOverride: false,
        missingCaps: [],
      },
      {
        userId: childOnlyUser.userId,
        allowed: true,
        hasOverride: false,
        missingCaps: [],
      },
    ]);
  });
  it("keeps bottom-scope grants distinct from tenant-root list semantics", async () => {
    const auth = createTestAuthService();
    await auth.syncPermissions([
      { key: "collection:tasks:read", source: "tasks" },
    ]);
    const user = await auth.createUser();
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });
    const role = await auth.createRole({ tenantId: tenantA, key: "bottom-reader" });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: role.roleId,
      permissionKey: "collection:tasks:read",
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: user.userId,
      roleId: role.roleId,
      scopeId: null,
    });

    await expect(
      auth.listGrantedScopeIdsForCapability({
        context: { tenantId: tenantA, actor: { userId: user.userId } },
        capability: "collection:tasks:read",
      }),
    ).resolves.toEqual([null]);

    await expect(
      auth.listGrantedScopeIdsForCapability({
        context: { tenantId: tenantA, actor: { userId: user.userId } },
        capability: "collection:tasks:read",
      }),
    ).resolves.toEqual([null]);
  });

  it("validates delegated role assignee membership before repository assignment", async () => {
    const container = createTestContainer();
    const repository = container.get<AuthRbacRepository>(
      SERVER_DI_TYPES.AuthRbacRepository,
    );
    const assignRoles = vi.spyOn(repository, "assignRoles");
    const auth = container.get<AuthRbacService>(
      SERVER_DI_TYPES.AuthRbacService,
    );
    await auth.syncPermissions(builtInAdminPermissions);
    const root = await auth.ensureTenantRootScope(tenantA);
    const actor = await auth.createUser();
    const target = await auth.createUser();
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: actor.userId,
    });
    const admin = await auth.createRole({
      tenantId: tenantA,
      key: "assignment-admin",
    });
    const assigned = await auth.createRole({
      tenantId: tenantA,
      key: "assigned-without-membership",
    });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: admin.roleId,
      permissionKey: "admin:role-assignments:assign",
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: actor.userId,
      roleId: admin.roleId,
      scopeId: root.scopeId,
    });

    assignRoles.mockClear();
    await expect(
      auth.assignRoleAsActor(
        { tenantId: tenantA, actor: { userId: actor.userId } },
        {
          userId: target.userId,
          roleId: assigned.roleId,
          scopeId: root.scopeId,
        },
      ),
    ).rejects.toMatchObject({ code: "AUTH_TENANT_MEMBERSHIP_REQUIRED" });
    expect(assignRoles).not.toHaveBeenCalled();
  });

  it("bootstraps owner grants through one bulk repository operation", async () => {
    const container = createTestContainer();
    const repository = container.get<AuthRbacRepository>(
      SERVER_DI_TYPES.AuthRbacRepository,
    );
    const grantPermissions = vi.spyOn(repository, "assignPermissionsToRole");
    const auth = container.get<AuthRbacService>(
      SERVER_DI_TYPES.AuthRbacService,
    );
    const owner = await auth.bootstrapTenantOwner({
      tenantId: tenantA,
      username: "owner",
      password: "secure owner password",
    });

    expect(grantPermissions).toHaveBeenCalledTimes(1);
    expect(grantPermissions.mock.calls[0]![0].permissionKeys).toEqual(
      builtInAdminPermissions.map((permission) => permission.key),
    );
    await expect(
      auth.evaluateAccess({
        ...owner.context,
        checks: builtInAdminPermissions.map((permission) => ({
          capabilities: [permission.key],
          targetScopeIds: [owner.rootScope.scopeId],
        })),
      }),
    ).resolves.toHaveProperty("allowed", true);
  });

  it("checks delegated assignment capabilities through access evaluation", async () => {
    const container = createTestContainer();
    const repository = container.get<AuthRbacRepository>(
      SERVER_DI_TYPES.AuthRbacRepository,
    );
    const checkCapabilities = vi.spyOn(repository, "checkCapabilities");
    const auth = container.get<AuthRbacService>(
      SERVER_DI_TYPES.AuthRbacService,
    );
    await auth.syncPermissions([
      { key: ADMIN_TENANT_OVERRIDE_KEY, source: "admin" },
      { key: "admin:role-assignments:assign", source: "admin" },
      { key: "collection:tasks:read", source: "tasks" },
      { key: "collection:tasks:delete", source: "tasks" },
    ]);
    const root = await auth.ensureTenantRootScope(tenantA);
    const child = await auth.createScope({
      tenantId: tenantA,
      parentScopeId: root.scopeId,
      type: "team",
      key: "delegated-team",
    });
    const actor = await auth.createUser();
    const target = await auth.createUser();
    await Promise.all([
      auth.createTenantMembership({ tenantId: tenantA, userId: actor.userId }),
      auth.createTenantMembership({ tenantId: tenantA, userId: target.userId }),
    ]);
    const delegator = await auth.createRole({
      tenantId: tenantA,
      key: "delegator",
    });
    const escalated = await auth.createRole({
      tenantId: tenantA,
      key: "escalated",
    });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: delegator.roleId,
      permissionKey: "admin:role-assignments:assign",
    });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: delegator.roleId,
      permissionKey: "collection:tasks:read",
    });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: escalated.roleId,
      permissionKey: "collection:tasks:read",
    });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: escalated.roleId,
      permissionKey: "collection:tasks:delete",
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: actor.userId,
      roleId: delegator.roleId,
      scopeId: root.scopeId,
    });

    checkCapabilities.mockClear();
    await expect(
      auth.assignRoleAsActor(
        { tenantId: tenantA, actor: { userId: actor.userId } },
        {
          userId: target.userId,
          roleId: escalated.roleId,
          scopeId: child.scopeId,
        },
      ),
    ).rejects.toMatchObject({ code: "AUTH_PERMISSION_DENIED" });
    expect(checkCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenantA,
        userId: actor.userId,
        checks: [
          {
            capabilities: ["admin:role-assignments:assign"],
            roleIds: [escalated.roleId],
            override: ADMIN_TENANT_OVERRIDE_KEY,
            targetScopeIds: [child.scopeId],
          },
        ],
      }),
    );
    const deniedEval = await repository.checkCapabilities({
      tenantId: tenantA,
      checks: [
        {
          userId: actor.userId,
          capabilities: ["admin:role-assignments:assign"],
          roleIds: [escalated.roleId],
          override: ADMIN_TENANT_OVERRIDE_KEY,
          targetScopeIds: [child.scopeId],
        },
      ],
    });
    expect(deniedEval).toEqual([
      {
        userId: actor.userId,
        allowed: false,
        hasOverride: false,
        missingCaps: [
          {
            capability: "collection:tasks:delete",
            permissionKey: "collection:tasks:delete",
            roleId: escalated.roleId,
            targetScopeId: child.scopeId,
          },
        ],
      },
    ]);
    expect(
      checkCapabilities.mock.calls.some(([input]) =>
        input.checks.some((check) =>
          check.capabilities?.some?.((key) =>
            key.startsWith("collection:tasks:"),
          ),
        ),
      ),
    ).toBe(false);

    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: delegator.roleId,
      permissionKey: "collection:tasks:delete",
    });
    checkCapabilities.mockClear();
    await expect(
      auth.assignRoleAsActor(
        { tenantId: tenantA, actor: { userId: actor.userId } },
        {
          userId: target.userId,
          roleId: escalated.roleId,
          scopeId: child.scopeId,
        },
      ),
    ).resolves.toBeUndefined();
    expect(checkCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenantA,
        userId: actor.userId,
        checks: [
          {
            capabilities: ["admin:role-assignments:assign"],
            roleIds: [escalated.roleId],
            override: ADMIN_TENANT_OVERRIDE_KEY,
            targetScopeIds: [child.scopeId],
          },
        ],
      }),
    );
    const allowedEval = await repository.checkCapabilities({
      tenantId: tenantA,
      checks: [
        {
          userId: actor.userId,
          capabilities: ["admin:role-assignments:assign"],
          roleIds: [escalated.roleId],
          override: ADMIN_TENANT_OVERRIDE_KEY,
          targetScopeIds: [child.scopeId],
        },
      ],
    });
    expect(allowedEval).toEqual([
      {
        userId: actor.userId,
        allowed: true,
        hasOverride: false,
        missingCaps: [],
      },
    ]);
  });

  it("denies remote writes before adapter side effects", async () => {
    const calls = { updateRemote: 0 };
    const adapter: RemoteCollectionAdapter<
      TaskDocument,
      never,
      never,
      never,
      Partial<TaskDocument>
    > = {
      remoteSource: "remote",
      async syncOne() {
        return { projection: null };
      },
      async syncList() {
        return { projections: [] };
      },
      async createRemote() {
        throw new Error("not used");
      },
      async updateRemote(input, context) {
        calls.updateRemote += 1;
        return {
          projection: {
            remoteId: context.current.remoteId ?? "remote-1",
            data: { ...context.current.data, ...input },
          },
        };
      },
      async deleteRemote() {
        throw new Error("not used");
      },
    };
    const registry = CollectionRegistry.fromRegistrations([
      {
        name: "tasks",
        schema: taskSchema,
        schemaVersion: 1,
        remoteAdapter: adapter,
      },
    ]);
    const container = createTestContainer(registry);
    const auth = container.get<AuthRbacService>(
      SERVER_DI_TYPES.AuthRbacService,
    );
    await auth.syncCollectionPermissions(registry);
    const catalog1349 = container.get<CatalogService>(
      SERVER_DI_TYPES.CatalogService,
    );
    await catalog1349.enableTenantApp({ tenantId: tenantA });
    const service = container.get<DocumentService>(
      SERVER_DI_TYPES.DocumentService,
    );
    const root = await auth.ensureTenantRootScope(tenantA);
    const user = await auth.createUser();
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });
    const readKey = await findPermissionKey("read");
    const reader = await auth.createRole({ tenantId: tenantA, key: "reader" });
    await auth.assignPermissionToRole({
      tenantId: tenantA,
      roleId: reader.roleId,
      permissionKey: readKey,
    });
    await auth.assignRole({
      tenantId: tenantA,
      userId: user.userId,
      roleId: reader.roleId,
      scopeId: root.scopeId,
    });
    const created = await service.create<TaskDocument>({
      tenantId: tenantA,
      collection: "tasks",
      remoteSource: "remote",
      remoteId: "remote-1",
      data: { title: "Remote", status: "draft" },
    });

    await expect(
      service.remoteUpdate<TaskDocument, Partial<TaskDocument>>(
        {
          tenantId: tenantA,
          collection: "tasks",
          id: created.id,
          expectedVersion: created.version,
          input: { status: "done" },
        },
        { actor: { userId: user.userId } },
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(calls.updateRemote).toBe(0);
  });

  async function createTaskServiceWithAuth(input?: {
    resourceScope?: "document" | "tenant-root" | "none";
  }): Promise<{
    auth: AuthRbacService;
    service: DocumentService;
    permissionKeys: Record<"create" | "read" | "update" | "delete", string>;
  }> {
    const registry = CollectionRegistry.fromRegistrations([
      {
        name: "tasks",
        schema: taskSchema,
        schemaVersion: 1,
        auth: input?.resourceScope
          ? { resourceScope: input.resourceScope }
          : undefined,
      },
    ]);
    const container = createTestContainer(registry);
    const auth = container.get<AuthRbacService>(
      SERVER_DI_TYPES.AuthRbacService,
    );
    await auth.syncCollectionPermissions(registry);
    const catalog = container.get<CatalogService>(
      SERVER_DI_TYPES.CatalogService,
    );
    await catalog.enableTenantApp({ tenantId: tenantA });
    await catalog.enableTenantApp({ tenantId: tenantB });

    return {
      auth,
      service: container.get<DocumentService>(SERVER_DI_TYPES.DocumentService),
      permissionKeys: {
        create: await findPermissionKey("create"),
        read: await findPermissionKey("read"),
        update: await findPermissionKey("update"),
        delete: await findPermissionKey("delete"),
      },
    };
  }

  async function findPermissionKey(capabilityId: string): Promise<string> {
    const row = await getTestDatabase()
      .selectFrom("permissions")
      .select("key")
      .where("capabilityId", "=", capabilityId)
      .executeTakeFirstOrThrow();
    return row.key;
  }

  function createTestAuthService() {
    return createTestContainer().get<AuthRbacService>(
      SERVER_DI_TYPES.AuthRbacService,
    );
  }

  function createTestContainer(
    registry = CollectionRegistry.fromRegistrations([]),
  ): ReturnType<typeof createServerContainer> {
    return createServerContainer({
      database: getTestDatabase(),
      registry,
    });
  }

  function getTestDatabase(): ReturnType<typeof createInMemoryDb> {
    if (!database) {
      throw new Error("Test database has not been initialized");
    }

    return database;
  }
});
