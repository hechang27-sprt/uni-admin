import { inject, injectable } from "inversify";

import { DEFAULT_APP_KEY, type CollectionRegistry } from "#server/data/collections";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import type {
  CatalogApp,
  CatalogCollection,
  CatalogRepository,
  EnableTenantAppInput,
  FindCatalogCollectionInput,
  FindTenantCatalogCollectionInput,
} from "./repository";

@injectable()
export class CatalogService {
  constructor(
    @inject(SERVER_DI_TYPES.CatalogRepository)
    private readonly repository: CatalogRepository,
    @inject(SERVER_DI_TYPES.CollectionRegistry)
    private readonly registry: CollectionRegistry,
  ) {}

  ensureDefaultApp(): Promise<CatalogApp> {
    return this.repository.ensureApp({
      key: DEFAULT_APP_KEY,
      name: "Default",
      config: { builtin: true },
    });
  }

  syncRegistryCollections(
    registry: CollectionRegistry = this.registry,
  ): Promise<CatalogCollection[]> {
    return this.repository.syncCollections(registry);
  }

  enableDefaultAppForTenant(tenantId: string): Promise<CatalogApp> {
    return this.repository.enableTenantApp({
      tenantId,
      appKey: DEFAULT_APP_KEY,
    });
  }

  enableTenantApp(input: EnableTenantAppInput): Promise<CatalogApp> {
    return this.repository.enableTenantApp(input);
  }

  findCollectionIdentity(
    input: FindCatalogCollectionInput,
  ): Promise<CatalogCollection | null> {
    return this.repository.findCollection(input);
  }

  findTenantCollectionIdentity(
    input: FindTenantCatalogCollectionInput,
  ): Promise<CatalogCollection | null> {
    return this.repository.findTenantCollection(input);
  }
}
