import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPrototypeClients,
  prototypeIds,
  seedPrototypeState,
} from '#server/zenstack/prototype-relational-redesign/runtime';

let database: Awaited<ReturnType<typeof createPrototypeClients>>['database'];
let server: Awaited<ReturnType<typeof createPrototypeClients>>['server'];
let raw: Awaited<ReturnType<typeof createPrototypeClients>>['raw'];
let protectedClient: Awaited<ReturnType<typeof createPrototypeClients>>['protectedClient'];
let authDb: Awaited<ReturnType<typeof createPrototypeClients>>['protectedClient'];

beforeAll(async () => {
  const clients = await createPrototypeClients();
  database = clients.database;
  server = clients.server;
  raw = clients.raw;
  protectedClient = clients.protectedClient;

  const { actorContext } = await seedPrototypeState(raw);
  authDb = protectedClient.$setAuth(actorContext);
});

afterAll(async () => {
  await server?.stop();
  await database?.close();
});

describe('ZenStack prototype relational redesign', () => {
  it('keeps the richer actor-context policy and delegate hierarchy aligned with catalog metadata', async () => {
    const projectBase = await authDb.documentBase.findUnique({
      where: { documentId: prototypeIds.projectDocId },
      select: {
        documentId: true,
        tenantId: true,
        authScopeId: true,
        qualifiedKey: true,
      },
    });

    const project = await authDb.projectDocument.findUnique({
      where: { documentId: prototypeIds.projectDocId },
      select: {
        documentId: true,
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
        qualifiedKey: true,
      },
    });

    const locked = await authDb.lockedDocument.findUnique({
      where: { documentId: prototypeIds.lockedDocId },
      select: {
        documentId: true,
        title: true,
        locked: true,
      },
    });

    expect(projectBase).toMatchObject({
      documentId: prototypeIds.projectDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.childScopeId,
      qualifiedKey: prototypeIds.projectCollectionKey,
    });

    expect(project).toMatchObject({
      documentId: prototypeIds.projectDocId,
      title: 'Prototype project',
      status: 'draft',
    });

    expect(lockedBase).toMatchObject({
      documentId: prototypeIds.lockedDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.childScopeId,
      qualifiedKey: prototypeIds.lockedCollectionKey,
    });

    expect(locked).toMatchObject({
      documentId: prototypeIds.lockedDocId,
      title: 'Locked prototype',
      locked: true,
    });

    const catalogRows = await raw.collection.findMany({
      orderBy: { qualifiedKey: 'asc' },
      select: {
        app: {
          select: {
            key: true,
          },
        },
        collectionKey: true,
        qualifiedKey: true,
      },
    });

    expect(catalogRows).toEqual([
      {
        app: { key: prototypeIds.appKey },
        collectionKey: 'locked-documents',
        qualifiedKey: prototypeIds.lockedCollectionKey,
      },
      {
        app: { key: prototypeIds.appKey },
        collectionKey: 'projects',
        qualifiedKey: prototypeIds.projectCollectionKey,
      },
    ]);

    const updatedProject = await authDb.projectDocument.update({
      where: { documentId: prototypeIds.projectDocId },
      data: { title: 'Prototype project updated' },
      select: {
        documentId: true,
        title: true,
      },
    });

    expect(updatedProject).toEqual({
      documentId: prototypeIds.projectDocId,
      title: 'Prototype project updated',
    });

    const siblingScopedProject = await raw.projectDocument.create({
      data: {
        documentId: prototypeIds.siblingDocId,
        tenantId: prototypeIds.tenantId,
        authScopeId: prototypeIds.siblingScopeId,
        title: 'Sibling scoped project',
        status: 'draft',
      },
    });

    expect(siblingScopedProject.documentId).toBe(prototypeIds.siblingDocId);

    const visibleSiblingProject = await authDb.projectDocument.findUnique({
      where: { documentId: prototypeIds.siblingDocId },
      select: { documentId: true },
    });

    expect(visibleSiblingProject).toBeNull();

    await expect(
      authDb.lockedDocument.update({
        where: { documentId: prototypeIds.lockedDocId },
        data: { title: 'Should stay locked' },
      }),
    ).rejects.toMatchObject({
      reason: 'not-found',
    });
  });
});
