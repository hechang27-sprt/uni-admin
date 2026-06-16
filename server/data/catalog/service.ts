import { inject, injectable } from "inversify";

import {
  DEFAULT_APP_KEY,
  type CollectionRegistry,
} from "#server/data/collections";
import { DocumentServiceError } from "#server/data/documents";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import { CatalogAppCache, CatalogCollectionCache } from "./cache";
import type {
  CatalogApp,
  CatalogCollection,
  CatalogRepository,
  EnableTenantAppInput,
  FindCatalogCollectionInput,
  FindTenantCatalogCollectionInput,
} from "./repository";

type EnableCatalogTenantAppInput = Omit<EnableTenantAppInput, "appKey"> & {
  appKey?: string;
};

const DEFAULT_APP_BOOTSTRAP = {
  key: DEFAULT_APP_KEY,
  name: "Default",
  config: { builtin: true },
} as const;

@injectable()
export class CatalogService {
  private readonly appCache = new CatalogAppCache();

  private readonly collectionCache = new CatalogCollectionCache();

  constructor(
    @inject(SERVER_DI_TYPES.CatalogRepository)
    private readonly repository: CatalogRepository,
    @inject(SERVER_DI_TYPES.CollectionRegistry)
    private readonly registry: CollectionRegistry,
  ) {}

  private async requireApp(appKey: string): Promise<CatalogApp> {
    const app =
      appKey === DEFAULT_APP_KEY
        ? (await this.repository.ensureApps([DEFAULT_APP_BOOTSTRAP]))[
            DEFAULT_APP_KEY
          ]
        : await this.findApp(appKey);

    if (!app) {
      throw new DocumentServiceError("NOT_FOUND", "Catalog app not found", {
        appKey,
      });
    }

    return this.appCache.refresh(app);
  }

  async syncRegistryCollections(
    registry: CollectionRegistry = this.registry,
  ): Promise<CatalogCollection[]> {
    return this.collectionCache.refreshCollections(
      await this.repository.syncCollections(registry),
    );
  }

  async enableTenantApp(
    input: EnableCatalogTenantAppInput,
  ): Promise<CatalogApp> {
    const appKey = input.appKey ?? DEFAULT_APP_KEY;
    const app = await this.requireApp(appKey);
    await this.repository.enableTenantApps([{ ...input, appKey }]);

    // Tenant collection misses are cached as null; enabling an app can turn
    // those misses into hits, so clear only this tenant/app boundary.
    this.collectionCache.invalidateTenantCollectionsForTenantApp(
      input.tenantId,
      appKey,
    );

    return app;
  }

  async findCollectionIdentity(
    input: FindCatalogCollectionInput,
  ): Promise<CatalogCollection | null> {
    const cachedCollection = this.collectionCache.getCollection(
      input.appKey,
      input.collectionKey,
    );

    if (cachedCollection !== undefined) {
      return cachedCollection;
    }

    return this.collectionCache.refreshCollection(
      await this.repository.findCollection(input),
      input,
    );
  }

  async findTenantCollectionIdentity(
    input: FindTenantCatalogCollectionInput,
  ): Promise<CatalogCollection | null> {
    const cachedCollection = this.collectionCache.getTenantCollection(input);

    if (cachedCollection !== undefined) {
      return cachedCollection;
    }

    return this.collectionCache.refreshTenantCollection(
      await this.repository.findTenantCollection(input),
      input,
    );
  }

  private async findApp(key: string): Promise<CatalogApp | null> {
    const cachedApp = this.appCache.get(key);

    if (cachedApp) {
      return cachedApp;
    }

    const app = await this.repository.findApp(key);

    return app ? this.appCache.refresh(app) : null;
  }
}
