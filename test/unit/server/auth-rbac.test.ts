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
  KyselyAuthRbacRepository,
  AuthRbacService,
  builtInAdminPermissions,
} from "#server/auth";
import { migrateToLatest } from "#server/db/migrate";
import { createInMemoryDb } from "#server/util/kysely";
import {
  KyselyDocumentRepository,
  createCollectionRegistry,
  DocumentService,
  type RemoteCollectionAdapter,
} from "#server/data/documents";
import { tenantA, tenantB } from "./fixtures/service";

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

  it("filters and mutates documents through resource-scoped role assignments", async () => {
    const auth = createTestAuthService();
    const { service } = await createTaskServiceWithAuth(auth);
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
    await auth.grantPermission({
      tenantId: tenantA,
      roleId: role.roleId,
      permissionKey: "collection:tasks:read",
    });
    await auth.grantPermission({
      tenantId: tenantA,
      roleId: role.roleId,
      permissionKey: "collection:tasks:update",
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
    const auth = createTestAuthService();
    const { service } = await createTaskServiceWithAuth(auth);
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
    await auth.grantPermission({
      tenantId: tenantA,
      roleId: role.roleId,
      permissionKey: "collection:tasks:create",
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
    ).resolves.toEqual(expect.arrayContaining([null, child.scopeId]));
  });

  it("authorizes protected document batches through one check per operation", async () => {
    const auth = createTestAuthService();
    const checkAccessMany = vi.spyOn(auth, "checkAccessMany");
    const { service } = await createTaskServiceWithAuth(auth);
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
      [
        "collection:tasks:create",
        "collection:tasks:read",
        "collection:tasks:update",
      ].map((permissionKey) =>
        auth.grantPermission({
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

    checkAccessMany.mockClear();
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
    expect(checkAccessMany).toHaveBeenCalledTimes(1);
    expect(checkAccessMany.mock.calls[0]![0].checks).toHaveLength(2);

    checkAccessMany.mockClear();
    await expect(
      service.getByIds<TaskDocument>(
        {
          tenantId: tenantA,
          collection: "tasks",
          ids: created.map((document) => document.id),
        },
        options,
      ),
    ).resolves.toHaveLength(3);
    expect(checkAccessMany).toHaveBeenCalledTimes(1);
    expect(checkAccessMany.mock.calls[0]![0].checks).toHaveLength(2);

    checkAccessMany.mockClear();
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
    expect(checkAccessMany).toHaveBeenCalledTimes(1);
    expect(checkAccessMany.mock.calls[0]![0].checks).toHaveLength(2);

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
    checkAccessMany.mockClear();
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
    expect(checkAccessMany).toHaveBeenCalledTimes(1);
    expect(checkAccessMany.mock.calls[0]![0].checks).toHaveLength(2);
  });

  it("rejects trusted document writes with cross-tenant auth scopes", async () => {
    const auth = createTestAuthService();
    const { service } = await createTaskServiceWithAuth(auth);
    const repository = new KyselyDocumentRepository(getTestDatabase());
    const tenantARoot = await auth.ensureTenantRootScope(tenantA);
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

    await expect(
      repository.updateMany<TaskDocument>({
        tenantId: tenantA,
        records: [
          {
            collection: "tasks",
            id: created[0]!.id,
            expectedVersion: created[0]!.version,
            authScopeId: tenantARoot.scopeId,
          },
          {
            collection: "tasks",
            id: created[1]!.id,
            expectedVersion: created[1]!.version,
            authScopeId: tenantBRoot.scopeId,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_SCOPE" });
    await expect(
      service.getByIds<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        ids: created.map((document) => document.id),
      }),
    ).resolves.toEqual([
      expect.objectContaining({ authScopeId: null }),
      expect.objectContaining({ authScopeId: null }),
    ]);

    await expect(
      repository.upsertRemoteProjections<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        schemaVersion: 1,
        remoteSource: "remote",
        projections: [
          {
            remoteId: "valid-scope",
            authScopeId: tenantARoot.scopeId,
            data: { title: "Would insert", status: "draft" },
          },
          {
            remoteId: "wrong-scope",
            authScopeId: tenantBRoot.scopeId,
            data: { title: "Remote", status: "draft" },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_SCOPE" });
    await expect(
      repository.findByRemoteIdentity<TaskDocument>({
        tenantId: tenantA,
        collection: "tasks",
        remoteSource: "remote",
        remoteId: "valid-scope",
      }),
    ).resolves.toBeNull();
  });

  it("preserves tenant-scoped role assignment validation precedence", async () => {
    const repository = new KyselyAuthRbacRepository(getTestDatabase());
    const auth = new AuthRbacService({ repository });
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

    await expect(
      repository.assignRoles({
        tenantId: tenantA,
        assignments: [
          {
            userId: member.userId,
            roleId: tenantBRole.roleId,
            scopeId: tenantARoot.scopeId,
          },
          {
            userId: noMembership.userId,
            roleId: tenantARole.roleId,
            scopeId: tenantARoot.scopeId,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "AUTH_TENANT_MEMBERSHIP_REQUIRED",
      details: { userId: noMembership.userId },
    });

    await expect(
      repository.assignRoles({
        tenantId: tenantA,
        assignments: [
          {
            userId: member.userId,
            roleId: tenantBRole.roleId,
            scopeId: tenantARoot.scopeId,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "AUTH_ROLE_NOT_FOUND" });

    await expect(
      repository.assignRoles({
        tenantId: tenantA,
        assignments: [
          {
            userId: member.userId,
            roleId: tenantARole.roleId,
            scopeId: tenantBRoot.scopeId,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "AUTH_SCOPE_NOT_FOUND" });
  });

  it("bootstraps owner grants through one bulk repository operation", async () => {
    const repository = new KyselyAuthRbacRepository(getTestDatabase());
    const grantPermissions = vi.spyOn(repository, "grantPermissions");
    const auth = new AuthRbacService({ repository });
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
      auth.checkAccessMany({
        context: owner.context,
        checks: builtInAdminPermissions.map((permission) => ({
          capability: permission.key,
          targetScopeId: null,
        })),
      }),
    ).resolves.toEqual(builtInAdminPermissions.map(() => true));
  });

  it("checks delegated assignment capabilities in SQL and rejects escalation", async () => {
    const repository = new KyselyAuthRbacRepository(getTestDatabase());
    const checkAccessMany = vi.spyOn(repository, "checkAccessMany");
    const findDeniedRolePermission = vi.spyOn(
      repository,
      "findDeniedRolePermission",
    );
    const auth = new AuthRbacService({ repository });
    await auth.syncPermissions([
      { key: "admin:tenant:owner", source: "admin" },
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
    await auth.grantPermission({
      tenantId: tenantA,
      roleId: delegator.roleId,
      permissionKey: "admin:role-assignments:assign",
    });
    await auth.grantPermission({
      tenantId: tenantA,
      roleId: delegator.roleId,
      permissionKey: "collection:tasks:read",
    });
    await auth.grantPermission({
      tenantId: tenantA,
      roleId: escalated.roleId,
      permissionKey: "collection:tasks:read",
    });
    await auth.grantPermission({
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

    checkAccessMany.mockClear();
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
    expect(findDeniedRolePermission).toHaveBeenCalledOnce();
    expect(findDeniedRolePermission).toHaveBeenCalledWith({
      tenantId: tenantA,
      roleId: escalated.roleId,
      userId: actor.userId,
      targetScopeId: child.scopeId,
    });
    expect(
      checkAccessMany.mock.calls.some(([input]) =>
        input.checks.some((check) =>
          check.capability.startsWith("collection:tasks:"),
        ),
      ),
    ).toBe(false);

    await auth.grantPermission({
      tenantId: tenantA,
      roleId: delegator.roleId,
      permissionKey: "collection:tasks:delete",
    });
    findDeniedRolePermission.mockClear();
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
    expect(findDeniedRolePermission).toHaveBeenCalledOnce();
  });

  it("denies remote writes before adapter side effects", async () => {
    const auth = createTestAuthService();
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
    const registry = createCollectionRegistry([
      {
        name: "tasks",
        schema: taskSchema,
        schemaVersion: 1,
        remoteAdapter: adapter,
      },
    ]);
    await auth.syncCollectionPermissions(registry);
    const service = new DocumentService({
      registry,
      repository: new KyselyDocumentRepository(getTestDatabase()),
      authorizer: auth,
    });
    const root = await auth.ensureTenantRootScope(tenantA);
    const user = await auth.createUser();
    await auth.createTenantMembership({
      tenantId: tenantA,
      userId: user.userId,
    });
    const reader = await auth.createRole({ tenantId: tenantA, key: "reader" });
    await auth.grantPermission({
      tenantId: tenantA,
      roleId: reader.roleId,
      permissionKey: "collection:tasks:read",
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

  async function createTaskServiceWithAuth(
    auth: ReturnType<typeof createTestAuthService>,
  ): Promise<{ service: DocumentService }> {
    const registry = createCollectionRegistry([
      {
        name: "tasks",
        schema: taskSchema,
        schemaVersion: 1,
      },
    ]);
    await auth.syncCollectionPermissions(registry);

    return {
      service: new DocumentService({
        registry,
        repository: new KyselyDocumentRepository(getTestDatabase()),
        authorizer: auth,
      }),
    };
  }

  function createTestAuthService() {
    return new AuthRbacService({
      repository: new KyselyAuthRbacRepository(getTestDatabase()),
    });
  }

  function getTestDatabase(): ReturnType<typeof createInMemoryDb> {
    if (!database) {
      throw new Error("Test database has not been initialized");
    }

    return database;
  }
});
