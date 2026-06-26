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
  userId: "10000000-0000-0000-0000-000000000001",
  tenantId: "20000000-0000-0000-0000-000000000001",
  membershipId: "30000000-0000-0000-0000-000000000001",
  actorContextId: "40000000-0000-0000-0000-000000000001",
  appKey: "default",
  rootScopeId: "a0000000-0000-0000-0000-000000000001",
  childScopeId: "b0000000-0000-0000-0000-000000000001",
  siblingScopeId: "c0000000-0000-0000-0000-000000000001",
  projectDocId: "d0000000-0000-0000-0000-000000000001",
  lockedDocId: "e0000000-0000-0000-0000-000000000001",
  projectCollectionKey: "default:projects",
  lockedCollectionKey: "default:locked-documents",
  readGrantId: "f0000000-0000-0000-0000-000000000001",
  updateGrantId: "f0000000-0000-0000-0000-000000000002",
  createGrantId: "f0000000-0000-0000-0000-000000000003",
  deleteGrantId: "f0000000-0000-0000-0000-000000000004",
  siblingDocId: "d0000000-0000-0000-0000-000000000002",
  projectRevisionId: "50000000-0000-0000-0000-000000000001",
  appId: "60000000-0000-0000-0000-000000000001",
  projectCollectionId: "70000000-0000-0000-0000-000000000001",
  lockedCollectionId: "70000000-0000-0000-0000-000000000002",
} as const;

export type PrototypeClient = ZenStackClientType<typeof schema>;

export async function pushPrototypeSchema(databaseUrl: string) {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("bunx", [
      "zen",
      "db",
      "push",
      "--schema",
      prototypeSchemaPath,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`zen db push failed: ${stderr}`));
    });
  });
}

export async function createPrototypeClients() {
  const database = new PGlite();
  await database.waitReady;

  const server = new PGLiteSocketServer({
    db: database,
    port: 0,
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
    databaseUrl,
  } as const;
}

export async function seedPrototypeState(raw: PrototypeClient) {
  // ── Identity ──

  await raw.user.create({
    data: {
      id: prototypeIds.userId,
      displayName: "Prototype User",
    },
  });

  await raw.userPasswordCredential.create({
    data: {
      userId: prototypeIds.userId,
      username: "prototype",
      passwordHash: "$2b$10$prototype-hash",
    },
  });

  // ── Tenant ──

  await raw.tenant.create({
    data: {
      id: prototypeIds.tenantId,
      name: "Prototype Tenant",
    },
  });

  // ── Membership + Actor Context ──

  await raw.membership.create({
    data: {
      id: prototypeIds.membershipId,
      tenant: { connect: { id: prototypeIds.tenantId } },
      user: { connect: { id: prototypeIds.userId } },
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

  // ── Auth Session ──

  await raw.authSession.create({
    data: {
      tokenHash: "prototype-token-hash",
      tenantId: prototypeIds.tenantId,
      userId: prototypeIds.userId,
      lastRenewedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
      absoluteExpiresAt: new Date(Date.now() + 7200_000),
    },
  });

  // ── App / Catalog ──

  await raw.app.create({
    data: {
      id: prototypeIds.appId,
      key: prototypeIds.appKey,
      name: "Default app",
    },
  });

  await raw.tenantApp.create({
    data: {
      tenant: { connect: { id: prototypeIds.tenantId } },
      app: { connect: { id: prototypeIds.appId } },
    },
  });

  // ── Permissions ──

  const createPermission = async (key: string, capabilityId: string) => {
    await raw.permission.create({
      data: {
        key,
        app: { connect: { id: prototypeIds.appId } },
        capabilityId,
        source: "collection",
      },
    });
  };

  await createPermission("default:projects:create", "create");
  await createPermission("default:projects:read", "read");
  await createPermission("default:projects:update", "update");
  await createPermission("default:projects:delete", "delete");
  await createPermission("default:locked-documents:read", "read");
  await createPermission("default:locked-documents:update", "update");
  await createPermission("default:locked-documents:delete", "delete");

  // ── Auth Scopes ──

  await raw.authScope.create({
    data: {
      id: prototypeIds.rootScopeId,
      tenant: { connect: { id: prototypeIds.tenantId } },
      type: "tenant-root",
      key: "__root",
      name: "Root scope",
      path: [prototypeIds.rootScopeId],
    },
  });

  await raw.authScope.create({
    data: {
      id: prototypeIds.childScopeId,
      tenant: { connect: { id: prototypeIds.tenantId } },
      parent: { connect: { id: prototypeIds.rootScopeId } },
      type: "organization",
      key: "engineering",
      name: "Engineering",
      path: [prototypeIds.childScopeId, prototypeIds.rootScopeId],
    },
  });

  await raw.authScope.create({
    data: {
      id: prototypeIds.siblingScopeId,
      tenant: { connect: { id: prototypeIds.tenantId } },
      parent: { connect: { id: prototypeIds.rootScopeId } },
      type: "organization",
      key: "marketing",
      name: "Marketing",
      path: [prototypeIds.siblingScopeId, prototypeIds.rootScopeId],
    },
  });

  // ── Auth Scope Closure ──
  // root → child, root → sibling, root → root, child → child, sibling → sibling

  await raw.authScopeClosure.create({
    data: {
      ancestor: { connect: { id: prototypeIds.rootScopeId } },
      descendant: { connect: { id: prototypeIds.rootScopeId } },
      depth: 0,
    },
  });

  await raw.authScopeClosure.create({
    data: {
      ancestor: { connect: { id: prototypeIds.childScopeId } },
      descendant: { connect: { id: prototypeIds.childScopeId } },
      depth: 0,
    },
  });

  await raw.authScopeClosure.create({
    data: {
      ancestor: { connect: { id: prototypeIds.siblingScopeId } },
      descendant: { connect: { id: prototypeIds.siblingScopeId } },
      depth: 0,
    },
  });

  await raw.authScopeClosure.create({
    data: {
      ancestor: { connect: { id: prototypeIds.rootScopeId } },
      descendant: { connect: { id: prototypeIds.childScopeId } },
      depth: 1,
    },
  });

  await raw.authScopeClosure.create({
    data: {
      ancestor: { connect: { id: prototypeIds.rootScopeId } },
      descendant: { connect: { id: prototypeIds.siblingScopeId } },
      depth: 1,
    },
  });

  // Grant document:read, document:update, document:create, document:delete
  // at rootScope, with closure matching childScope (and not siblingScope if not granted there)

  await raw.derivedCapabilityGrant.create({
    data: {
      id: prototypeIds.readGrantId,
      actorContext: { connect: { id: prototypeIds.actorContextId } },
      tenant: { connect: { id: prototypeIds.tenantId } },
      capabilityKey: "default:projects:read",
      grantScope: { connect: { id: prototypeIds.rootScopeId } },
    },
  });

  await raw.derivedCapabilityGrant.create({
    data: {
      id: prototypeIds.updateGrantId,
      actorContext: { connect: { id: prototypeIds.actorContextId } },
      tenant: { connect: { id: prototypeIds.tenantId } },
      capabilityKey: "default:projects:update",
      grantScope: { connect: { id: prototypeIds.rootScopeId } },
    },
  });

  await raw.derivedCapabilityGrant.create({
    data: {
      id: prototypeIds.createGrantId,
      actorContext: { connect: { id: prototypeIds.actorContextId } },
      tenant: { connect: { id: prototypeIds.tenantId } },
      capabilityKey: "default:projects:create",
      grantScope: { connect: { id: prototypeIds.rootScopeId } },
    },
  });

  await raw.derivedCapabilityGrant.create({
    data: {
      id: prototypeIds.deleteGrantId,
      actorContext: { connect: { id: prototypeIds.actorContextId } },
      tenant: { connect: { id: prototypeIds.tenantId } },
      capabilityKey: "default:projects:delete",
      grantScope: { connect: { id: prototypeIds.rootScopeId } },
    },
  });

  // ── Collections ──

  await raw.collection.create({
    data: {
      id: prototypeIds.projectCollectionId,
      app: { connect: { id: prototypeIds.appId } },
      qualifiedCollectionKey: prototypeIds.projectCollectionKey,
      collectionKey: "projects",
      definitionKey: "projects",
      name: "Projects",
      schemaVersion: 1,
    },
  });

  await raw.collection.create({
    data: {
      id: prototypeIds.lockedCollectionId,
      app: { connect: { id: prototypeIds.appId } },
      qualifiedCollectionKey: prototypeIds.lockedCollectionKey,
      collectionKey: "locked-documents",
      definitionKey: "locked-documents",
      name: "Locked documents",
      schemaVersion: 1,
    },
  });

  // ── Managed Documents ──

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

  // ── Unmanaged Support Table ──

  await raw.projectRevision.create({
    data: {
      id: prototypeIds.projectRevisionId,
      document: { connect: { documentId: prototypeIds.projectDocId } },
      body: "Initial revision body",
    },
  });

  const actorContext = await raw.actorContext.findUniqueOrThrow({
    where: { id: prototypeIds.actorContextId },
    include: {
      capabilityGrants: true,
    },
  });

  return { actorContext } as const;
}
