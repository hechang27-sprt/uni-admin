import type { CollectionRegistry } from "./registry";
import { applyJsonPatch, type JsonPatchOperation } from "./json-patch";
import type { DocumentRepository } from "./repository";
import { normalizeListInput } from "./repository";
import { DocumentServiceError } from "./errors";
import type {
  RemoteAdapterProjection,
  RemoteCollectionAdapter,
} from "./remote";
import type {
  JsonObject,
  ListDocumentsInput,
  ListDocumentsResult,
  StoredDocument,
  TenantContext,
} from "./types";

export interface CreateDocumentInput<
  TData extends JsonObject = JsonObject,
> extends TenantContext {
  collection: string;
  data: TData;
  remoteSource?: string | null;
  remoteId?: string | null;
}

export interface VersionedDocumentInput extends TenantContext {
  collection: string;
  id: string;
  expectedVersion: number;
}

export interface GetDocumentInput extends TenantContext {
  collection: string;
  id: string;
  includeDeleted?: boolean;
}

export interface UpdateDocumentInput<
  TData extends JsonObject = JsonObject,
> extends VersionedDocumentInput {
  data: TData;
}

export interface PatchDocumentInput extends VersionedDocumentInput {
  patch: JsonPatchOperation[];
}

export interface HardDeleteDocumentInput extends TenantContext {
  collection: string;
  id: string;
  confirmHardDelete: true;
}

export interface ListDocumentServiceInput
  extends TenantContext, ListDocumentsInput {
  collection: string;
}

export interface SyncRemoteOneInput<
  TSyncInput = unknown,
> extends TenantContext {
  collection: string;
  input: TSyncInput;
}

export interface SyncRemoteListInput<
  TSyncInput = unknown,
> extends TenantContext {
  collection: string;
  input: TSyncInput;
}

export interface RemoteCreateInput<
  TCreateInput = unknown,
> extends TenantContext {
  collection: string;
  input: TCreateInput;
}

export interface RemoteUpdateInput<
  TUpdateInput = unknown,
> extends VersionedDocumentInput {
  input: TUpdateInput;
}

export interface RemoteDeleteInput<
  TDeleteInput = unknown,
> extends VersionedDocumentInput {
  input: TDeleteInput;
}

export interface DocumentService {
  create<TData extends JsonObject>(
    input: CreateDocumentInput<TData>,
  ): Promise<StoredDocument<TData>>;
  getById<TData extends JsonObject>(
    input: GetDocumentInput,
  ): Promise<StoredDocument<TData> | null>;
  list<TData extends JsonObject>(
    input: ListDocumentServiceInput,
  ): Promise<ListDocumentsResult<TData>>;
  update<TData extends JsonObject>(
    input: UpdateDocumentInput<TData>,
  ): Promise<StoredDocument<TData>>;
  patch<TData extends JsonObject>(
    input: PatchDocumentInput,
  ): Promise<StoredDocument<TData>>;
  softDelete(input: VersionedDocumentInput): Promise<StoredDocument>;
  restore(input: VersionedDocumentInput): Promise<StoredDocument>;
  hardDelete(input: HardDeleteDocumentInput): Promise<void>;
  syncRemoteOne<TData extends JsonObject, TSyncInput = unknown>(
    input: SyncRemoteOneInput<TSyncInput>,
  ): Promise<StoredDocument<TData> | null>;
  syncRemoteList<TData extends JsonObject, TSyncInput = unknown>(
    input: SyncRemoteListInput<TSyncInput>,
  ): Promise<StoredDocument<TData>[]>;
  remoteCreate<TData extends JsonObject, TCreateInput = unknown>(
    input: RemoteCreateInput<TCreateInput>,
  ): Promise<StoredDocument<TData>>;
  remoteUpdate<TData extends JsonObject, TUpdateInput = unknown>(
    input: RemoteUpdateInput<TUpdateInput>,
  ): Promise<StoredDocument<TData>>;
  remoteDelete<TDeleteInput = unknown>(
    input: RemoteDeleteInput<TDeleteInput>,
  ): Promise<StoredDocument>;
}

export interface CreateDocumentServiceOptions {
  registry: CollectionRegistry;
  repository: DocumentRepository;
}

export function createDocumentService(
  options: CreateDocumentServiceOptions,
): DocumentService {
  const { registry, repository } = options;

  async function loadExisting(
    input: VersionedDocumentInput,
    includeDeleted = false,
  ): Promise<StoredDocument> {
    registry.get(input.collection);

    const existing = await repository.findById({
      tenantId: input.tenantId,
      collection: input.collection,
      id: input.id,
      includeDeleted,
    });

    if (!existing) {
      throw new DocumentServiceError("NOT_FOUND", "Document not found", {
        collection: input.collection,
        documentId: input.id,
      });
    }

    return existing;
  }

  async function assertVersionAndUpdate<TData extends JsonObject>(
    input: VersionedDocumentInput,
    data?: TData,
    deletedAt?: Date | null,
    remoteIdentity?: { remoteSource: string; remoteId: string },
  ): Promise<StoredDocument<TData>> {
    const existing = await loadExisting(input, true);

    if (existing.version !== input.expectedVersion) {
      throw new DocumentServiceError(
        "CONFLICT_STALE_VERSION",
        "Document version is stale",
        {
          collection: input.collection,
          documentId: input.id,
          expectedVersion: input.expectedVersion,
          currentVersion: existing.version,
        },
      );
    }

    const updated = await repository.update<TData>({
      tenantId: input.tenantId,
      collection: input.collection,
      id: input.id,
      expectedVersion: input.expectedVersion,
      data,
      schemaVersion: registry.get(input.collection).schemaVersion,
      ...(deletedAt !== undefined ? { deletedAt } : {}),
      ...(remoteIdentity
        ? {
            remoteSource: remoteIdentity.remoteSource,
            remoteId: remoteIdentity.remoteId,
          }
        : {}),
    });

    if (!updated) {
      throw new DocumentServiceError(
        "CONFLICT_STALE_VERSION",
        "Document version is stale",
        {
          collection: input.collection,
          documentId: input.id,
          expectedVersion: input.expectedVersion,
        },
      );
    }

    return updated;
  }

  async function upsertRemoteProjection<TData extends JsonObject>(
    input: TenantContext & { collection: string },
    projection: RemoteAdapterProjection<TData>,
  ): Promise<StoredDocument<TData>> {
    const collection = registry.get(input.collection);
    const adapter = collection.remoteAdapter;

    if (!adapter) {
      throw new DocumentServiceError(
        "UNSUPPORTED_OPERATION",
        "Collection is not remote-backed",
        {
          collection: input.collection,
        },
      );
    }

    const data = parseData(
      collection.schema,
      projection.data,
      input.collection,
    );
    const existing = await repository.findByRemoteIdentity<TData>({
      tenantId: input.tenantId,
      collection: input.collection,
      remoteSource: adapter.remoteSource,
      remoteId: projection.remoteId,
      includeDeleted: true,
    });

    if (!existing) {
      return repository.insert<TData>({
        tenantId: input.tenantId,
        collection: input.collection,
        schemaVersion: collection.schemaVersion,
        data: data as TData,
        remoteSource: adapter.remoteSource,
        remoteId: projection.remoteId,
      });
    }

    const updated = await repository.update<TData>({
      tenantId: input.tenantId,
      collection: input.collection,
      id: existing.id,
      expectedVersion: existing.version,
      schemaVersion: collection.schemaVersion,
      data: data as TData,
      deletedAt: null,
      remoteSource: adapter.remoteSource,
      remoteId: projection.remoteId,
    });

    if (!updated) {
      throw new DocumentServiceError(
        "CONFLICT_STALE_VERSION",
        "Document version is stale",
        {
          collection: input.collection,
          documentId: existing.id,
          expectedVersion: existing.version,
        },
      );
    }

    return updated;
  }

  function getRemoteAdapter<
    TData extends JsonObject,
    TSyncOneInput = never,
    TSyncListInput = never,
    TCreateInput = never,
    TUpdateInput = never,
    TDeleteInput = never,
  >(
    collectionName: string,
  ): RemoteCollectionAdapter<
    TData,
    TSyncOneInput,
    TSyncListInput,
    TCreateInput,
    TUpdateInput,
    TDeleteInput
  > {
    const collection = registry.get(collectionName);
    const adapter = collection.remoteAdapter;

    if (!adapter) {
      throw new DocumentServiceError(
        "UNSUPPORTED_OPERATION",
        "Collection is not remote-backed",
        {
          collection: collectionName,
        },
      );
    }

    return adapter as RemoteCollectionAdapter<
      TData,
      TSyncOneInput,
      TSyncListInput,
      TCreateInput,
      TUpdateInput,
      TDeleteInput
    >;
  }

  return {
    async create<TData extends JsonObject>(
      input: CreateDocumentInput<TData>,
    ): Promise<StoredDocument<TData>> {
      const collection = registry.get(input.collection);
      const data = parseData(collection.schema, input.data, input.collection);

      return repository.insert<TData>({
        tenantId: input.tenantId,
        collection: input.collection,
        schemaVersion: collection.schemaVersion,
        data: data as TData,
        remoteSource: input.remoteSource,
        remoteId: input.remoteId,
      });
    },

    async getById<TData extends JsonObject>(
      input: GetDocumentInput,
    ): Promise<StoredDocument<TData> | null> {
      registry.get(input.collection);

      return repository.findById<TData>({
        tenantId: input.tenantId,
        collection: input.collection,
        id: input.id,
        includeDeleted: input.includeDeleted,
      });
    },

    async list<TData extends JsonObject>(
      input: ListDocumentServiceInput,
    ): Promise<ListDocumentsResult<TData>> {
      registry.get(input.collection);
      const query = normalizeListInput(input);
      const items = await repository.list<TData>({
        tenantId: input.tenantId,
        collection: input.collection,
        query: { ...query, limit: query.limit + 1 },
      });

      return {
        items: items.slice(0, query.limit),
        limit: query.limit,
        offset: query.offset,
        hasMore: items.length > query.limit,
      };
    },

    async update<TData extends JsonObject>(
      input: UpdateDocumentInput<TData>,
    ): Promise<StoredDocument<TData>> {
      const collection = registry.get(input.collection);
      const data = parseData(collection.schema, input.data, input.collection);

      return assertVersionAndUpdate(input, data as TData);
    },

    async patch<TData extends JsonObject>(
      input: PatchDocumentInput,
    ): Promise<StoredDocument<TData>> {
      const collection = registry.get(input.collection);
      const existing = await loadExisting(input);

      if (existing.version !== input.expectedVersion) {
        throw new DocumentServiceError(
          "CONFLICT_STALE_VERSION",
          "Document version is stale",
          {
            collection: input.collection,
            documentId: input.id,
            expectedVersion: input.expectedVersion,
            currentVersion: existing.version,
          },
        );
      }

      const patched = applyJsonPatch(existing.data, input.patch);
      const data = parseData(collection.schema, patched, input.collection);

      return assertVersionAndUpdate<TData>(input, data as TData);
    },

    async softDelete(input: VersionedDocumentInput): Promise<StoredDocument> {
      await loadExisting(input);
      return assertVersionAndUpdate(input, undefined, new Date());
    },

    async restore(input: VersionedDocumentInput): Promise<StoredDocument> {
      await loadExisting(input, true);
      return assertVersionAndUpdate(input, undefined, null);
    },

    async hardDelete(input: HardDeleteDocumentInput): Promise<void> {
      registry.get(input.collection);

      if (input.confirmHardDelete !== true) {
        throw new DocumentServiceError(
          "HARD_DELETE_NOT_CONFIRMED",
          "Hard delete requires explicit confirmation",
          {
            collection: input.collection,
            documentId: input.id,
          },
        );
      }

      const deleted = await repository.hardDelete({
        tenantId: input.tenantId,
        collection: input.collection,
        id: input.id,
      });

      if (!deleted) {
        throw new DocumentServiceError("NOT_FOUND", "Document not found", {
          collection: input.collection,
          documentId: input.id,
        });
      }
    },

    async syncRemoteOne<TData extends JsonObject, TSyncInput = unknown>(
      input: SyncRemoteOneInput<TSyncInput>,
    ): Promise<StoredDocument<TData> | null> {
      const adapter = getRemoteAdapter<TData, TSyncInput>(input.collection);
      const projection = await adapter.syncOne(input.input, {
        tenantId: input.tenantId,
        collection: input.collection,
      });

      return projection
        ? upsertRemoteProjection<TData>(input, projection)
        : null;
    },

    async syncRemoteList<TData extends JsonObject, TSyncInput = unknown>(
      input: SyncRemoteListInput<TSyncInput>,
    ): Promise<StoredDocument<TData>[]> {
      const adapter = getRemoteAdapter<TData, never, TSyncInput>(
        input.collection,
      );
      const projections = await adapter.syncList(input.input, {
        tenantId: input.tenantId,
        collection: input.collection,
      });

      const documents: StoredDocument<TData>[] = [];
      for (const projection of projections) {
        documents.push(await upsertRemoteProjection<TData>(input, projection));
      }

      return documents;
    },

    async remoteCreate<TData extends JsonObject, TCreateInput = unknown>(
      input: RemoteCreateInput<TCreateInput>,
    ): Promise<StoredDocument<TData>> {
      const adapter = getRemoteAdapter<TData, never, never, TCreateInput>(
        input.collection,
      );
      const projection = await adapter.createRemote(input.input, {
        tenantId: input.tenantId,
        collection: input.collection,
      });

      return upsertRemoteProjection<TData>(input, projection);
    },

    async remoteUpdate<TData extends JsonObject, TUpdateInput = unknown>(
      input: RemoteUpdateInput<TUpdateInput>,
    ): Promise<StoredDocument<TData>> {
      const adapter = getRemoteAdapter<
        TData,
        never,
        never,
        never,
        TUpdateInput
      >(input.collection);
      const collection = registry.get(input.collection);
      const current = (await loadExisting(input)) as StoredDocument<TData>;

      if (current.version !== input.expectedVersion) {
        throw new DocumentServiceError(
          "CONFLICT_STALE_VERSION",
          "Document version is stale",
          {
            collection: input.collection,
            documentId: input.id,
            expectedVersion: input.expectedVersion,
            currentVersion: current.version,
          },
        );
      }

      const projection = await adapter.updateRemote(input.input, {
        tenantId: input.tenantId,
        collection: input.collection,
        current,
      });
      const data = parseData(
        collection.schema,
        projection.data,
        input.collection,
      );

      return assertVersionAndUpdate<TData>(input, data as TData, null, {
        remoteSource: adapter.remoteSource,
        remoteId: projection.remoteId,
      });
    },

    async remoteDelete<TDeleteInput = unknown>(
      input: RemoteDeleteInput<TDeleteInput>,
    ): Promise<StoredDocument> {
      const adapter = getRemoteAdapter<
        JsonObject,
        never,
        never,
        never,
        never,
        TDeleteInput
      >(input.collection);
      const current = await loadExisting(input);

      if (current.version !== input.expectedVersion) {
        throw new DocumentServiceError(
          "CONFLICT_STALE_VERSION",
          "Document version is stale",
          {
            collection: input.collection,
            documentId: input.id,
            expectedVersion: input.expectedVersion,
            currentVersion: current.version,
          },
        );
      }

      const result = await adapter.deleteRemote(input.input, {
        tenantId: input.tenantId,
        collection: input.collection,
        current,
      });

      if (result?.projection) {
        const projected = await upsertRemoteProjection(
          input,
          result.projection,
        );
        return assertVersionAndUpdate(
          {
            tenantId: input.tenantId,
            collection: input.collection,
            id: projected.id,
            expectedVersion: projected.version,
          },
          undefined,
          new Date(),
        );
      }

      return assertVersionAndUpdate(input, undefined, new Date());
    },
  };
}

function parseData<TData extends JsonObject>(
  schema: { parse: (data: unknown) => TData },
  data: unknown,
  collection: string,
): TData {
  try {
    return schema.parse(data);
  } catch (error) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      "Document data failed schema validation",
      {
        collection,
        issues: error,
      },
    );
  }
}
