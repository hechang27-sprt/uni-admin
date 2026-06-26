import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPrototypeClients,
  prototypeIds,
  seedPrototypeState,
} from '#server/zenstack/prototype-relational-redesign/runtime';

let database: Awaited<ReturnType<typeof createPrototypeClients>>['database'];
let server: Awaited<ReturnType<typeof createPrototypeClients>>['server'];
let raw: Awaited<ReturnType<typeof createPrototypeClients>>['raw'];
let authDb: Awaited<ReturnType<typeof createPrototypeClients>>['protectedClient'];

beforeAll(async () => {
  const clients = await createPrototypeClients();
  database = clients.database;
  server = clients.server;
  raw = clients.raw;

  const { actorContext } = await seedPrototypeState(raw);
  authDb = clients.protectedClient.$setAuth(actorContext);
});

afterAll(async () => {
  await server?.stop();
  await database?.close();
});

describe('ZenStack prototype relational redesign', () => {
  it('keeps the richer actor-context policy and delegate hierarchy aligned with catalog metadata', async () => {
    // ── Base-model reads surface shared DocumentBase fields ──

    const projectBase = await authDb.documentBase.findUnique({
      where: { documentId: prototypeIds.projectDocId },
      select: {
        documentId: true,
        tenantId: true,
        authScopeId: true,
        qualifiedCollectionKey: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const project = await authDb.projectDocument.findUnique({
      where: { documentId: prototypeIds.projectDocId },
      select: {
        documentId: true,
        tenantId: true,
        authScopeId: true,
        qualifiedCollectionKey: true,
        title: true,
        status: true,
      },
    });

    const lockedBase = await authDb.documentBase.findUnique({
      where: { documentId: prototypeIds.lockedDocId },
      select: {
        documentId: true,
        tenantId: true,
        authScopeId: true,
        qualifiedCollectionKey: true,
      },
    });

    const locked = await authDb.lockedDocument.findUnique({
      where: { documentId: prototypeIds.lockedDocId },
      select: {
        documentId: true,
        tenantId: true,
        authScopeId: true,
        qualifiedCollectionKey: true,
        title: true,
        locked: true,
      },
    });

    expect(projectBase).toMatchObject({
      documentId: prototypeIds.projectDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.childScopeId,
      qualifiedCollectionKey: prototypeIds.projectCollectionKey,
      version: 1,
    });

    expect(project).toMatchObject({
      documentId: prototypeIds.projectDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.childScopeId,
      qualifiedCollectionKey: prototypeIds.projectCollectionKey,
      title: 'Prototype project',
      status: 'draft',
    });

    expect(lockedBase).toMatchObject({
      documentId: prototypeIds.lockedDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.childScopeId,
      qualifiedCollectionKey: prototypeIds.lockedCollectionKey,
    });

    expect(locked).toMatchObject({
      documentId: prototypeIds.lockedDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.childScopeId,
      qualifiedCollectionKey: prototypeIds.lockedCollectionKey,
      title: 'Locked prototype',
      locked: true,
    });

    // ── Catalog metadata aligns with discriminator ──

    const catalogRows = await raw.collection.findMany({
      orderBy: { qualifiedCollectionKey: 'asc' },
      select: {
        app: {
          select: { key: true },
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
        app: { key: prototypeIds.appKey },
        collectionKey: 'locked-documents',
        qualifiedCollectionKey: prototypeIds.lockedCollectionKey,
        definitionKey: 'locked-documents',
        name: 'Locked documents',
        schemaVersion: 1,
      },
      {
        app: { key: prototypeIds.appKey },
        collectionKey: 'projects',
        qualifiedCollectionKey: prototypeIds.projectCollectionKey,
        definitionKey: 'projects',
        name: 'Projects',
        schemaVersion: 1,
      },
    ]);

    // ── Actor can update documents through capability-based policy ──

    const updatedProject = await authDb.projectDocument.update({
      where: { documentId: prototypeIds.projectDocId },
      data: { status: 'active' },
      select: { status: true },
    });

    expect(updatedProject).toEqual({
      status: 'active',
    });

    // ── LockedDocument @@deny composes on top of base @@allow ──

    await expect(
      authDb.lockedDocument.update({
        where: { documentId: prototypeIds.lockedDocId },
        data: { title: 'Trying to update locked doc' },
      }),
    ).rejects.toMatchObject({
      reason: 'not-found',
    });
  });

  // ── Richer schema assertions ──

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
    const tenantApp = await raw.tenantApp.findUnique({
      where: {
        tenantId_appId: {
          tenantId: prototypeIds.tenantId,
          appId: prototypeIds.appId,
        },
      },
      select: {
        enabledAt: true,
        app: { select: { key: true, name: true } },
      },
    });

    expect(tenantApp).toMatchObject({
      app: { key: prototypeIds.appKey, name: 'Default app' },
    });
  });

  it('seeds and reads permission definitions', async () => {
    const permissions = await raw.permission.findMany({
      orderBy: { key: 'asc' },
      select: { key: true, capabilityId: true, source: true },
    });

    expect(permissions).toContainEqual({
      key: 'default:projects:create',
      capabilityId: 'create',
      source: 'collection',
    });
    expect(permissions).toContainEqual({
      key: 'default:projects:read',
      capabilityId: 'read',
      source: 'collection',
    });
    expect(permissions).toContainEqual({
      key: 'default:locked-documents:update',
      capabilityId: 'update',
      source: 'collection',
    });
  });

  it('seeds and reads auth scope closure data', async () => {
    const closureRows = await raw.authScopeClosure.findMany({
      orderBy: [{ ancestorId: 'asc' }, { depth: 'asc' }],
      select: { ancestorId: true, descendantId: true, depth: true },
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

  it('enforces create policy through actor-context tenant + capability', async () => {
    // Actor has default:projects:create grant at rootScope.
    // Creating a document at rootScope should succeed (exact scope match).
    const created = await authDb.projectDocument.create({
      data: {
        documentId: '00000000-0000-0000-0000-ffffffffffff',
        tenant: { connect: { id: prototypeIds.tenantId } },
        authScope: { connect: { id: prototypeIds.rootScopeId } },
        title: 'Created by actor',
        status: 'draft',
      },
    });

    expect(created).toMatchObject({
      title: 'Created by actor',
      status: 'draft',
    });

    // Clean up
    await raw.projectDocument.delete({
      where: { documentId: '00000000-0000-0000-0000-ffffffffffff' },
    });
  });

  it('allows create at child scope via ancestor scope grant (Fix #2733)', async () => {
    // Actor has create grant at rootScope. siblingScope path includes
    // rootScope as ancestor, so creating at siblingScope should succeed
    // now that this.authScope.path correctly resolves (was broken before).
    const created = await authDb.projectDocument.create({
      data: {
        documentId: '00000000-0000-0000-0000-fffffffffffe',
        tenant: { connect: { id: prototypeIds.tenantId } },
        authScope: { connect: { id: prototypeIds.siblingScopeId } },
        title: 'Allowed via ancestor scope grant',
        status: 'draft',
      },
    });
    expect(created.documentId).toBe('00000000-0000-0000-0000-fffffffffffe');
    expect(created.authScopeId).toBe(prototypeIds.siblingScopeId);
  });

  it('reads derived capability grant data through actor context', async () => {
    const grants = await raw.derivedCapabilityGrant.findMany({
      where: { actorContextId: prototypeIds.actorContextId },
      orderBy: { capabilityKey: 'asc' },
      select: {
        capabilityKey: true,
        grantScope: { select: { id: true } },
      },
    });

    expect(grants).toContainEqual({
      capabilityKey: 'default:projects:read',
      grantScope: { id: prototypeIds.rootScopeId },
    });
    expect(grants).toContainEqual({
      capabilityKey: 'default:projects:create',
      grantScope: { id: prototypeIds.rootScopeId },
    });
    expect(grants).toContainEqual({
      capabilityKey: 'default:projects:delete',
      grantScope: { id: prototypeIds.rootScopeId },
    });
  });
});
