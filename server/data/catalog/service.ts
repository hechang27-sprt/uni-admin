import { inject, injectable } from "inversify";

import { DEFAULT_APP_KEY, type CollectionRegistry } from "#server/data/collections";
import { DocumentServiceError } from "#server/data/documents";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import type {
  CatalogApp,
  CatalogCollection,
  CatalogRepository,
  EnableTenantAppInput,
  FindCatalogCollectionInput,
  FindTenantCatalogCollectionInput,
} from "./repository";

const DEFAULT_APP_BOOTSTRAP = {
  key: DEFAULT_APP_KEY,
  name: "Default",
  config: { builtin: true },
} as const;

@injectable()
export class CatalogService {
  constructor(
    @inject(SERVER_DI_TYPES.CatalogRepository)
    private readonly repository: CatalogRepository,
    @inject(SERVER_DI_TYPES.CollectionRegistry)
    private readonly registry: CollectionRegistry,
  ) {}

  async ensureDefaultApp(): Promise<CatalogApp> {
    const apps = await this.repository.ensureApps([DEFAULT_APP_BOOTSTRAP]);

    return this.requireApp(DEFAULT_APP_KEY, apps[DEFAULT_APP_KEY] ?? null);
  }

  syncRegistryCollections(
    registry: CollectionRegistry = this.registry,
  ): Promise<CatalogCollection[]> {
    return this.repository.syncCollections(registry);
  }

  async enableDefaultAppForTenant(tenantId: string): Promise<CatalogApp> {
    const app = await this.ensureDefaultApp();

    await this.repository.enableTenantApps([{ tenantId, appKey: app.key }]);

    return app;
  }

  async enableTenantApp(input: EnableTenantAppInput): Promise<CatalogApp> {
    const app = await this.repository.findApp(input.appKey);

    await this.repository.enableTenantApps([
      { ...input, appKey: this.requireApp(input.appKey, app).key },
    ]);

    return this.requireApp(input.appKey, app);
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

  private requireApp(key: string, app: CatalogApp | null): CatalogApp {
    if (app) {
      return app;
    }

    throw new DocumentServiceError("NOT_FOUND", "Catalog app not found", {
      appKey: key,
    });
  }
}
