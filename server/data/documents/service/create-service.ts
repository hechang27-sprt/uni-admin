import { applyJsonPatch } from "../json-patch";
import { normalizeListInput } from "../repository";
import { DocumentServiceError } from "../errors";
import {
  resolveCollectionOperationAuth,
  type CollectionOperation,
} from "../registry";
import type {
  JsonObject,
  ListDocumentsResult,
  StoredDocument,
  TenantActorContext,
} from "../types";
import type {
  CreateDocumentInput,
  CreateDocumentServiceOptions,
  CreateManyDocumentInput,
  DocumentServiceOptions,
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
  SetDocumentAuthScopeInput,
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
  const { registry, repository, authorizer } = options;
  const dependencies: DocumentServiceDependencies = { registry, repository };

  return {
    async create<TData extends JsonObject>(
      input: CreateDocumentInput<TData>,
      options?: DocumentServiceOptions,
    ): Promise<StoredDocument<TData>> {
      const collection = registry.get(input.collection);
      await authorizeCreate(input, input.authScopeId ?? null, options);
      const data = parseData(collection.schema, input.data, input.collection);

      return repository.insert<TData>({
        tenantId: input.tenantId,
        collection: input.collection,
        schemaVersion: collection.schemaVersion,
        data: data as TData,
        authScopeId: input.authScopeId,
        remoteSource: input.remoteSource,
        remoteId: input.remoteId,
      });
    },

    async createMany<TData extends JsonObject>(
      input: CreateManyDocumentInput<TData>,
      options?: DocumentServiceOptions,
    ): Promise<StoredDocument<TData>[]> {
      const collection = registry.get(input.collection);
      await Promise.all(
        input.items.map((item) =>
          authorizeCreate(input, item.authScopeId ?? null, options),
        ),
      );
      const items = input.items.map((item) => ({
        data: parseData(
          collection.schema,
          item.data,
          input.collection,
        ) as TData,
        authScopeId: item.authScopeId,
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
      options?: DocumentServiceOptions,
    ): Promise<StoredDocument<TData> | null> {
      registry.get(input.collection);

      const document = await repository.findById<TData>({
        tenantId: input.tenantId,
        collection: input.collection,
        id: input.id,
        includeDeleted: input.includeDeleted,
      });
      if (!document) {
        return null;
      }

      await authorizeDocument(input, options, "read", document);
      return document;
    },

    async getByIds<TData extends JsonObject>(
      input: GetDocumentsByIdsInput,
      options?: DocumentServiceOptions,
    ): Promise<(StoredDocument<TData> | null)[]> {
      registry.get(input.collection);

      const documents = await repository.findByIds<TData>({
        tenantId: input.tenantId,
        collection: input.collection,
        ids: input.ids,
        includeDeleted: input.includeDeleted,
      });

      return Promise.all(
        documents.map(async (document) => {
          if (!document) {
            return null;
          }
          const allowed = await checkDocumentAccess(
            input,
            options,
            "read",
            document,
          );
          return allowed ? document : null;
        }),
      );
    },

    async list<TData extends JsonObject>(
      input: ListDocumentServiceInput,
      options?: DocumentServiceOptions,
    ): Promise<ListDocumentsResult<TData>> {
      const collection = registry.get(input.collection);
      const query = normalizeListInput(input);
      let scopeIds: (string | null)[] | undefined;

      if (hasActorOptions(options)) {
        const auth = resolveCollectionOperationAuth(collection, "read");
        if (auth?.resourceScope === "none") {
          await assertScopeAccess(input, options, auth.capability, null);
        } else if (auth) {
          scopeIds = await buildAccessibleDocumentScopeFilter(
            input,
            options,
            auth.capability,
          );
        }
      }

      const items = await repository.list<TData>({
        tenantId: input.tenantId,
        collection: input.collection,
        query: { ...query, limit: query.limit + 1, authScopeIds: scopeIds },
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
      options?: DocumentServiceOptions,
    ): Promise<StoredDocument<TData>> {
      const collection = registry.get(input.collection);
      const existing = await loadExisting(dependencies, input);
      await authorizeDocument(input, options, "update", existing);
      const data = parseData(collection.schema, input.data, input.collection);

      return assertVersionAndUpdate(dependencies, input, data as TData);
    },

    async updateMany<TData extends JsonObject>(
      input: UpdateManyDocumentInput<TData>,
      options?: DocumentServiceOptions,
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

        await authorizeDocument(input, options, "update", existing);
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
      options?: DocumentServiceOptions,
    ): Promise<StoredDocument<TData>> {
      const collection = registry.get(input.collection);
      const existing = await loadExisting(dependencies, input);
      await authorizeDocument(input, options, "patch", existing);

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

    async softDelete(
      input: VersionedDocumentInput,
      options?: DocumentServiceOptions,
    ): Promise<StoredDocument> {
      const existing = await loadExisting(dependencies, input);
      await authorizeDocument(input, options, "delete", existing);
      return assertVersionAndUpdate(dependencies, input, undefined, new Date());
    },

    async restore(
      input: VersionedDocumentInput,
      options?: DocumentServiceOptions,
    ): Promise<StoredDocument> {
      const existing = await loadExisting(dependencies, input, true);
      await authorizeDocument(input, options, "restore", existing);
      return assertVersionAndUpdate(dependencies, input, undefined, null);
    },

    async hardDelete(
      input: HardDeleteDocumentInput,
      options?: DocumentServiceOptions,
    ): Promise<void> {
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

      const existing = await repository.findById({
        tenantId: input.tenantId,
        collection: input.collection,
        id: input.id,
        includeDeleted: true,
      });
      if (!existing) {
        throw new DocumentServiceError("NOT_FOUND", "Document not found", {
          collection: input.collection,
          documentId: input.id,
        });
      }
      await authorizeDocument(input, options, "hard-delete", existing);

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
      options?: DocumentServiceOptions,
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
      await authorizeCreate(input, input.authScopeId ?? null, options);
      const result = await adapter.createRemote(input.input, {
        tenantId: input.tenantId,
        collection: input.collection,
        ...(hasActorOptions(options) ? { actor: options.actor } : {}),
      });
      const document = await upsertRemoteProjection<TData>(
        dependencies,
        input,
        {
          ...result.projection,
          authScopeId: result.projection.authScopeId ?? input.authScopeId,
        },
      );

      return withRemoteOutput({ document }, result.output);
    },

    async remoteUpdate<
      TData extends JsonObject,
      TUpdateInput = unknown,
      TOutput = unknown,
    >(
      input: RemoteUpdateInput<TUpdateInput>,
      options?: DocumentServiceOptions,
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
      await authorizeDocument(input, options, "update", current);

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
        ...(hasActorOptions(options) ? { actor: options.actor } : {}),
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
      options?: DocumentServiceOptions,
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
      await authorizeDocument(input, options, "delete", current);

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
        ...(hasActorOptions(options) ? { actor: options.actor } : {}),
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

    async setDocumentAuthScope(
      input: SetDocumentAuthScopeInput,
      options: DocumentServiceOptions,
    ): Promise<StoredDocument> {
      const authenticatedOptions = requireActorOptions(input, options);
      const existing = await loadExisting(dependencies, input, true);
      await assertScopeAccess(
        input,
        authenticatedOptions,
        "admin:documents:set-scope",
        existing.authScopeId,
      );
      await assertScopeAccess(
        input,
        authenticatedOptions,
        "admin:documents:set-scope",
        input.authScopeId,
      );

      return assertVersionAndUpdate(
        dependencies,
        input,
        undefined,
        undefined,
        undefined,
        input.authScopeId,
      );
    },

    async listCreatableScopes(
      input: {
        tenantId: string;
        collection: string;
      },
      options: DocumentServiceOptions,
    ): Promise<(string | null)[]> {
      const authenticatedOptions = requireActorOptions(input, options);
      const collection = registry.get(input.collection);
      const auth = resolveCollectionOperationAuth(collection, "create");
      if (!auth) {
        return [];
      }
      if (auth.resourceScope === "none") {
        await assertScopeAccess(
          input,
          authenticatedOptions,
          auth.capability,
          null,
        );
        return [null];
      }

      return buildAccessibleDocumentScopeFilter(
        input,
        authenticatedOptions,
        auth.capability,
      );
    },
  };

  async function authorizeCreate(
    input: CreateDocumentInput | RemoteCreateInput | CreateManyDocumentInput,
    authScopeId: string | null,
    options?: DocumentServiceOptions,
  ): Promise<void> {
    if (!hasActorOptions(options)) {
      return;
    }

    const collection = registry.get(input.collection);
    const auth = resolveCollectionOperationAuth(collection, "create");
    if (!auth) {
      return;
    }

    await assertScopeAccess(
      input,
      options,
      auth.capability,
      auth.resourceScope === "none" ? null : authScopeId,
    );
  }

  async function authorizeDocument(
    input: { tenantId: string; collection: string },
    options: DocumentServiceOptions | undefined,
    operation: CollectionOperation,
    document: StoredDocument,
  ): Promise<void> {
    if (!hasActorOptions(options)) {
      return;
    }

    const collection = registry.get(input.collection);
    const auth = resolveCollectionOperationAuth(collection, operation);
    if (!auth) {
      return;
    }

    await assertScopeAccess(
      input,
      options,
      auth.capability,
      auth.resourceScope === "none" ? null : document.authScopeId,
    );
  }

  async function checkDocumentAccess(
    input: { tenantId: string; collection: string },
    options: DocumentServiceOptions | undefined,
    operation: CollectionOperation,
    document: StoredDocument,
  ): Promise<boolean> {
    if (!hasActorOptions(options)) {
      return true;
    }

    const collection = registry.get(input.collection);
    const auth = resolveCollectionOperationAuth(collection, operation);
    if (!auth) {
      return true;
    }

    return requireAuthorizer().checkAccess({
      context: actorContext(input, options),
      capability: auth.capability,
      targetScopeId:
        auth.resourceScope === "none" ? null : document.authScopeId,
    });
  }

  async function assertScopeAccess(
    input: { tenantId: string },
    options: AuthenticatedDocumentServiceOptions,
    capability: string,
    authScopeId: string | null,
  ): Promise<void> {
    const allowed = await requireAuthorizer().checkAccess({
      context: actorContext(input, options),
      capability,
      targetScopeId: authScopeId,
    });

    if (!allowed) {
      throw new DocumentServiceError(
        "AUTHORIZATION_DENIED",
        "Permission denied",
        {
          capability,
          authScopeId,
          tenantId: input.tenantId,
          userId: options.actor.userId,
        },
      );
    }
  }

  async function buildAccessibleDocumentScopeFilter(
    input: { tenantId: string },
    options: AuthenticatedDocumentServiceOptions,
    capability: string,
  ): Promise<(string | null)[]> {
    const [rootScopeId, accessibleScopeIds] = await Promise.all([
      requireAuthorizer().getTenantRootScopeId(input.tenantId),
      requireAuthorizer().listAccessibleScopeIds({
        context: actorContext(input, options),
        capability,
      }),
    ]);

    return accessibleScopeIds.map((scopeId) =>
      scopeId === rootScopeId ? null : scopeId,
    );
  }

  function requireAuthorizer() {
    if (!authorizer) {
      throw new DocumentServiceError(
        "AUTHORIZER_REQUIRED",
        "Document authorizer is required for actor-scoped service operations",
      );
    }

    return authorizer;
  }

  function requireActorOptions(
    input: { tenantId: string },
    options: DocumentServiceOptions,
  ): AuthenticatedDocumentServiceOptions {
    if (!hasActorOptions(options)) {
      throw new DocumentServiceError(
        "AUTHORIZATION_DENIED",
        "Document actor is required for actor-scoped service operations",
        { tenantId: input.tenantId },
      );
    }

    return options;
  }
}

type AuthenticatedDocumentServiceOptions = DocumentServiceOptions & {
  actor: TenantActorContext["actor"];
};

function actorContext(
  input: { tenantId: string },
  options: AuthenticatedDocumentServiceOptions,
): TenantActorContext {
  return {
    tenantId: input.tenantId,
    actor: options.actor,
  };
}

function hasActorOptions(
  options: DocumentServiceOptions | undefined,
): options is AuthenticatedDocumentServiceOptions {
  return Boolean(options?.actor);
}
