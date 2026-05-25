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
  DocumentServiceConfig,
  CreateManyDocumentInput,
  DocumentServiceOptions,
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

export class DocumentService {
  private readonly registry: DocumentServiceConfig["registry"];
  private readonly repository: DocumentServiceConfig["repository"];
  private readonly authorizer: DocumentServiceConfig["authorizer"];
  private readonly dependencies: DocumentServiceDependencies;

  constructor(options: DocumentServiceConfig) {
    this.registry = options.registry;
    this.repository = options.repository;
    this.authorizer = options.authorizer;
    this.dependencies = {
      registry: options.registry,
      repository: options.repository,
    };
  }

  async create<TData extends JsonObject>(
    input: CreateDocumentInput<TData>,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument<TData>> {
    const collection = this.registry.get(input.collection);
    await this.authorizeCreate(input, [input.authScopeId ?? null], options);
    const data = parseData(collection.schema, input.data, input.collection);

    const [created] = await this.repository.insertMany<TData>({
      tenantId: input.tenantId,
      collection: input.collection,
      schemaVersion: collection.schemaVersion,
      items: [
        {
          data: data as TData,
          authScopeId: input.authScopeId,
          remoteSource: input.remoteSource,
          remoteId: input.remoteId,
        },
      ],
    });

    return assertServiceDocument(
      created,
      "Document insert did not return a row",
    );
  }

  async createMany<TData extends JsonObject>(
    input: CreateManyDocumentInput<TData>,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument<TData>[]> {
    const collection = this.registry.get(input.collection);
    await this.authorizeCreate(
      input,
      input.items.map((item) => item.authScopeId ?? null),
      options,
    );
    const items = input.items.map((item) => ({
      data: parseData(collection.schema, item.data, input.collection) as TData,
      authScopeId: item.authScopeId,
      remoteSource: item.remoteSource,
      remoteId: item.remoteId,
    }));

    return this.repository.insertMany<TData>({
      tenantId: input.tenantId,
      collection: input.collection,
      schemaVersion: collection.schemaVersion,
      items,
    });
  }

  async getById<TData extends JsonObject>(
    input: GetDocumentInput,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument<TData> | null> {
    this.registry.get(input.collection);

    const [document] = await this.repository.findByIds<TData>({
      tenantId: input.tenantId,
      collection: input.collection,
      ids: [input.id],
      includeDeleted: input.includeDeleted,
    });
    if (!document) {
      return null;
    }

    await this.authorizeDocuments(input, options, "read", [document]);
    return document;
  }

  async getByIds<TData extends JsonObject>(
    input: GetDocumentsByIdsInput,
    options?: DocumentServiceOptions,
  ): Promise<(StoredDocument<TData> | null)[]> {
    this.registry.get(input.collection);

    const documents = await this.repository.findByIds<TData>({
      tenantId: input.tenantId,
      collection: input.collection,
      ids: input.ids,
      includeDeleted: input.includeDeleted,
    });

    const existingDocuments = documents.filter(
      (document): document is StoredDocument<TData> => document !== null,
    );
    const accessResults = await this.checkDocumentAccesses(
      input,
      options,
      "read",
      existingDocuments,
    );
    let existingIndex = 0;

    return documents.map((document) => {
      if (!document) {
        return null;
      }
      const allowed = accessResults[existingIndex];
      existingIndex += 1;
      return allowed ? document : null;
    });
  }

  async list<TData extends JsonObject>(
    input: ListDocumentServiceInput,
    options?: DocumentServiceOptions,
  ): Promise<ListDocumentsResult<TData>> {
    const collection = this.registry.get(input.collection);
    const query = normalizeListInput(input);
    let scopeIds: (string | null)[] | undefined;

    if (hasActorOptions(options)) {
      const auth = resolveCollectionOperationAuth(collection, "read");
      if (auth?.resourceScope === "none") {
        await this.assertScopeAccess(input, options, auth.capability, null);
      } else if (auth) {
        scopeIds = await this.buildAccessibleDocumentScopeFilter(
          input,
          options,
          auth.capability,
        );
      }
    }

    const items = await this.repository.list<TData>({
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
  }

  async update<TData extends JsonObject>(
    input: UpdateDocumentInput<TData>,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument<TData>> {
    const collection = this.registry.get(input.collection);
    const existing = await loadExisting(this.dependencies, input);
    await this.authorizeDocuments(input, options, "update", [existing]);
    const data = parseData(collection.schema, input.data, input.collection);

    return assertVersionAndUpdate(
      this.dependencies,
      input,
      existing,
      data as TData,
    );
  }

  async updateMany<TData extends JsonObject>(
    input: UpdateManyDocumentInput<TData>,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument<TData>[]> {
    const collection = this.registry.get(input.collection);
    const items = input.items.map((item) => ({
      ...item,
      data: parseData(collection.schema, item.data, input.collection) as TData,
    }));
    const existingDocuments = await this.repository.findByIds<TData>({
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
    await this.authorizeDocuments(
      input,
      options,
      "update",
      existingDocuments as StoredDocument<TData>[],
    );

    const records = items.map((item) => ({
      tenantId: input.tenantId,
      collection: input.collection,
      id: item.id,
      expectedVersion: item.expectedVersion,
      schemaVersion: collection.schemaVersion,
      data: item.data,
    }));
    const updated = await this.repository.updateMany<TData>({ records });

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
  }

  async patch<TData extends JsonObject>(
    input: PatchDocumentInput,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument<TData>> {
    const collection = this.registry.get(input.collection);
    const existing = await loadExisting(this.dependencies, input);
    await this.authorizeDocuments(input, options, "patch", [existing]);

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

    return assertVersionAndUpdate<TData>(
      this.dependencies,
      input,
      existing,
      data as TData,
    );
  }

  async softDelete(
    input: VersionedDocumentInput,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument> {
    const existing = await loadExisting(this.dependencies, input);
    await this.authorizeDocuments(input, options, "delete", [existing]);
    return assertVersionAndUpdate(
      this.dependencies,
      input,
      existing,
      undefined,
      new Date(),
    );
  }

  async restore(
    input: VersionedDocumentInput,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument> {
    const existing = await loadExisting(this.dependencies, input, true);
    await this.authorizeDocuments(input, options, "restore", [existing]);
    return assertVersionAndUpdate(
      this.dependencies,
      input,
      existing,
      undefined,
      null,
    );
  }

  async hardDelete(
    input: HardDeleteDocumentInput,
    options?: DocumentServiceOptions,
  ): Promise<void> {
    this.registry.get(input.collection);

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

    const [existing] = await this.repository.findByIds({
      tenantId: input.tenantId,
      collection: input.collection,
      ids: [input.id],
      includeDeleted: true,
    });
    if (!existing) {
      throw new DocumentServiceError("NOT_FOUND", "Document not found", {
        collection: input.collection,
        documentId: input.id,
      });
    }
    await this.authorizeDocuments(input, options, "hard-delete", [existing]);

    const deletedIds = await this.repository.hardDeleteMany({
      tenantId: input.tenantId,
      collection: input.collection,
      ids: [input.id],
    });

    if (!deletedIds.includes(input.id)) {
      throw new DocumentServiceError("NOT_FOUND", "Document not found", {
        collection: input.collection,
        documentId: input.id,
      });
    }
  }

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
    >(this.registry, input.collection);
    const result = await adapter.syncOne(input.input, {
      tenantId: input.tenantId,
      collection: input.collection,
    });
    const document = result.projection
      ? await upsertRemoteProjection<TData>(
          this.dependencies,
          input,
          result.projection,
        )
      : null;

    return withRemoteOutput({ document }, result.output);
  }

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
    >(this.registry, input.collection);
    const result = await adapter.syncList(input.input, {
      tenantId: input.tenantId,
      collection: input.collection,
    });
    const documents = await upsertRemoteProjections<TData>(
      this.dependencies,
      input,
      result.projections,
    );

    return withRemoteOutput({ documents }, result.output);
  }

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
    >(this.registry, input.collection);
    await this.authorizeCreate(input, [input.authScopeId ?? null], options);
    const result = await adapter.createRemote(input.input, {
      tenantId: input.tenantId,
      collection: input.collection,
      ...(hasActorOptions(options) ? { actor: options.actor } : {}),
    });
    const document = await upsertRemoteProjection<TData>(
      this.dependencies,
      input,
      {
        ...result.projection,
        authScopeId: result.projection.authScopeId ?? input.authScopeId,
      },
    );

    return withRemoteOutput({ document }, result.output);
  }

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
    >(this.registry, input.collection);
    const collection = this.registry.get(input.collection);
    const current = (await loadExisting(
      this.dependencies,
      input,
    )) as StoredDocument<TData>;
    await this.authorizeDocuments(input, options, "update", [current]);

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
      this.dependencies,
      input,
      current,
      data as TData,
      null,
      {
        remoteSource: adapter.remoteSource,
        remoteId: result.projection.remoteId,
      },
    );

    return withRemoteOutput({ document }, result.output);
  }

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
    >(this.registry, input.collection);
    const current = await loadExisting(this.dependencies, input);
    await this.authorizeDocuments(input, options, "delete", [current]);

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
        this.dependencies,
        input,
        result.projection,
      );
      const document = await assertVersionAndUpdate(
        this.dependencies,
        {
          tenantId: input.tenantId,
          collection: input.collection,
          id: projected.id,
          expectedVersion: projected.version,
        },
        projected,
        undefined,
        new Date(),
      );
      return withRemoteOutput({ document }, result.output);
    }

    const document = await assertVersionAndUpdate(
      this.dependencies,
      input,
      current,
      undefined,
      new Date(),
    );
    const output = result ? result.output : undefined;
    return withRemoteOutput({ document }, output);
  }

  async setDocumentAuthScope(
    input: SetDocumentAuthScopeInput,
    options: DocumentServiceOptions,
  ): Promise<StoredDocument> {
    const authenticatedOptions = this.requireActorOptions(input, options);
    const existing = await loadExisting(this.dependencies, input, true);
    await this.assertScopeAccesses(
      input,
      authenticatedOptions,
      "admin:documents:set-scope",
      [existing.authScopeId, input.authScopeId],
    );

    return assertVersionAndUpdate(
      this.dependencies,
      input,
      existing,
      undefined,
      undefined,
      undefined,
      input.authScopeId,
    );
  }

  async listCreatableScopes(
    input: {
      tenantId: string;
      collection: string;
    },
    options: DocumentServiceOptions,
  ): Promise<(string | null)[]> {
    const authenticatedOptions = this.requireActorOptions(input, options);
    const collection = this.registry.get(input.collection);
    const auth = resolveCollectionOperationAuth(collection, "create");
    if (!auth) {
      return [];
    }
    if (auth.resourceScope === "none") {
      await this.assertScopeAccess(
        input,
        authenticatedOptions,
        auth.capability,
        null,
      );
      return [null];
    }

    return this.buildAccessibleDocumentScopeFilter(
      input,
      authenticatedOptions,
      auth.capability,
    );
  }

  private async authorizeCreate(
    input: CreateDocumentInput | RemoteCreateInput | CreateManyDocumentInput,
    authScopeIds: (string | null)[],
    options?: DocumentServiceOptions,
  ): Promise<void> {
    if (!hasActorOptions(options)) {
      return;
    }

    const collection = this.registry.get(input.collection);
    const auth = resolveCollectionOperationAuth(collection, "create");
    if (!auth) {
      return;
    }

    await this.assertScopeAccesses(
      input,
      options,
      auth.capability,
      auth.resourceScope === "none" ? [null] : authScopeIds,
    );
  }

  private async authorizeDocuments(
    input: { tenantId: string; collection: string },
    options: DocumentServiceOptions | undefined,
    operation: CollectionOperation,
    documents: StoredDocument[],
  ): Promise<void> {
    if (!hasActorOptions(options)) {
      return;
    }

    const collection = this.registry.get(input.collection);
    const auth = resolveCollectionOperationAuth(collection, operation);
    if (!auth) {
      return;
    }

    await this.assertScopeAccesses(
      input,
      options,
      auth.capability,
      auth.resourceScope === "none"
        ? [null]
        : documents.map((document) => document.authScopeId),
    );
  }

  private async checkDocumentAccesses(
    input: { tenantId: string; collection: string },
    options: DocumentServiceOptions | undefined,
    operation: CollectionOperation,
    documents: StoredDocument[],
  ): Promise<boolean[]> {
    if (!hasActorOptions(options)) {
      return documents.map(() => true);
    }

    const collection = this.registry.get(input.collection);
    const auth = resolveCollectionOperationAuth(collection, operation);
    if (!auth) {
      return documents.map(() => true);
    }

    return this.checkScopeAccesses(
      input,
      options,
      auth.capability,
      auth.resourceScope === "none"
        ? documents.map(() => null)
        : documents.map((document) => document.authScopeId),
    );
  }

  private async assertScopeAccess(
    input: { tenantId: string },
    options: AuthenticatedDocumentServiceOptions,
    capability: string,
    authScopeId: string | null,
  ): Promise<void> {
    await this.assertScopeAccesses(input, options, capability, [authScopeId]);
  }

  private async assertScopeAccesses(
    input: { tenantId: string },
    options: AuthenticatedDocumentServiceOptions,
    capability: string,
    authScopeIds: (string | null)[],
  ): Promise<void> {
    const accessResults = await this.checkScopeAccesses(
      input,
      options,
      capability,
      authScopeIds,
    );
    const deniedIndex = accessResults.findIndex((allowed) => !allowed);
    if (deniedIndex !== -1) {
      const authScopeId = authScopeIds[deniedIndex] ?? null;
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

  private async checkScopeAccesses(
    input: { tenantId: string },
    options: AuthenticatedDocumentServiceOptions,
    capability: string,
    authScopeIds: (string | null)[],
  ): Promise<boolean[]> {
    const uniqueScopeIds = [...new Set(authScopeIds)];
    const allowed = await this.requireAuthorizer().checkAccessMany({
      context: actorContext(input, options),
      checks: uniqueScopeIds.map((targetScopeId) => ({
        capability,
        targetScopeId,
      })),
    });
    const allowedByScopeId = new Map(
      uniqueScopeIds.map((scopeId, index) => [
        scopeId,
        allowed[index] ?? false,
      ]),
    );

    return authScopeIds.map(
      (scopeId) => allowedByScopeId.get(scopeId) ?? false,
    );
  }

  private async buildAccessibleDocumentScopeFilter(
    input: { tenantId: string },
    options: AuthenticatedDocumentServiceOptions,
    capability: string,
  ): Promise<(string | null)[]> {
    return this.requireAuthorizer().listAccessibleDocumentScopeIds({
      context: actorContext(input, options),
      capability,
    });
  }

  private requireAuthorizer() {
    if (!this.authorizer) {
      throw new DocumentServiceError(
        "AUTHORIZER_REQUIRED",
        "Document authorizer is required for actor-scoped service operations",
      );
    }

    return this.authorizer;
  }

  private requireActorOptions(
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

function assertServiceDocument<TData extends JsonObject>(
  document: StoredDocument<TData> | undefined,
  message: string,
): StoredDocument<TData> {
  if (!document) {
    throw new Error(message);
  }

  return document;
}
