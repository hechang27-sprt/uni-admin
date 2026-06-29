import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPrototypeClients,
  prototypeIds,
  seedPrototypeState,
} from '#server/zenstack/prototype-relational-redesign/runtime';

let database: Awaited<ReturnType<typeof createPrototypeClients>>['database'];
let server: Awaited<ReturnType<typeof createPrototypeClients>>['server'];
let raw: Awaited<ReturnType<typeof createPrototypeClients>>['raw'];
let projectAdminDb: Awaited<ReturnType<typeof createPrototypeClients>>['protectedClient'];
let bottomOnlyDb: Awaited<ReturnType<typeof createPrototypeClients>>['protectedClient'];

beforeAll(async () => {
  const clients = await createPrototypeClients();
  database = clients.database;
  server = clients.server;
  raw = clients.raw;

  const { actorContext, bottomActorContext } = await seedPrototypeState(raw);
  projectAdminDb = clients.protectedClient.$setAuth(actorContext);
  bottomOnlyDb = clients.protectedClient.$setAuth(bottomActorContext);
});

afterAll(async () => {
  await server?.stop();
  await database?.close();
});

describe('ZenStack prototype relational redesign', () => {
  it('keeps delegate reads aligned to the exact qualified capability key', async () => {
    const projectBase = await projectAdminDb.documentBase.findUnique({
      where: { documentId: prototypeIds.projectDocId },
      select: {
        documentId: true,
        tenantId: true,
        authScopeId: true,
        appKey: true,
        collectionKey: true,
        qualifiedCollectionKey: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const project = await projectAdminDb.projectDocument.findUnique({
      where: { documentId: prototypeIds.projectDocId },
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

    const locked = await projectAdminDb.lockedDocument.findUnique({
      where: { documentId: prototypeIds.lockedDocId },
      select: {
        documentId: true,
        tenantId: true,
        authScopeId: true,
        appKey: true,
        collectionKey: true,
        qualifiedCollectionKey: true,
        title: true,
        locked: true,
      },
    });

    const partnerProject = await projectAdminDb.partnerProjectDocument.findUnique({
      where: { documentId: prototypeIds.partnerProjectDocId },
      select: {
        documentId: true,
        appKey: true,
        collectionKey: true,
        qualifiedCollectionKey: true,
        title: true,
      },
    });

    expect(projectBase).toMatchObject({
      documentId: prototypeIds.projectDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.childScopeId,
      appKey: prototypeIds.appKey,
      collectionKey: 'projects',
      qualifiedCollectionKey: prototypeIds.projectCollectionKey,
      version: 1,
    });

    expect(project).toMatchObject({
      documentId: prototypeIds.projectDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.childScopeId,
      appKey: prototypeIds.appKey,
      collectionKey: 'projects',
      qualifiedCollectionKey: prototypeIds.projectCollectionKey,
      title: 'Prototype project',
      status: 'draft',
    });

    expect(locked).toMatchObject({
      documentId: prototypeIds.lockedDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.childScopeId,
      appKey: prototypeIds.appKey,
      collectionKey: 'locked-documents',
      qualifiedCollectionKey: prototypeIds.lockedCollectionKey,
      title: 'Locked prototype',
      locked: true,
    });

    expect(partnerProject).toBeNull();
  });

  it('keeps catalog metadata aligned with the discriminator key', async () => {
    const catalogRows = await raw.collection.findMany({
      orderBy: [{ qualifiedCollectionKey: 'asc' }],
      select: {
        app: {
          select: { appKey: true },
        },
        collectionKey: true,
        qualifiedCollectionKey: true,
        definitionKey: true,
        name: true,
        schemaVersion: true,
      },
    });

    expect(catalogRows).toEqual([
      {
        app: { appKey: prototypeIds.appKey },
        collectionKey: 'locked-documents',
        qualifiedCollectionKey: prototypeIds.lockedCollectionKey,
        definitionKey: 'locked-documents',
        name: 'Locked documents',
        schemaVersion: 1,
      },
      {
        app: { appKey: prototypeIds.appKey },
        collectionKey: 'projects',
        qualifiedCollectionKey: prototypeIds.projectCollectionKey,
        definitionKey: 'projects',
        name: 'Projects',
        schemaVersion: 1,
      },
      {
        app: { appKey: prototypeIds.partnerAppKey },
        collectionKey: 'projects',
        qualifiedCollectionKey: prototypeIds.partnerProjectCollectionKey,
        definitionKey: 'projects',
        name: 'Partner projects',
        schemaVersion: 1,
      },
    ]);
  });

  it('keeps asymmetric bottom-scope reads', async () => {
    const projectAdminBottom = await projectAdminDb.projectDocument.findUnique({
      where: { documentId: prototypeIds.bottomProjectDocId },
      select: {
        documentId: true,
        authScopeId: true,
        title: true,
      },
    });

    const bottomOnlyBottom = await bottomOnlyDb.projectDocument.findUnique({
      where: { documentId: prototypeIds.bottomProjectDocId },
      select: {
        documentId: true,
        authScopeId: true,
        title: true,
      },
    });

    const bottomOnlyChild = await bottomOnlyDb.projectDocument.findUnique({
      where: { documentId: prototypeIds.projectDocId },
      select: {
        documentId: true,
      },
    });

    expect(projectAdminBottom).toMatchObject({
      documentId: prototypeIds.bottomProjectDocId,
      authScopeId: prototypeIds.bottomScopeId,
      title: 'Bottom-scoped project',
    });
    expect(bottomOnlyBottom).toMatchObject({
      documentId: prototypeIds.bottomProjectDocId,
      authScopeId: prototypeIds.bottomScopeId,
      title: 'Bottom-scoped project',
    });
    expect(bottomOnlyChild).toBeNull();
  });

  it('allows project updates but keeps subtype tightenings on top', async () => {
    const updatedProject = await projectAdminDb.projectDocument.update({
      where: { documentId: prototypeIds.projectDocId },
      data: { status: 'active' },
      select: { status: true },
    });

    expect(updatedProject).toEqual({
      status: 'active',
    });

    await expect(
      projectAdminDb.lockedDocument.update({
        where: { documentId: prototypeIds.lockedDocId },
        data: { title: 'Trying to update locked doc' },
      }),
    ).rejects.toMatchObject({
      reason: 'not-found',
    });
  });

  it('seeds and reads identity and membership data', async () => {
    const user = await raw.user.findUnique({
      where: { id: prototypeIds.userId },
      select: {
        displayName: true,
        passwordCredential: { select: { username: true } },
        memberships: { select: { tenantId: true } },
        sessions: { select: { tokenHash: true, tenantId: true } },
      },
    });

    expect(user).toMatchObject({
      displayName: 'Prototype User',
      passwordCredential: { username: 'prototype' },
      memberships: [{ tenantId: prototypeIds.tenantId }],
      sessions: [{ tokenHash: 'prototype-token-hash', tenantId: prototypeIds.tenantId }],
    });
  });

  it('seeds and reads app enablement data', async () => {
    const tenantApps = await raw.tenantApp.findMany({
      orderBy: { appKey: 'asc' },
      select: {
        enabledAt: true,
        app: { select: { appKey: true, name: true } },
      },
    });

    expect(tenantApps).toMatchObject([
      { app: { appKey: prototypeIds.appKey, name: 'Default app' } },
      { app: { appKey: prototypeIds.partnerAppKey, name: 'Partner app' } },
    ]);
  });

  it('seeds and reads permission definitions', async () => {
    const permissions = await raw.permission.findMany({
      orderBy: { key: 'asc' },
      select: {
        key: true,
        appKey: true,
        collectionKey: true,
        actionKey: true,
        source: true,
        app: { select: { appKey: true } },
        collection: { select: { appKey: true, collectionKey: true } },
      },
    });

    expect(permissions).toContainEqual({
      key: 'default:projects:create',
      appKey: prototypeIds.appKey,
      collectionKey: 'projects',
      actionKey: 'create',
      source: 'collection',
      app: { appKey: prototypeIds.appKey },
      collection: { appKey: prototypeIds.appKey, collectionKey: 'projects' },
    });
    expect(permissions).toContainEqual({
      key: 'default:projects:read',
      appKey: prototypeIds.appKey,
      collectionKey: 'projects',
      actionKey: 'read',
      source: 'collection',
      app: { appKey: prototypeIds.appKey },
      collection: { appKey: prototypeIds.appKey, collectionKey: 'projects' },
    });
    expect(permissions).toContainEqual({
      key: 'default:locked-documents:update',
      appKey: prototypeIds.appKey,
      collectionKey: 'locked-documents',
      actionKey: 'update',
      source: 'collection',
      app: { appKey: prototypeIds.appKey },
      collection: { appKey: prototypeIds.appKey, collectionKey: 'locked-documents' },
    });
    expect(permissions).toContainEqual({
      key: 'partner:projects:read',
      appKey: prototypeIds.partnerAppKey,
      collectionKey: 'projects',
      actionKey: 'read',
      source: 'collection',
      app: { appKey: prototypeIds.partnerAppKey },
      collection: { appKey: prototypeIds.partnerAppKey, collectionKey: 'projects' },
    });
  });

  it('seeds and reads auth scope closure data including bottom scope', async () => {
    const closureRows = await raw.authScopeClosure.findMany({
      orderBy: [{ ancestorId: 'asc' }, { depth: 'asc' }],
      select: { ancestorId: true, descendantId: true, depth: true },
    });

    expect(closureRows).toContainEqual({
      ancestorId: prototypeIds.bottomScopeId,
      descendantId: prototypeIds.bottomScopeId,
      depth: 0,
    });
    expect(closureRows).toContainEqual({
      ancestorId: prototypeIds.rootScopeId,
      descendantId: prototypeIds.rootScopeId,
      depth: 0,
    });
    expect(closureRows).toContainEqual({
      ancestorId: prototypeIds.rootScopeId,
      descendantId: prototypeIds.childScopeId,
      depth: 1,
    });
    expect(closureRows).toContainEqual({
      ancestorId: prototypeIds.rootScopeId,
      descendantId: prototypeIds.siblingScopeId,
      depth: 1,
    });
    expect(closureRows).toContainEqual({
      ancestorId: prototypeIds.rootScopeId,
      descendantId: prototypeIds.bottomScopeId,
      depth: 1,
    });
  });

  it('seeds and reads unmanaged support table independent of DocumentBase', async () => {
    const revision = await raw.projectRevision.findUnique({
      where: { id: prototypeIds.projectRevisionId },
      select: {
        body: true,
        document: { select: { title: true, documentId: true } },
      },
    });

    expect(revision).toMatchObject({
      body: 'Initial revision body',
      document: { title: 'Prototype project', documentId: prototypeIds.projectDocId },
    });
  });

  it('enforces create policy through exact capability keys and bottom-scope handling', async () => {
    const createdRoot = await projectAdminDb.projectDocument.create({
      data: {
        documentId: '00000000-0000-0000-0000-ffffffffffff',
        tenantId: prototypeIds.tenantId,
        authScopeId: prototypeIds.rootScopeId,
        appKey: prototypeIds.appKey,
        collectionKey: 'projects',
        title: 'Created at root',
        status: 'draft',
      },
      select: { documentId: true, authScopeId: true },
    });

    const createdBottom = await projectAdminDb.projectDocument.create({
      data: {
        documentId: '00000000-0000-0000-0000-fffffffffffe',
        tenantId: prototypeIds.tenantId,
        authScopeId: prototypeIds.bottomScopeId,
        appKey: prototypeIds.appKey,
        collectionKey: 'projects',
        title: 'Created at bottom',
        status: 'draft',
      },
      select: { documentId: true, authScopeId: true },
    });

    await expect(
      projectAdminDb.partnerProjectDocument.create({
        data: {
          documentId: '00000000-0000-0000-0000-fffffffffffd',
          tenantId: prototypeIds.tenantId,
          authScopeId: prototypeIds.childScopeId,
          appKey: prototypeIds.partnerAppKey,
          collectionKey: 'projects',
          title: 'Should be denied',
          status: 'draft',
        },
      }),
    ).rejects.toMatchObject({
      reason: 'rejected-by-policy',
    });

    expect(createdRoot).toEqual({
      documentId: '00000000-0000-0000-0000-ffffffffffff',
      authScopeId: prototypeIds.rootScopeId,
    });
    expect(createdBottom).toEqual({
      documentId: '00000000-0000-0000-0000-fffffffffffe',
      authScopeId: prototypeIds.bottomScopeId,
    });

    await raw.projectDocument.delete({
      where: { documentId: '00000000-0000-0000-0000-ffffffffffff' },
    });
    await raw.projectDocument.delete({
      where: { documentId: '00000000-0000-0000-0000-fffffffffffe' },
    });
  });

  it('reads role assignments and permissions through actor context', async () => {
    const actorContext = await raw.actorContext.findUniqueOrThrow({
      where: { id: prototypeIds.actorContextId },
      select: {
        tenantId: true,
        user: {
          select: {
            roleAssignments: {
              orderBy: { id: 'asc' },
              select: {
                scopeId: true,
                role: {
                  select: {
                    key: true,
                    rolePermissions: {
                      orderBy: { permissionKey: 'asc' },
                      select: {
                        permission: {
                          select: {
                            key: true,
                            actionKey: true,
                            collection: { select: { appKey: true, collectionKey: true } },
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
      tenantId: prototypeIds.tenantId,
      user: {
        roleAssignments: [
          {
            scopeId: prototypeIds.rootScopeId,
            role: {
              key: 'project-admin',
              rolePermissions: expect.arrayContaining([
                {
                  permission: {
                    key: 'default:projects:create',
                    actionKey: 'create',
                    collection: { appKey: prototypeIds.appKey, collectionKey: 'projects' },
                  },
                },
                {
                  permission: {
                    key: 'default:projects:read',
                    actionKey: 'read',
                    collection: { appKey: prototypeIds.appKey, collectionKey: 'projects' },
                  },
                },
                {
                  permission: {
                    key: 'default:locked-documents:update',
                    actionKey: 'update',
                    collection: { appKey: prototypeIds.appKey, collectionKey: 'locked-documents' },
                  },
                },
              ]),
            },
          },
        ],
      },
    });
  });
});
