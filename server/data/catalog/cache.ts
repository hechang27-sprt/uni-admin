import { QueryableStructuredMultiKeyMap } from "associum";

import type { CatalogApp, CatalogCollection } from "./repository";

export class CatalogAppCache {
  private readonly cache = new Map<string, CatalogApp>();

  get(appKey: string): CatalogApp | null {
    return this.cache.get(appKey) ?? null;
  }

  refresh(app: CatalogApp): CatalogApp {
    this.cache.set(app.key, app);
    return app;
  }
}

type TenantCollectionCacheKey = {
  tenantId: string;
  appKey: string;
  collectionKey: string;
};

export class CatalogCollectionCache {
  private readonly collectionCache = new Map<
    string,
    CatalogCollection | null
  >();

  private readonly tenantCollectionCache = new QueryableStructuredMultiKeyMap<
    TenantCollectionCacheKey,
    CatalogCollection | null
  >();

  getCollection(
    appKey: string,
    collectionKey: string,
  ): CatalogCollection | null | undefined {
    const cacheKey = this.collectionCacheKey(appKey, collectionKey);

    if (!this.collectionCache.has(cacheKey)) {
      return undefined;
    }

    return this.collectionCache.get(cacheKey) ?? null;
  }

  refreshCollection(
    collection: CatalogCollection | null,
    input: {
      appKey: string;
      collectionKey: string;
    },
  ): CatalogCollection | null {
    this.collectionCache.set(
      this.collectionCacheKey(input.appKey, input.collectionKey),
      collection,
    );

    return collection;
  }

  getTenantCollection(
    input: TenantCollectionCacheKey,
  ): CatalogCollection | null | undefined {
    if (!this.tenantCollectionCache.has(input)) {
      return undefined;
    }

    return this.tenantCollectionCache.get(input) ?? null;
  }

  refreshTenantCollection(
    collection: CatalogCollection | null,
    input: TenantCollectionCacheKey,
  ): CatalogCollection | null {
    this.tenantCollectionCache.set(input, collection);

    return collection;
  }

  refreshCollections(collections: CatalogCollection[]): CatalogCollection[] {
    for (const collection of collections) {
      this.collectionCache.set(
        this.collectionCacheKey(collection.appKey, collection.key),
        collection,
      );
      this.invalidateTenantCollectionsForCollection(
        collection.appKey,
        collection.key,
      );
    }

    return collections;
  }

  invalidateTenantCollectionsForTenantApp(
    tenantId: string,
    appKey: string,
  ): void {
    for (const { key } of this.tenantCollectionCache.query({
      tenantId,
      appKey,
    })) {
      this.tenantCollectionCache.delete(key);
    }
  }

  private invalidateTenantCollectionsForCollection(
    appKey: string,
    collectionKey: string,
  ): void {
    for (const { key } of this.tenantCollectionCache.query({
      appKey,
      collectionKey,
    })) {
      this.tenantCollectionCache.delete(key);
    }
  }

  private collectionCacheKey(appKey: string, collectionKey: string): string {
    return `${appKey}:${collectionKey}`;
  }
}
