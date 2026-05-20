import type { CollectionRegistry } from "./registry";
import { applyJsonPatch, type JsonPatchOperation } from "./json-patch";
import type { DocumentRepository } from "./repository";
import { normalizeListInput } from "./repository";
import { DocumentServiceError } from "./errors";
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
      ...(deletedAt !== undefined ? { deletedAt } : {}),
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
