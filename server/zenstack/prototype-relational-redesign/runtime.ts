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
  bottomScopeId: "00000000-0000-0000-0000-000000000000",
  userId: "10000000-0000-0000-0000-000000000001",
  bottomUserId: "10000000-0000-0000-0000-000000000002",
  tenantId: "20000000-0000-0000-0000-000000000001",
  membershipId: "30000000-0000-0000-0000-000000000001",
  bottomMembershipId: "30000000-0000-0000-0000-000000000002",
  actorContextId: "40000000-0000-0000-0000-000000000001",
  bottomActorContextId: "40000000-0000-0000-0000-000000000002",
  appKey: "default",
  partnerAppKey: "partner",
  rootScopeId: "a0000000-0000-0000-0000-000000000001",
  childScopeId: "b0000000-0000-0000-0000-000000000001",
  siblingScopeId: "c0000000-0000-0000-0000-000000000001",
  projectDocId: "d0000000-0000-0000-0000-000000000001",
  bottomProjectDocId: "d0000000-0000-0000-0000-000000000002",
  partnerProjectDocId: "d0000000-0000-0000-0000-000000000003",
  lockedDocId: "e0000000-0000-0000-0000-000000000001",
  projectCollectionKey: "default:projects",
  partnerProjectCollectionKey: "partner:projects",
  lockedCollectionKey: "default:locked-documents",
  projectAdminRoleId: "f0000000-0000-0000-0000-000000000001",
  bottomReaderRoleId: "f0000000-0000-0000-0000-000000000002",
  projectAdminAssignmentId: "f1000000-0000-0000-0000-000000000001",
  bottomReaderAssignmentId: "f1000000-0000-0000-0000-000000000002",
  projectRevisionId: "50000000-0000-0000-0000-000000000001",
} as const;

export type PrototypeClient = ZenStackClientType<typeof schema>;

export async function pushPrototypeSchema(databaseUrl: string) {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "bunx",
      ["zen", "db", "push", "--schema", prototypeSchemaPath],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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

  await raw.user.create({
    data: {
      id: prototypeIds.bottomUserId,
      displayName: "Bottom-only User",
    },
  });

  await raw.userPasswordCredential.create({
    data: {
      userId: prototypeIds.userId,
      username: "prototype",
      passwordHash: "$2b$10$prototype-hash",
    },
  });

  await raw.userPasswordCredential.create({
    data: {
      userId: prototypeIds.bottomUserId,
      username: "prototype-bottom",
      passwordHash: "$2b$10$prototype-bottom-hash",
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

  await raw.membership.create({
    data: {
      id: prototypeIds.bottomMembershipId,
      tenant: { connect: { id: prototypeIds.tenantId } },
      user: { connect: { id: prototypeIds.bottomUserId } },
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

  await raw.actorContext.create({
    data: {
      id: prototypeIds.bottomActorContextId,
      user: { connect: { id: prototypeIds.bottomUserId } },
      tenant: { connect: { id: prototypeIds.tenantId } },
      membership: { connect: { id: prototypeIds.bottomMembershipId } },
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
      appKey: prototypeIds.appKey,
      name: "Default app",
    },
  });

  await raw.app.create({
    data: {
      appKey: prototypeIds.partnerAppKey,
      name: "Partner app",
    },
  });

  await raw.tenantApp.create({
    data: {
      tenant: { connect: { id: prototypeIds.tenantId } },
      app: { connect: { appKey: prototypeIds.appKey } },
    },
  });

  await raw.tenantApp.create({
    data: {
      tenant: { connect: { id: prototypeIds.tenantId } },
      app: { connect: { appKey: prototypeIds.partnerAppKey } },
    },
  });

  // ── Auth Scopes ──

  await raw.authScope.create({
    data: {
      id: prototypeIds.bottomScopeId,
      tenant: { connect: { id: prototypeIds.tenantId } },
      type: "bottom",
      key: "__bottom",
      name: "Bottom scope",
      path: [prototypeIds.bottomScopeId],
    },
  });

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

  await raw.authScopeClosure.create({
    data: {
      ancestor: { connect: { id: prototypeIds.bottomScopeId } },
      descendant: { connect: { id: prototypeIds.bottomScopeId } },
      depth: 0,
    },
  });

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

  await raw.authScopeClosure.create({
    data: {
      ancestor: { connect: { id: prototypeIds.rootScopeId } },
      descendant: { connect: { id: prototypeIds.bottomScopeId } },
      depth: 1,
    },
  });

  await raw.collection.create({
    data: {
      appKey: prototypeIds.appKey,
      qualifiedCollectionKey: prototypeIds.projectCollectionKey,
      collectionKey: "projects",
      definitionKey: "projects",
      name: "Projects",
      schemaVersion: 1,
    },
  });

  await raw.collection.create({
    data: {
      appKey: prototypeIds.partnerAppKey,
      qualifiedCollectionKey: prototypeIds.partnerProjectCollectionKey,
      collectionKey: "projects",
      definitionKey: "projects",
      name: "Partner projects",
      schemaVersion: 1,
    },
  });

  await raw.collection.create({
    data: {
      appKey: prototypeIds.appKey,
      qualifiedCollectionKey: prototypeIds.lockedCollectionKey,
      collectionKey: "locked-documents",
      definitionKey: "locked-documents",
      name: "Locked documents",
      schemaVersion: 1,
    },
  });

  // ── Permissions / Roles / Assignments ──

  await raw.permission.createMany({
    data: [
      ...["create", "read", "update", "delete"].map((actionKey) => ({
        actionKey,
        appKey: prototypeIds.appKey,
        collectionKey: "projects",
        key: `${prototypeIds.appKey}:projects:${actionKey}`,
        source: "collection",
      })),
      ...["read", "update", "delete"].map((actionKey) => ({
        actionKey,
        appKey: prototypeIds.appKey,
        collectionKey: "locked-documents",
        key: `${prototypeIds.appKey}:locked-documents:${actionKey}`,
        source: "collection",
      })),
      {
        key: "partner:projects:read",
        actionKey: "read",
        appKey: prototypeIds.partnerAppKey,
        collectionKey: "projects",
        source: "collection",
      },
    ],
  });

  await raw.role.createMany({
    data: [
      {
        id: prototypeIds.projectAdminRoleId,
        tenantId: prototypeIds.tenantId,
        appKey: prototypeIds.appKey,
        key: "project-admin",
        name: "Project admin",
      },
      {
        id: prototypeIds.bottomReaderRoleId,
        tenantId: prototypeIds.tenantId,
        appKey: prototypeIds.appKey,
        key: "bottom-reader",
        name: "Bottom reader",
      },
    ],
  });

  const permissionKeys = [
    "default:projects:create",
    "default:projects:read",
    "default:projects:update",
    "default:projects:delete",
    "default:locked-documents:read",
    "default:locked-documents:update",
    "default:locked-documents:delete",
  ];

  await raw.rolePermission.createMany({
    data: [
      ...permissionKeys.map((permissionKey) => ({
        tenantId: prototypeIds.tenantId,
        roleId: prototypeIds.projectAdminRoleId,
        permissionKey,
      })),

      {
        tenantId: prototypeIds.tenantId,
        roleId: prototypeIds.bottomReaderRoleId,
        permissionKey: "default:projects:read",
      },
    ],
  });

  await raw.roleAssignment.create({
    data: {
      id: prototypeIds.projectAdminAssignmentId,
      tenantId: prototypeIds.tenantId,
      userId: prototypeIds.userId,
      roleId: prototypeIds.projectAdminRoleId,
      scopeId: prototypeIds.rootScopeId,
    },
  });

  await raw.roleAssignment.create({
    data: {
      id: prototypeIds.bottomReaderAssignmentId,
      tenantId: prototypeIds.tenantId,
      userId: prototypeIds.bottomUserId,
      roleId: prototypeIds.bottomReaderRoleId,
      scopeId: prototypeIds.bottomScopeId,
    },
  });

  // ── Managed Documents ──

  await raw.projectDocument.create({
    data: {
      documentId: prototypeIds.projectDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.childScopeId,
      appKey: prototypeIds.appKey,
      collectionKey: "projects",
      title: "Prototype project",
      status: "draft",
    },
  });

  await raw.projectDocument.create({
    data: {
      documentId: prototypeIds.bottomProjectDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.bottomScopeId,
      appKey: prototypeIds.appKey,
      collectionKey: "projects",
      title: "Bottom-scoped project",
      status: "draft",
    },
  });

  await raw.partnerProjectDocument.create({
    data: {
      documentId: prototypeIds.partnerProjectDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.childScopeId,
      appKey: prototypeIds.partnerAppKey,
      collectionKey: "projects",
      title: "Partner project",
      status: "draft",
    },
  });

  await raw.lockedDocument.create({
    data: {
      documentId: prototypeIds.lockedDocId,
      tenantId: prototypeIds.tenantId,
      authScopeId: prototypeIds.childScopeId,
      appKey: prototypeIds.appKey,
      collectionKey: "locked-documents",
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
      user: {
        include: {
          roleAssignments: {
            include: {
              scope: true,
              role: {
                include: {
                  rolePermissions: {
                    include: {
                      permission: {
                        include: {
                          app: true,
                          collection: true,
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

  const bottomActorContext = await raw.actorContext.findUniqueOrThrow({
    where: { id: prototypeIds.bottomActorContextId },
    include: {
      user: {
        include: {
          roleAssignments: {
            include: {
              scope: true,
              role: {
                include: {
                  rolePermissions: {
                    include: {
                      permission: {
                        include: {
                          app: true,
                          collection: true,
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

  return { actorContext, bottomActorContext } as const;
}
