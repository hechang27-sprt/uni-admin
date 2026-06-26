import { spawn } from "node:child_process";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PGliteDialect } from "kysely";
import { ZenStackClient } from "@zenstackhq/orm";
import type { ClientContract as ZenStackClientType } from "@zenstackhq/orm";
import { PolicyPlugin } from "@zenstackhq/plugin-policy";

import { schema } from "#server/zenstack/prototype-relational-redesign/generated/schema";

export const prototypeRoot = join(
  process.cwd(),
  "server/zenstack/prototype-relational-redesign",
);
export const prototypeSchemaPath = join(prototypeRoot, "prototype.zmodel");
export const prototypeIds = {
  userId: "user-prototype",
  tenantId: "tenant-prototype",
  membershipId: "membership-prototype",
  actorContextId: "actor-context-prototype",
  appKey: "default",
  rootScopeId: "scope-root",
  childScopeId: "scope-child",
  siblingScopeId: "scope-sibling",
  projectDocId: "document-project",
  lockedDocId: "document-locked",
  projectCollectionKey: "default:projects",
  lockedCollectionKey: "default:locked-documents",
  readGrantId: "grant-read",
  updateGrantId: "grant-update",
  siblingDocId: "document-sibling",
} as const;

export type PrototypeClient = ZenStackClientType<typeof schema>;

export async function pushPrototypeSchema(databaseUrl: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "bunx",
      ["zen", "db", "push", "--schema", prototypeSchemaPath],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
        },
        stdio: "inherit",
      },
    );

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`zen db push exited with code ${code ?? "unknown"}`));
      }
    });

    child.on("error", reject);
  });
}

export async function createPrototypeClients() {
  const database = new PGlite();
  await database.waitReady;

  const server = new PGLiteSocketServer({
    db: database,
  });
  await server.start();

  const databaseUrl = `postgresql://postgres:postgres@${server.getServerConn()}/postgres`;
  await pushPrototypeSchema(databaseUrl);

  const dialect = new PGliteDialect({ pglite: database });
  const raw = new ZenStackClient(schema, { dialect });
  const protectedClient = raw.$use(new PolicyPlugin());

  return {
    database,
    server,
    raw,
    protectedClient,
  } as const;
}

export async function seedPrototypeState(raw: PrototypeClient) {
  await raw.user.create({
    data: {
      id: prototypeIds.userId,
    },
  });

  await raw.tenant.create({
    data: {
      id: prototypeIds.tenantId,
    },
  });

  await raw.membership.create({
    data: {
      id: prototypeIds.membershipId,
      user: { connect: { id: prototypeIds.userId } },
      tenant: { connect: { id: prototypeIds.tenantId } },
    },
  });

  await raw.actorContext.create({
    data: {
      id: prototypeIds.actorContextId,
      user: { connect: { id: prototypeIds.userId } },
      tenant: { connect: { id: prototypeIds.tenantId } },
      membership: { connect: { id: prototypeIds.membershipId } },
    },
  });

  await raw.authScope.create({
    data: {
      id: prototypeIds.rootScopeId,
      tenant: { connect: { id: prototypeIds.tenantId } },
      label: "Root scope",
    },
  });

  await raw.authScope.create({
    data: {
      id: prototypeIds.childScopeId,
      tenant: { connect: { id: prototypeIds.tenantId } },
      label: "Child scope",
    },
  });

  await raw.authScope.create({
    data: {
      id: prototypeIds.siblingScopeId,
      tenant: { connect: { id: prototypeIds.tenantId } },
      label: "Sibling scope",
    },
  });

  await raw.authScopeClosure.create({
    data: {
      ancestor: { connect: { id: prototypeIds.rootScopeId } },
      descendant: { connect: { id: prototypeIds.childScopeId } },
    },
  });

  await raw.authScopeClosure.create({
    data: {
      ancestor: { connect: { id: prototypeIds.rootScopeId } },
      descendant: { connect: { id: prototypeIds.siblingScopeId } },
    },
  });

  await raw.derivedCapabilityGrant.create({
    data: {
      id: prototypeIds.readGrantId,
      actorContext: { connect: { id: prototypeIds.actorContextId } },
      tenant: { connect: { id: prototypeIds.tenantId } },
      capabilityKey: "document:read",
      grantScope: { connect: { id: prototypeIds.rootScopeId } },
      reachableScopes: {
        create: [{ scope: { connect: { id: prototypeIds.childScopeId } } }],
      },
    },
  });

  await raw.derivedCapabilityGrant.create({
    data: {
      id: prototypeIds.updateGrantId,
      actorContext: { connect: { id: prototypeIds.actorContextId } },
      tenant: { connect: { id: prototypeIds.tenantId } },
      capabilityKey: "document:update",
      grantScope: { connect: { id: prototypeIds.rootScopeId } },
      reachableScopes: {
        create: [{ scope: { connect: { id: prototypeIds.childScopeId } } }],
      },
    },
  });

  await raw.app.create({
    data: {
      key: prototypeIds.appKey,
      name: "Default app",
    },
  });

  await raw.collection.create({
    data: {
      qualifiedKey: prototypeIds.projectCollectionKey,
      app: { connect: { key: prototypeIds.appKey } },
      collectionKey: "projects",
      name: "Projects",
    },
  });

  await raw.collection.create({
    data: {
      qualifiedKey: prototypeIds.lockedCollectionKey,
      app: { connect: { key: prototypeIds.appKey } },
      collectionKey: "locked-documents",
      name: "Locked documents",
    },
  });

  await raw.projectDocument.create({
    data: {
      documentId: prototypeIds.projectDocId,
      tenant: { connect: { id: prototypeIds.tenantId } },
      authScope: { connect: { id: prototypeIds.childScopeId } },
      title: "Prototype project",
      status: "draft",
    },
  });

  await raw.lockedDocument.create({
    data: {
      documentId: prototypeIds.lockedDocId,
      tenant: { connect: { id: prototypeIds.tenantId } },
      authScope: { connect: { id: prototypeIds.childScopeId } },
      title: "Locked prototype",
      locked: true,
    },
  });

  const actorContext = await raw.actorContext.findUniqueOrThrow({
    where: { id: prototypeIds.actorContextId },
    include: {
      capabilityGrants: {
        include: {
          reachableScopes: true,
        },
      },
    },
  });

  return { actorContext } as const;
}
