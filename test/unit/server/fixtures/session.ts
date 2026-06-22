import { CollectionRegistry } from "#server/data/collections";
import { createServerContainer, SERVER_DI_TYPES } from "#server/di";
import { SessionService, type SessionServiceOptions } from "#server/auth/session";
import { KyselySessionRepository } from "#server/auth/session/repository";
import type { AuthRbacService } from "#server/auth/um";
import type { DatabaseClient } from "#server/utils/kysely";

import { tenantA, tenantB } from "./service";

export const sessionTestOptions: SessionServiceOptions = {
  idleTimeoutMs: 30 * 60 * 1000,
  renewalThresholdMs: 10 * 60 * 1000,
  absoluteTimeoutMs: 45 * 60 * 1000,
};

export async function prepareSessionTestDatabase(database: DatabaseClient) {
  await database
    .insertInto("tenants")
    .values([
      { id: tenantA, name: "Test Tenant A" },
      { id: tenantB, name: "Test Tenant B" },
    ])
    .execute();
}

export function createSessionServices(
  database: DatabaseClient,
  options: SessionServiceOptions = sessionTestOptions,
): {
  auth: AuthRbacService;
  session: SessionService;
} {
  const container = createServerContainer({
    database,
    registry: CollectionRegistry.fromRegistrations([]),
  });

  const auth = container.get<AuthRbacService>(SERVER_DI_TYPES.AuthRbacService);
  const session = new SessionService(
    auth,
    new KyselySessionRepository(database),
    options,
  );

  return { auth, session };
}
