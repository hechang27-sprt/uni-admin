import { applyJsonPatch } from "../json-patch";
import { normalizeListInput } from "../repository";
import { DocumentServiceError } from "../errors";
import type { JsonObject, ListDocumentsResult, StoredDocument } from "../types";
import type {
  CreateDocumentInput,
  CreateDocumentServiceOptions,
  CreateManyDocumentInput,
  DocumentService,
  GetDocumentInput,
  GetDocumentsByIdsInput,
  HardDeleteDocumentInput,
  ListDocumentServiceInput,
  PatchDocumentInput,
  RemoteCreateInput,
  RemoteCreateResult,
  RemoteDeleteDocumentResult,
  RemoteDeleteInput,
  RemoteUpdateInput,
  RemoteUpdateResult,
  SyncRemoteListInput,
  SyncRemoteListResult,
  SyncRemoteOneInput,
  SyncRemoteOneResult,
  UpdateDocumentInput,
  UpdateManyDocumentInput,
  VersionedDocumentInput,
} from "./contracts";
import {
  assertVersionAndUpdate,
  getRemoteAdapter,
  loadExisting,
  parseData,
  upsertRemoteProjection,
  upsertRemoteProjections,
  withRemoteOutput,
  type DocumentServiceDependencies,
} from "./helpers";

export function createDocumentService(
  options: CreateDocumentServiceOptions,
): DocumentService {
  const { registry, repository } = options;
  const dependencies: DocumentServiceDependencies = { registry, repository };

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

    async createMany<TData extends JsonObject>(
      input: CreateManyDocumentInput<TData>,
    ): Promise<StoredDocument<TData>[]> {
      const collection = registry.get(input.collection);
      const items = input.items.map((item) => ({
        data: parseData(
          collection.schema,
          item.data,
          input.collection,
        ) as TData,
        remoteSource: item.remoteSource,
        remoteId: item.remoteId,
      }));

      return repository.insertMany<TData>({
        tenantId: input.tenantId,
        collection: input.collection,
        schemaVersion: collection.schemaVersion,
        items,
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

    async getByIds<TData extends JsonObject>(
      input: GetDocumentsByIdsInput,
    ): Promise<(StoredDocument<TData> | null)[]> {
      registry.get(input.collection);

      return repository.findByIds<TData>({
        tenantId: input.tenantId,
        collection: input.collection,
        ids: input.ids,
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

      return assertVersionAndUpdate(dependencies, input, data as TData);
    },

    async updateMany<TData extends JsonObject>(
      input: UpdateManyDocumentInput<TData>,
    ): Promise<StoredDocument<TData>[]> {
      const collection = registry.get(input.collection);
      const items = input.items.map((item) => ({
        ...item,
        data: parseData(
          collection.schema,
          item.data,
          input.collection,
        ) as TData,
      }));
      const existingDocuments = await repository.findByIds<TData>({
        tenantId: input.tenantId,
        collection: input.collection,
        ids: items.map((item) => item.id),
      });

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const existing = existingDocuments[index];

        if (!item || !existing) {
          throw new DocumentServiceError("NOT_FOUND", "Document not found", {
            collection: input.collection,
            documentId: item?.id,
          });
        }

        if (existing.version !== item.expectedVersion) {
          throw new DocumentServiceError(
            "CONFLICT_STALE_VERSION",
            "Document version is stale",
            {
              collection: input.collection,
              documentId: item.id,
              expectedVersion: item.expectedVersion,
              currentVersion: existing.version,
            },
          );
        }
      }

      const records = items.map((item) => ({
        tenantId: input.tenantId,
        collection: input.collection,
        id: item.id,
        expectedVersion: item.expectedVersion,
        schemaVersion: collection.schemaVersion,
        data: item.data,
      }));
      const updated = await repository.updateMany<TData>({ records });

      if (!updated) {
        throw new DocumentServiceError(
          "CONFLICT_STALE_VERSION",
          "Document version is stale",
          {
            collection: input.collection,
          },
        );
      }

      return updated;
    },

    async patch<TData extends JsonObject>(
      input: PatchDocumentInput,
    ): Promise<StoredDocument<TData>> {
      const collection = registry.get(input.collection);
      const existing = await loadExisting(dependencies, input);

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

      return assertVersionAndUpdate<TData>(dependencies, input, data as TData);
    },

    async softDelete(input: VersionedDocumentInput): Promise<StoredDocument> {
      await loadExisting(dependencies, input);
      return assertVersionAndUpdate(dependencies, input, undefined, new Date());
    },

    async restore(input: VersionedDocumentInput): Promise<StoredDocument> {
      await loadExisting(dependencies, input, true);
      return assertVersionAndUpdate(dependencies, input, undefined, null);
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

    async syncRemoteOne<
      TData extends JsonObject,
      TSyncInput = unknown,
      TOutput = unknown,
    >(
      input: SyncRemoteOneInput<TSyncInput>,
    ): Promise<SyncRemoteOneResult<TData, TOutput>> {
      const adapter = getRemoteAdapter<
        TData,
        TSyncInput,
        never,
        never,
        never,
        never,
        { syncOne: TOutput }
      >(registry, input.collection);
      const result = await adapter.syncOne(input.input, {
        tenantId: input.tenantId,
        collection: input.collection,
      });
      const document = result.projection
        ? await upsertRemoteProjection<TData>(
            dependencies,
            input,
            result.projection,
          )
        : null;

      return withRemoteOutput({ document }, result.output);
    },

    async syncRemoteList<
      TData extends JsonObject,
      TSyncInput = unknown,
      TOutput = unknown,
    >(
      input: SyncRemoteListInput<TSyncInput>,
    ): Promise<SyncRemoteListResult<TData, TOutput>> {
      const adapter = getRemoteAdapter<
        TData,
        never,
        TSyncInput,
        never,
        never,
        never,
        { syncList: TOutput }
      >(registry, input.collection);
      const result = await adapter.syncList(input.input, {
        tenantId: input.tenantId,
        collection: input.collection,
      });
      const documents = await upsertRemoteProjections<TData>(
        dependencies,
        input,
        result.projections,
      );

      return withRemoteOutput({ documents }, result.output);
    },

    async remoteCreate<
      TData extends JsonObject,
      TCreateInput = unknown,
      TOutput = unknown,
    >(
      input: RemoteCreateInput<TCreateInput>,
    ): Promise<RemoteCreateResult<TData, TOutput>> {
      const adapter = getRemoteAdapter<
        TData,
        never,
        never,
        TCreateInput,
        never,
        never,
        { create: TOutput }
      >(registry, input.collection);
      const result = await adapter.createRemote(input.input, {
        tenantId: input.tenantId,
        collection: input.collection,
      });
      const document = await upsertRemoteProjection<TData>(
        dependencies,
        input,
        result.projection,
      );

      return withRemoteOutput({ document }, result.output);
    },

    async remoteUpdate<
      TData extends JsonObject,
      TUpdateInput = unknown,
      TOutput = unknown,
    >(
      input: RemoteUpdateInput<TUpdateInput>,
    ): Promise<RemoteUpdateResult<TData, TOutput>> {
      const adapter = getRemoteAdapter<
        TData,
        never,
        never,
        never,
        TUpdateInput,
        never,
        { update: TOutput }
      >(registry, input.collection);
      const collection = registry.get(input.collection);
      const current = (await loadExisting(
        dependencies,
        input,
      )) as StoredDocument<TData>;

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

      const result = await adapter.updateRemote(input.input, {
        tenantId: input.tenantId,
        collection: input.collection,
        current,
      });
      const data = parseData(
        collection.schema,
        result.projection.data,
        input.collection,
      );

      const document = await assertVersionAndUpdate<TData>(
        dependencies,
        input,
        data as TData,
        null,
        {
          remoteSource: adapter.remoteSource,
          remoteId: result.projection.remoteId,
        },
      );

      return withRemoteOutput({ document }, result.output);
    },

    async remoteDelete<TDeleteInput = unknown, TOutput = unknown>(
      input: RemoteDeleteInput<TDeleteInput>,
    ): Promise<RemoteDeleteDocumentResult<TOutput>> {
      const adapter = getRemoteAdapter<
        JsonObject,
        never,
        never,
        never,
        never,
        TDeleteInput,
        { delete: TOutput }
      >(registry, input.collection);
      const current = await loadExisting(dependencies, input);

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
          dependencies,
          input,
          result.projection,
        );
        const document = await assertVersionAndUpdate(
          dependencies,
          {
            tenantId: input.tenantId,
            collection: input.collection,
            id: projected.id,
            expectedVersion: projected.version,
          },
          undefined,
          new Date(),
        );
        return withRemoteOutput({ document }, result.output);
      }

      const document = await assertVersionAndUpdate(
        dependencies,
        input,
        undefined,
        new Date(),
      );
      const output = result ? result.output : undefined;
      return withRemoteOutput({ document }, output);
    },
  };
}
