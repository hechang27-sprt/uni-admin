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

export const prototypeKeys = {
  appKey: "default",
  partnerAppKey: "partner",
  projectCollectionKey: "default:projects",
  partnerProjectCollectionKey: "partner:projects",
  lockedCollectionKey: "default:locked-documents",
  projectCollectionLocalKey: "projects",
  lockedCollectionLocalKey: "locked-documents",
  bottomScopeId: "00000000-0000-0000-0000-000000000000",
} as const;

const actorAuthIncludes = {
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
} as const;

export type PrototypeClient = ZenStackClientType<typeof schema>;
export type PrototypeActorContext = Awaited<
  ReturnType<PrototypeClient["actorContext"]["findUniqueOrThrow"]>
>;
export type PrototypeProtectedClient = ReturnType<PrototypeClient["$use"]>;
export type PrototypeClients = Awaited<
  ReturnType<typeof createPrototypeClients>
>;

export interface PrototypeBootstrapState {
  tenant: { id: string; name: string | null };
  users: {
    projectAdmin: { id: string; displayName: string | null };
    bottomOnly: { id: string; displayName: string | null };
  };
  credentials: {
    projectAdmin: { userId: string; username: string };
    bottomOnly: { userId: string; username: string };
  };
  memberships: {
    projectAdmin: { id: string; tenantId: string; userId: string };
    bottomOnly: { id: string; tenantId: string; userId: string };
  };
  actorContexts: {
    projectAdmin: PrototypeActorContext;
    bottomOnly: PrototypeActorContext;
  };
  session: { tokenHash: string; tenantId: string | null; userId: string };
  apps: {
    default: { appKey: string; name: string | null };
    partner: { appKey: string; name: string | null };
  };
  tenantApps: {
    default: { tenantId: string; appKey: string };
    partner: { tenantId: string; appKey: string };
  };
  scopes: {
    bottom: { id: string; key: string | null; path: string[] };
    root: { id: string; key: string | null; path: string[] };
    child: { id: string; key: string | null; path: string[] };
    sibling: { id: string; key: string | null; path: string[] };
  };
  collections: {
    project: {
      appKey: string;
      collectionKey: string;
      qualifiedCollectionKey: string;
    };
    partnerProject: {
      appKey: string;
      collectionKey: string;
      qualifiedCollectionKey: string;
    };
    locked: {
      appKey: string;
      collectionKey: string;
      qualifiedCollectionKey: string;
    };
  };
  roles: {
    projectAdmin: { id: string; key: string };
    bottomReader: { id: string; key: string };
  };
  assignments: {
    projectAdmin: { id: string; userId: string; scopeId: string };
    bottomReader: { id: string; userId: string; scopeId: string };
  };
  permissions: {
    projectCreateKey: string;
    projectReadKey: string;
    projectUpdateKey: string;
    projectDeleteKey: string;
    lockedReadKey: string;
    lockedUpdateKey: string;
    lockedDeleteKey: string;
    partnerProjectReadKey: string;
  };
}

export interface PrototypeLifecycleContext {
  bootstrap: PrototypeBootstrapState;
  projectAdminDb: PrototypeProtectedClient;
  bottomOnlyDb: PrototypeProtectedClient;
}

export interface CreateProjectInput {
  db: PrototypeProtectedClient;
  tenantId: string;
  authScopeId: string;
  appKey: string;
  collectionKey: string;
  title: string;
  status?: string;
}

export interface CreateLockedDocumentInput {
  db: PrototypeProtectedClient;
  tenantId: string;
  authScopeId: string;
  title: string;
  locked?: boolean;
}

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

async function bootstrapPrototypeIdentity(raw: PrototypeClient) {
  const projectAdmin = await raw.user.create({
    data: {
      displayName: "Prototype User",
      status: "active",
    },
    select: { id: true, displayName: true },
  });

  const bottomOnly = await raw.user.create({
    data: {
      displayName: "Bottom-only User",
      status: "active",
    },
    select: { id: true, displayName: true },
  });

  const projectAdminCredential = await raw.userPasswordCredential.create({
    data: {
      userId: projectAdmin.id,
      username: "prototype",
      passwordHash: "$2b$10$prototype-hash",
    },
    select: { userId: true, username: true },
  });

  const bottomOnlyCredential = await raw.userPasswordCredential.create({
    data: {
      userId: bottomOnly.id,
      username: "prototype-bottom",
      passwordHash: "$2b$10$prototype-bottom-hash",
    },
    select: { userId: true, username: true },
  });

  const tenant = await raw.tenant.create({
    data: {
      name: "Prototype Tenant",
    },
    select: { id: true, name: true },
  });

  const projectAdminMembership = await raw.membership.create({
    data: {
      tenantId: tenant.id,
      userId: projectAdmin.id,
      status: "active",
    },
    select: { id: true, tenantId: true, userId: true },
  });

  const bottomOnlyMembership = await raw.membership.create({
    data: {
      tenantId: tenant.id,
      userId: bottomOnly.id,
      status: "active",
    },
    select: { id: true, tenantId: true, userId: true },
  });

  const projectAdminActor = await raw.actorContext.create({
    data: {
      userId: projectAdmin.id,
      tenantId: tenant.id,
      membershipId: projectAdminMembership.id,
    },
    select: { id: true },
  });

  const bottomOnlyActor = await raw.actorContext.create({
    data: {
      userId: bottomOnly.id,
      tenantId: tenant.id,
      membershipId: bottomOnlyMembership.id,
    },
    select: { id: true },
  });

  const session = await raw.authSession.create({
    data: {
      tokenHash: `prototype-token-${projectAdmin.id}`,
      tenantId: tenant.id,
      userId: projectAdmin.id,
      lastRenewedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
      absoluteExpiresAt: new Date(Date.now() + 7200_000),
    },
    select: { tokenHash: true, tenantId: true, userId: true },
  });

  return {
    tenant,
    users: {
      projectAdmin,
      bottomOnly,
    },
    credentials: {
      projectAdmin: projectAdminCredential,
      bottomOnly: bottomOnlyCredential,
    },
    memberships: {
      projectAdmin: projectAdminMembership,
      bottomOnly: bottomOnlyMembership,
    },
    actorIds: {
      projectAdmin: projectAdminActor.id,
      bottomOnly: bottomOnlyActor.id,
    },
    session,
  } as const;
}

async function bootstrapPrototypeCatalog(
  raw: PrototypeClient,
  tenantId: string,
) {
  const defaultApp = await raw.app.create({
    data: { appKey: prototypeKeys.appKey, name: "Default app" },
    select: { appKey: true, name: true },
  });

  const partnerApp = await raw.app.create({
    data: { appKey: prototypeKeys.partnerAppKey, name: "Partner app" },
    select: { appKey: true, name: true },
  });

  const defaultTenantApp = await raw.tenantApp.create({
    data: {
      tenantId,
      appKey: prototypeKeys.appKey,
      config: { lifecycle: "enabled" },
    },
    select: { tenantId: true, appKey: true },
  });

  const partnerTenantApp = await raw.tenantApp.create({
    data: {
      tenantId,
      appKey: prototypeKeys.partnerAppKey,
      config: { lifecycle: "enabled" },
    },
    select: { tenantId: true, appKey: true },
  });

  const projectCollection = await raw.collection.create({
    data: {
      appKey: prototypeKeys.appKey,
      qualifiedCollectionKey: prototypeKeys.projectCollectionKey,
      collectionKey: prototypeKeys.projectCollectionLocalKey,
      definitionKey: prototypeKeys.projectCollectionLocalKey,
      name: "Projects",
      schemaVersion: 1,
    },
    select: {
      appKey: true,
      collectionKey: true,
      qualifiedCollectionKey: true,
    },
  });

  const partnerProjectCollection = await raw.collection.create({
    data: {
      appKey: prototypeKeys.partnerAppKey,
      qualifiedCollectionKey: prototypeKeys.partnerProjectCollectionKey,
      collectionKey: prototypeKeys.projectCollectionLocalKey,
      definitionKey: prototypeKeys.projectCollectionLocalKey,
      name: "Partner projects",
      schemaVersion: 1,
    },
    select: {
      appKey: true,
      collectionKey: true,
      qualifiedCollectionKey: true,
    },
  });

  const lockedCollection = await raw.collection.create({
    data: {
      appKey: prototypeKeys.appKey,
      qualifiedCollectionKey: prototypeKeys.lockedCollectionKey,
      collectionKey: prototypeKeys.lockedCollectionLocalKey,
      definitionKey: prototypeKeys.lockedCollectionLocalKey,
      name: "Locked documents",
      schemaVersion: 1,
    },
    select: {
      appKey: true,
      collectionKey: true,
      qualifiedCollectionKey: true,
    },
  });

  return {
    apps: {
      default: defaultApp,
      partner: partnerApp,
    },
    tenantApps: {
      default: defaultTenantApp,
      partner: partnerTenantApp,
    },
    collections: {
      project: projectCollection,
      partnerProject: partnerProjectCollection,
      locked: lockedCollection,
    },
  } as const;
}

async function createAuthScope(
  raw: PrototypeClient,
  data: {
    tenantId: string;
    parentId?: string;
    type: string;
    key: string;
    name: string;
    bottomScopeId: string;
  },
) {
  const parent = data.parentId
    ? await raw.authScope.findFirstOrThrow({
        where: { id: data.parentId },
        include: {
          ancestors: {
            select: { depth: true, ancestorId: true },
            where: { ancestor: { tenantId: data.tenantId } },
          },
        },
      })
    : null;

  const scope = await raw.authScope.create({
    data: {
      tenantId: data.tenantId,
      parentId: data.parentId,
      type: data.type,
      key: data.key,
      name: data.name,
    },
    select: { id: true, key: true, path: true },
  });

  await raw.authScope.update({
    where: { id: scope.id },
    data: { path: [...(parent?.path ?? []), scope.id] },
  });

  const ancestorCls = parent
    ? parent.ancestors.map((cls) => ({
        ancestorId: cls.ancestorId,
        descendantId: scope.id,
        depth: cls.depth + 1,
      }))
    : [];

  await raw.authScopeClosure.createMany({
    data: [
      ...ancestorCls,
      {
        ancestorId: scope.id,
        descendantId: scope.id,
        depth: 0,
      },
      {
        ancestorId: scope.id,
        descendantId: data.bottomScopeId,
        depth: 1,
      },
    ],
  });

  return scope;
}

async function addPermissions(
  raw: PrototypeClient,
  data: {
    appKey: string;
    collectionKey: string;
    actionKeys: string[];
    source: string;
  },
) {
  const { actionKeys, ...collectionData } = data;
  await raw.permission.createMany({
    data: actionKeys.map((actionKey) =>
      Object.assign({}, collectionData, {
        actionKey,
        key: `${collectionData.appKey}:${collectionData.collectionKey}:${actionKey}`,
      }),
    ),
  });
}

async function bootstrapPrototypeAuthz(
  raw: PrototypeClient,
  identity: Awaited<ReturnType<typeof bootstrapPrototypeIdentity>>,
) {
  const bottomScope = await raw.authScope.create({
    data: {
      id: prototypeKeys.bottomScopeId,
      tenantId: identity.tenant.id,
      type: "bottom",
      key: "__bottom",
      name: "Bottom scope",
      path: [prototypeKeys.bottomScopeId],
    },
    select: { id: true, key: true, path: true },
  });
  const bottomScopeId = bottomScope.id;

  await raw.authScopeClosure.create({
    data: {
      ancestorId: bottomScopeId,
      descendantId: bottomScopeId,
      depth: 0,
    },
  });

  const rootScope = await createAuthScope(raw, {
    tenantId: identity.tenant.id,
    type: "tenant-root",
    key: "__root",
    name: "Root scope",
    bottomScopeId,
  });

  const childScope = await createAuthScope(raw, {
    tenantId: identity.tenant.id,
    parentId: rootScope.id,
    type: "organization",
    key: "engineering",
    name: "Engineering",
    bottomScopeId,
  });

  const siblingScope = await createAuthScope(raw, {
    tenantId: identity.tenant.id,
    parentId: rootScope.id,
    type: "organization",
    key: "marketing",
    name: "Marketing",
    bottomScopeId,
  });

  const permissions = {
    projectCreateKey: `${prototypeKeys.appKey}:${prototypeKeys.projectCollectionLocalKey}:create`,
    projectReadKey: `${prototypeKeys.appKey}:${prototypeKeys.projectCollectionLocalKey}:read`,
    projectUpdateKey: `${prototypeKeys.appKey}:${prototypeKeys.projectCollectionLocalKey}:update`,
    projectDeleteKey: `${prototypeKeys.appKey}:${prototypeKeys.projectCollectionLocalKey}:delete`,
    lockedReadKey: `${prototypeKeys.appKey}:${prototypeKeys.lockedCollectionLocalKey}:read`,
    lockedUpdateKey: `${prototypeKeys.appKey}:${prototypeKeys.lockedCollectionLocalKey}:update`,
    lockedDeleteKey: `${prototypeKeys.appKey}:${prototypeKeys.lockedCollectionLocalKey}:delete`,
    partnerProjectReadKey: `${prototypeKeys.partnerAppKey}:${prototypeKeys.projectCollectionLocalKey}:read`,
  } as const;

  await addPermissions(raw, {
    appKey: prototypeKeys.appKey,
    collectionKey: prototypeKeys.projectCollectionLocalKey,
    source: "collection",
    actionKeys: ["create", "read", "update", "delete"],
  });

  await addPermissions(raw, {
    appKey: prototypeKeys.appKey,
    collectionKey: prototypeKeys.lockedCollectionLocalKey,
    source: "collection",
    actionKeys: ["read", "update", "delete"],
  });

  await addPermissions(raw, {
    appKey: prototypeKeys.partnerAppKey,
    collectionKey: prototypeKeys.projectCollectionLocalKey,
    source: "collection",
    actionKeys: ["read"],
  });

  const projectAdminRole = await raw.role.create({
    data: {
      tenantId: identity.tenant.id,
      appKey: prototypeKeys.appKey,
      key: "project-admin",
      name: "Project admin",
    },
    select: { id: true, key: true },
  });

  const bottomReaderRole = await raw.role.create({
    data: {
      tenantId: identity.tenant.id,
      appKey: prototypeKeys.appKey,
      key: "bottom-reader",
      name: "Bottom reader",
    },
    select: { id: true, key: true },
  });

  await raw.rolePermission.createMany({
    data: Object.values(permissions).map((permissionKey) => ({
      tenantId: identity.tenant.id,
      roleId: projectAdminRole.id,
      permissionKey,
    })),
  });

  await raw.rolePermission.create({
    data: {
      tenantId: identity.tenant.id,
      roleId: bottomReaderRole.id,
      permissionKey: permissions.projectReadKey,
    },
  });

  const projectAdminAssignment = await raw.roleAssignment.create({
    data: {
      tenantId: identity.tenant.id,
      userId: identity.users.projectAdmin.id,
      roleId: projectAdminRole.id,
      scopeId: rootScope.id,
    },
    select: { id: true, userId: true, scopeId: true },
  });

  const bottomReaderAssignment = await raw.roleAssignment.create({
    data: {
      tenantId: identity.tenant.id,
      userId: identity.users.bottomOnly.id,
      roleId: bottomReaderRole.id,
      scopeId: bottomScope.id,
    },
    select: { id: true, userId: true, scopeId: true },
  });

  return {
    scopes: {
      bottom: bottomScope,
      root: rootScope,
      child: childScope,
      sibling: siblingScope,
    },
    permissions,
    roles: {
      projectAdmin: projectAdminRole,
      bottomReader: bottomReaderRole,
    },
    assignments: {
      projectAdmin: projectAdminAssignment,
      bottomReader: bottomReaderAssignment,
    },
  } as const;
}

async function loadPrototypeActorContext(
  raw: PrototypeClient,
  actorContextId: string,
) {
  return raw.actorContext.findUniqueOrThrow({
    where: { id: actorContextId },
    include: actorAuthIncludes,
  });
}

export async function seedPrototypeState(raw: PrototypeClient) {
  const identity = await bootstrapPrototypeIdentity(raw);
  const catalog = await bootstrapPrototypeCatalog(raw, identity.tenant.id);
  const authz = await bootstrapPrototypeAuthz(raw, identity);

  const [projectAdmin, bottomOnly] = await Promise.all([
    loadPrototypeActorContext(raw, identity.actorIds.projectAdmin),
    loadPrototypeActorContext(raw, identity.actorIds.bottomOnly),
  ]);

  return {
    tenant: identity.tenant,
    users: identity.users,
    credentials: identity.credentials,
    memberships: identity.memberships,
    actorContexts: {
      projectAdmin,
      bottomOnly,
    },
    session: identity.session,
    apps: catalog.apps,
    tenantApps: catalog.tenantApps,
    scopes: authz.scopes,
    collections: catalog.collections,
    roles: authz.roles,
    assignments: authz.assignments,
    permissions: authz.permissions,
  } satisfies PrototypeBootstrapState;
}

export async function setupPrototypeLifecycle(clients: PrototypeClients) {
  const bootstrap = await seedPrototypeState(clients.raw);

  return {
    bootstrap,
    projectAdminDb: clients.protectedClient.$setAuth(
      bootstrap.actorContexts.projectAdmin,
    ),
    bottomOnlyDb: clients.protectedClient.$setAuth(
      bootstrap.actorContexts.bottomOnly,
    ),
  } satisfies PrototypeLifecycleContext;
}

export async function createProjectDocument(input: CreateProjectInput) {
  return input.db.projectDocument.create({
    data: {
      tenantId: input.tenantId,
      authScopeId: input.authScopeId,
      appKey: input.appKey,
      collectionKey: input.collectionKey,
      title: input.title,
      status: input.status ?? "draft",
    },
    select: {
      documentId: true,
      tenantId: true,
      authScopeId: true,
      appKey: true,
      collectionKey: true,
      qualifiedCollectionKey: true,
      title: true,
      status: true,
      version: true,
      deletedAt: true,
    },
  });
}

export async function createLockedDocument(input: CreateLockedDocumentInput) {
  return input.db.lockedDocument.create({
    data: {
      tenantId: input.tenantId,
      authScopeId: input.authScopeId,
      appKey: prototypeKeys.appKey,
      collectionKey: prototypeKeys.lockedCollectionLocalKey,
      title: input.title,
      locked: input.locked ?? true,
    },
    select: {
      documentId: true,
      authScopeId: true,
      title: true,
      locked: true,
      qualifiedCollectionKey: true,
    },
  });
}

export async function updateProjectStatus(
  db: PrototypeProtectedClient,
  documentId: string,
  status: string,
) {
  return db.projectDocument.update({
    where: { documentId },
    data: { status },
    select: {
      documentId: true,
      status: true,
      version: true,
      updatedAt: true,
    },
  });
}

export async function createProjectRevision(
  raw: PrototypeClient,
  documentId: string,
  body: string,
) {
  return raw.projectRevision.create({
    data: {
      documentId,
      body,
    },
    select: {
      id: true,
      body: true,
      document: {
        select: {
          documentId: true,
          title: true,
        },
      },
    },
  });
}

export async function softDeleteDocument(
  raw: PrototypeClient,
  documentId: string,
) {
  return raw.documentBase.update({
    where: { documentId },
    data: { deletedAt: new Date() },
    select: {
      documentId: true,
      deletedAt: true,
      version: true,
    },
  });
}

export async function restoreDocument(
  raw: PrototypeClient,
  documentId: string,
) {
  return raw.documentBase.update({
    where: { documentId },
    data: { deletedAt: null },
    select: {
      documentId: true,
      deletedAt: true,
      version: true,
    },
  });
}

export async function hardDeleteDocument(
  raw: PrototypeClient,
  documentId: string,
) {
  await raw.documentBase.delete({
    where: { documentId },
  });
}
