import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createProjectDocument,
  createProjectRevision,
  createPrototypeClients,
  hardDeleteDocument,
  prototypeKeys,
  restoreDocument,
  setupPrototypeLifecycle,
  softDeleteDocument,
  updateProjectStatus,
} from "#server/zenstack/prototype-relational-redesign/runtime";

let database: Awaited<ReturnType<typeof createPrototypeClients>>["database"];
let server: Awaited<ReturnType<typeof createPrototypeClients>>["server"];
let raw: Awaited<ReturnType<typeof createPrototypeClients>>["raw"];
let projectAdminDb: Awaited<
  ReturnType<typeof setupPrototypeLifecycle>
>["projectAdminDb"];
let bottomOnlyDb: Awaited<
  ReturnType<typeof setupPrototypeLifecycle>
>["bottomOnlyDb"];
let bootstrap: Awaited<ReturnType<typeof setupPrototypeLifecycle>>["bootstrap"];

beforeAll(async () => {
  const clients = await createPrototypeClients();
  database = clients.database;
  server = clients.server;
  raw = clients.raw;

  const lifecycle = await setupPrototypeLifecycle(clients);
  bootstrap = lifecycle.bootstrap;
  projectAdminDb = lifecycle.projectAdminDb;
  bottomOnlyDb = lifecycle.bottomOnlyDb;
});

afterAll(async () => {
  await server?.stop();
  await database?.close();
});

describe("ZenStack prototype relational redesign", () => {
  it("establishes actor context from memberships and sessions", async () => {
    const user = await raw.user.findUniqueOrThrow({
      where: { userId: bootstrap.users.projectAdmin.userId },
      select: {
        displayName: true,
        status: true,
        passwordCredential: { select: { username: true } },
        memberships: {
          select: { userId: true, tenantId: true, status: true },
        },
        sessions: { select: { tokenHash: true, tenantId: true, userId: true } },
      },
    });

    expect(user).toMatchObject({
      displayName: "Prototype User",
      status: "active",
      passwordCredential: { username: "prototype" },
      memberships: [
        {
          userId: bootstrap.memberships.projectAdmin.userId,
          tenantId: bootstrap.tenant.tenantId,
          status: "active",
        },
      ],
      sessions: [
        {
          tokenHash: bootstrap.session.tokenHash,
          tenantId: bootstrap.tenant.tenantId,
          userId: bootstrap.users.projectAdmin.userId,
        },
      ],
    });

    expect(bootstrap.actorContexts.projectAdmin.membershipId).toBe(
      bootstrap.memberships.projectAdmin.membershipId,
    );
    expect(bootstrap.actorContexts.projectAdmin.tenantId).toBe(
      bootstrap.tenant.tenantId,
    );
    expect(bootstrap.actorContexts.bottomOnly.membershipId).toBe(
      bootstrap.memberships.bottomOnly.membershipId,
    );
  });

  it("keeps tenant app enablement and collection catalog aligned", async () => {
    const tenantApps = await raw.tenantApp.findMany({
      orderBy: { appKey: "asc" },
      select: {
        tenantId: true,
        appKey: true,
        config: true,
        app: { select: { appKey: true, name: true } },
      },
    });

    expect(tenantApps).toEqual([
      {
        tenantId: bootstrap.tenant.tenantId,
        appKey: prototypeKeys.appKey,
        config: { lifecycle: "enabled" },
        app: { appKey: prototypeKeys.appKey, name: "Default app" },
      },
      {
        tenantId: bootstrap.tenant.tenantId,
        appKey: prototypeKeys.partnerAppKey,
        config: { lifecycle: "enabled" },
        app: { appKey: prototypeKeys.partnerAppKey, name: "Partner app" },
      },
    ]);

    const catalogRows = await raw.collection.findMany({
      orderBy: [{ qualifiedCollectionKey: "asc" }],
      select: {
        app: { select: { appKey: true } },
        collectionKey: true,
        qualifiedCollectionKey: true,
        definitionKey: true,
        name: true,
        schemaVersion: true,
      },
    });

    expect(catalogRows).toEqual([
      {
        app: { appKey: prototypeKeys.appKey },
        collectionKey: prototypeKeys.lockedCollectionLocalKey,
        qualifiedCollectionKey: prototypeKeys.lockedCollectionKey,
        definitionKey: prototypeKeys.lockedCollectionLocalKey,
        name: "Locked documents",
        schemaVersion: 1,
      },
      {
        app: { appKey: prototypeKeys.appKey },
        collectionKey: prototypeKeys.projectCollectionLocalKey,
        qualifiedCollectionKey: prototypeKeys.projectCollectionKey,
        definitionKey: prototypeKeys.projectCollectionLocalKey,
        name: "Projects",
        schemaVersion: 1,
      },
      {
        app: { appKey: prototypeKeys.partnerAppKey },
        collectionKey: prototypeKeys.projectCollectionLocalKey,
        qualifiedCollectionKey: prototypeKeys.partnerProjectCollectionKey,
        definitionKey: prototypeKeys.projectCollectionLocalKey,
        name: "Partner projects",
        schemaVersion: 1,
      },
    ]);
  });

  it("creates managed rows through actor-bound operations and keeps capability boundaries exact", async () => {
    const project = await createProjectDocument({
      db: projectAdminDb,
      tenantId: bootstrap.tenant.tenantId,
      authScopeId: bootstrap.scopes.child.scopeId,
      appKey: prototypeKeys.appKey,
      collectionKey: prototypeKeys.projectCollectionLocalKey,
      title: "Lifecycle project",
    });

    const bottomProject = await createProjectDocument({
      db: projectAdminDb,
      tenantId: bootstrap.tenant.tenantId,
      authScopeId: bootstrap.scopes.bottom.scopeId,
      appKey: prototypeKeys.appKey,
      collectionKey: prototypeKeys.projectCollectionLocalKey,
      title: "Bottom lifecycle project",
    });

    await expect(
      createProjectDocument({
        db: projectAdminDb,
        tenantId: bootstrap.tenant.tenantId,
        authScopeId: bootstrap.scopes.child.scopeId,
        appKey: prototypeKeys.partnerAppKey,
        collectionKey: prototypeKeys.projectCollectionLocalKey,
        title: "Partner write should be denied",
      }),
    ).rejects.toMatchObject({
      reason: "rejected-by-policy",
    });

    const projectBase = await projectAdminDb.documentBase.findUnique({
      where: { documentId: project.documentId },
      select: {
        documentId: true,
        tenantId: true,
        authScopeId: true,
        appKey: true,
        collectionKey: true,
        qualifiedCollectionKey: true,
        version: true,
      },
    });

    const visibleProject = await projectAdminDb.projectDocument.findUnique({
      where: { documentId: project.documentId },
      select: {
        documentId: true,
        tenantId: true,
        authScopeId: true,
        appKey: true,
        collectionKey: true,
        qualifiedCollectionKey: true,
        title: true,
        status: true,
      },
    });

    const bottomVisibleToBottomActor =
      await bottomOnlyDb.projectDocument.findUnique({
        where: { documentId: bottomProject.documentId },
        select: {
          documentId: true,
          authScopeId: true,
          title: true,
        },
      });

    const childHiddenFromBottomActor =
      await bottomOnlyDb.projectDocument.findUnique({
        where: { documentId: project.documentId },
        select: { documentId: true },
      });

    expect(projectBase).toMatchObject({
      documentId: project.documentId,
      tenantId: bootstrap.tenant.tenantId,
      authScopeId: bootstrap.scopes.child.scopeId,
      appKey: prototypeKeys.appKey,
      collectionKey: prototypeKeys.projectCollectionLocalKey,
      qualifiedCollectionKey: prototypeKeys.projectCollectionKey,
      version: 1,
    });

    expect(visibleProject).toMatchObject({
      documentId: project.documentId,
      tenantId: bootstrap.tenant.tenantId,
      authScopeId: bootstrap.scopes.child.scopeId,
      appKey: prototypeKeys.appKey,
      collectionKey: prototypeKeys.projectCollectionLocalKey,
      qualifiedCollectionKey: prototypeKeys.projectCollectionKey,
      title: "Lifecycle project",
      status: "draft",
    });

    expect(bottomVisibleToBottomActor).toMatchObject({
      documentId: bottomProject.documentId,
      authScopeId: bootstrap.scopes.bottom.scopeId,
      title: "Bottom lifecycle project",
    });
    expect(childHiddenFromBottomActor).toBeNull();
  });

  it("supports managed document lifecycle transitions through runtime helpers", async () => {
    const created = await createProjectDocument({
      db: projectAdminDb,
      tenantId: bootstrap.tenant.tenantId,
      authScopeId: bootstrap.scopes.root.scopeId,
      appKey: prototypeKeys.appKey,
      collectionKey: prototypeKeys.projectCollectionLocalKey,
      title: "Lifecycle transitions",
    });

    const updated = await updateProjectStatus(
      projectAdminDb,
      created.documentId,
      "active",
    );
    expect(updated).toMatchObject({
      documentId: created.documentId,
      status: "active",
      version: 1,
    });

    const deleted = await softDeleteDocument(raw, created.documentId);
    expect(deleted.documentId).toBe(created.documentId);
    expect(deleted.deletedAt).toBeInstanceOf(Date);

    const hiddenAfterDelete = await projectAdminDb.projectDocument.findUnique({
      where: { documentId: created.documentId },
      select: { documentId: true },
    });
    expect(hiddenAfterDelete).toBeNull();

    const restored = await restoreDocument(raw, created.documentId);
    expect(restored).toMatchObject({
      documentId: created.documentId,
      deletedAt: null,
    });

    const visibleAfterRestore = await projectAdminDb.projectDocument.findUnique(
      {
        where: { documentId: created.documentId },
        select: { documentId: true, status: true },
      },
    );
    expect(visibleAfterRestore).toMatchObject({
      documentId: created.documentId,
      status: "active",
    });

    await hardDeleteDocument(raw, created.documentId);

    const missingAfterHardDelete = await raw.projectDocument.findUnique({
      where: { documentId: created.documentId },
      select: { documentId: true },
    });
    expect(missingAfterHardDelete).toBeNull();
  });

  it("keeps subtype tightenings on top of the baseline managed lifecycle", async () => {
    const locked = await raw.lockedDocument.create({
      data: {
        tenantId: bootstrap.tenant.tenantId,
        authScopeId: bootstrap.scopes.child.scopeId,
        appKey: prototypeKeys.appKey,
        collectionKey: prototypeKeys.lockedCollectionLocalKey,
        title: "Locked lifecycle document",
        locked: true,
      },
      select: {
        documentId: true,
        authScopeId: true,
        locked: true,
        qualifiedCollectionKey: true,
      },
    });

    expect(locked).toMatchObject({
      authScopeId: bootstrap.scopes.child.scopeId,
      locked: true,
      qualifiedCollectionKey: prototypeKeys.lockedCollectionKey,
    });

    await expect(
      projectAdminDb.lockedDocument.update({
        where: { documentId: locked.documentId },
        data: { title: "Trying to update locked doc" },
      }),
    ).rejects.toMatchObject({
      reason: "not-found",
    });
  });

  it("keeps unmanaged support rows attached to managed document activity", async () => {
    const project = await createProjectDocument({
      db: projectAdminDb,
      tenantId: bootstrap.tenant.tenantId,
      authScopeId: bootstrap.scopes.child.scopeId,
      appKey: prototypeKeys.appKey,
      collectionKey: prototypeKeys.projectCollectionLocalKey,
      title: "Revisioned project",
    });

    const revision = await createProjectRevision(
      raw,
      project.documentId,
      "Initial revision body",
    );

    expect(revision).toMatchObject({
      body: "Initial revision body",
      document: {
        documentId: project.documentId,
        title: "Revisioned project",
      },
    });
  });

  it("reads permission definitions and role grants through actor context", async () => {
    const permissions = await raw.permission.findMany({
      orderBy: { qualifiedKey: "asc" },
      select: {
        qualifiedKey: true,
        appKey: true,
        collectionKey: true,
        actionKey: true,
        source: true,
        app: { select: { appKey: true } },
        collection: { select: { appKey: true, collectionKey: true } },
      },
    });

    expect(permissions).toContainEqual({
      qualifiedKey: bootstrap.permissions.projectCreateKey,
      appKey: prototypeKeys.appKey,
      collectionKey: prototypeKeys.projectCollectionLocalKey,
      actionKey: "create",
      source: "collection",
      app: { appKey: prototypeKeys.appKey },
      collection: {
        appKey: prototypeKeys.appKey,
        collectionKey: prototypeKeys.projectCollectionLocalKey,
      },
    });
    expect(permissions).toContainEqual({
      qualifiedKey: bootstrap.permissions.partnerProjectReadKey,
      appKey: prototypeKeys.partnerAppKey,
      collectionKey: prototypeKeys.projectCollectionLocalKey,
      actionKey: "read",
      source: "collection",
      app: { appKey: prototypeKeys.partnerAppKey },
      collection: {
        appKey: prototypeKeys.partnerAppKey,
        collectionKey: prototypeKeys.projectCollectionLocalKey,
      },
    });

    const actorContext = await raw.actorContext.findUniqueOrThrow({
      where: { ctxId: bootstrap.actorContexts.projectAdmin.ctxId },
      select: {
        tenantId: true,
        membershipId: true,
        user: {
          select: {
            roleAssignments: {
              orderBy: { assignmentId: "asc" },
              select: {
                assignmentId: true,
                scopeId: true,
                role: {
                  select: {
                    roleKey: true,
                    rolePermissions: {
                      orderBy: { permissionKey: "asc" },
                      select: {
                        permission: {
                          select: {
                            qualifiedKey: true,
                            actionKey: true,
                            collection: {
                              select: { appKey: true, collectionKey: true },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(actorContext).toMatchObject({
      tenantId: bootstrap.tenant.tenantId,
      membershipId: bootstrap.memberships.projectAdmin.membershipId,
      user: {
        roleAssignments: [
          {
            assignmentId: bootstrap.assignments.projectAdmin.assignmentId,
            scopeId: bootstrap.scopes.root.scopeId,
            role: {
              roleKey: "project-admin",
              rolePermissions: expect.arrayContaining([
                {
                  permission: {
                    qualifiedKey: bootstrap.permissions.projectCreateKey,
                    actionKey: "create",
                    collection: {
                      appKey: prototypeKeys.appKey,
                      collectionKey: prototypeKeys.projectCollectionLocalKey,
                    },
                  },
                },
                {
                  permission: {
                    qualifiedKey: bootstrap.permissions.projectReadKey,
                    actionKey: "read",
                    collection: {
                      appKey: prototypeKeys.appKey,
                      collectionKey: prototypeKeys.projectCollectionLocalKey,
                    },
                  },
                },
                {
                  permission: {
                    qualifiedKey: bootstrap.permissions.lockedUpdateKey,
                    actionKey: "update",
                    collection: {
                      appKey: prototypeKeys.appKey,
                      collectionKey: prototypeKeys.lockedCollectionLocalKey,
                    },
                  },
                },
              ]),
            },
          },
        ],
      },
    });
  });

  it("keeps auth scope closure data aligned with the lifecycle bootstrap", async () => {
    const closureRows = await raw.authScopeClosure.findMany({
      orderBy: [{ ancestorId: "asc" }, { depth: "asc" }],
      select: { ancestorId: true, descendantId: true, depth: true },
    });

    expect(closureRows).toContainEqual({
      ancestorId: bootstrap.scopes.bottom.scopeId,
      descendantId: bootstrap.scopes.bottom.scopeId,
      depth: 0,
    });
    expect(closureRows).toContainEqual({
      ancestorId: bootstrap.scopes.root.scopeId,
      descendantId: bootstrap.scopes.root.scopeId,
      depth: 0,
    });
    expect(closureRows).toContainEqual({
      ancestorId: bootstrap.scopes.root.scopeId,
      descendantId: bootstrap.scopes.child.scopeId,
      depth: 1,
    });
    expect(closureRows).toContainEqual({
      ancestorId: bootstrap.scopes.root.scopeId,
      descendantId: bootstrap.scopes.sibling.scopeId,
      depth: 1,
    });
    expect(closureRows).toContainEqual({
      ancestorId: bootstrap.scopes.root.scopeId,
      descendantId: bootstrap.scopes.bottom.scopeId,
      depth: 1,
    });
  });
});
