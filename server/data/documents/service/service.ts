import { applyJsonPatch } from "../json-patch";
import { normalizeListInput, type DocumentRepository } from "../repository";
import { DocumentServiceError } from "../errors";
import {
  resolveCollectionOperationAuth,
  type CollectionRegistry,
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
import { getRemoteAdapter, parseData, withRemoteOutput } from "./helpers";
import type { AuthRbacService } from "#server/auth";
import { inject, injectable } from "inversify";
import type { RemoteAdapterProjection } from "../remote";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import type { CapabilityAccessCheck } from "~~/server/auth/types";

@injectable()
export class DocumentService {
  constructor(
    @inject(SERVER_DI_TYPES.CollectionRegistry)
    private readonly registry: CollectionRegistry,
    @inject(SERVER_DI_TYPES.DocumentRepository)
    private readonly repository: DocumentRepository,
    @inject(SERVER_DI_TYPES.AuthRbacService)
    private readonly authorizer: AuthRbacService,
  ) {}

  async create<TData extends JsonObject>(
    input: CreateDocumentInput<TData>,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument<TData>> {
    const collection = this.registry.get<TData>(input.collection);
    await this.authorizeCreate(input, [input.authScopeId ?? null], options);
    if (!hasActorOptions(options)) {
      await this.validateAuthScopes({
        tenantId: input.tenantId,
        authScopeIds: [input.authScopeId],
      });
    }
    const data = parseData<TData>(
      collection.schema,
      input.data,
      input.collection,
    );

    const [created] = await this.repository.insertMany<TData>({
      tenantId: input.tenantId,
      collection: input.collection,
      schemaVersion: collection.schemaVersion,
      items: [
        {
          data,
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
    const collection = this.registry.get<TData>(input.collection);
    const authScopeIds = input.items.map((item) => item.authScopeId);
    await this.authorizeCreate(
      input,
      authScopeIds.map((authScopeId) => authScopeId ?? null),
      options,
    );
    if (!hasActorOptions(options)) {
      await this.validateAuthScopes({
        tenantId: input.tenantId,
        authScopeIds,
      });
    }
    const items = input.items.map((item) => ({
      data: parseData<TData>(collection.schema, item.data, input.collection),
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
    const collection = this.registry.get<TData>(input.collection);
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
    const collection = this.registry.get<TData>(input.collection);
    const existing = await this.loadExisting<TData>(input);
    await this.authorizeDocuments(input, options, "update", [existing]);
    const data = parseData<TData>(
      collection.schema,
      input.data,
      input.collection,
    );

    return this.assertVersionAndUpdate(input, existing, data);
  }

  async updateMany<TData extends JsonObject>(
    input: UpdateManyDocumentInput<TData>,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument<TData>[]> {
    const collection = this.registry.get<TData>(input.collection);
    const items = input.items.map((item) => ({
      ...item,
      data: parseData<TData>(collection.schema, item.data, input.collection),
    }));
    const existingDocuments = await this.repository.findByIds<TData>({
      tenantId: input.tenantId,
      collection: input.collection,
      ids: items.map((item) => item.id),
    });

    const authorizedDocuments: StoredDocument<TData>[] = [];

    for (const [index, item] of items.entries()) {
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

      authorizedDocuments.push(existing);
    }
    await this.authorizeDocuments(
      input,
      options,
      "update",
      authorizedDocuments,
    );

    const records = items.map((item) => ({
      collection: input.collection,
      id: item.id,
      expectedVersion: item.expectedVersion,
      schemaVersion: collection.schemaVersion,
      data: item.data,
    }));
    const updated = await this.repository.updateMany<TData>({
      tenantId: input.tenantId,
      records,
    });

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
    const collection = this.registry.get<TData>(input.collection);
    const existing = await this.loadExisting<TData>(input);
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
    const data = parseData<TData>(collection.schema, patched, input.collection);

    return this.assertVersionAndUpdate<TData>(input, existing, data);
  }

  async softDelete(
    input: VersionedDocumentInput,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument> {
    const existing = await this.loadExisting(input);
    await this.authorizeDocuments(input, options, "delete", [existing]);
    return this.assertVersionAndUpdate(input, existing, undefined, new Date());
  }

  async restore(
    input: VersionedDocumentInput,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument> {
    const existing = await this.loadExisting(input, true);
    await this.authorizeDocuments(input, options, "restore", [existing]);
    return this.assertVersionAndUpdate(input, existing, undefined, null);
  }

  async hardDelete(
    input: HardDeleteDocumentInput,
    options?: DocumentServiceOptions,
  ): Promise<void> {
    this.registry.get(input.collection);

    if (!input.confirmHardDelete) {
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
      ? await this.upsertRemoteProjection<TData>(input, result.projection)
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
    const documents = await this.upsertRemoteProjections<TData>(
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
    if (!hasActorOptions(options)) {
      await this.validateAuthScopes({
        tenantId: input.tenantId,
        authScopeIds: [input.authScopeId],
      });
    }
    const result = await adapter.createRemote(input.input, {
      tenantId: input.tenantId,
      collection: input.collection,
      ...(hasActorOptions(options) ? { actor: options.actor } : {}),
    });
    const document = await this.upsertRemoteProjection<TData>(input, {
      ...result.projection,
      authScopeId: result.projection.authScopeId ?? input.authScopeId,
    });

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
    const collection = this.registry.get<TData>(input.collection);
    const current = await this.loadExisting<TData>(input);
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
    const data = parseData<TData>(
      collection.schema,
      result.projection.data,
      input.collection,
    );

    const document = await this.assertVersionAndUpdate<TData>(
      input,
      current,
      data,
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
    const current = await this.loadExisting(input);
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
      const projected = await this.upsertRemoteProjection(
        input,
        result.projection,
      );
      const document = await this.assertVersionAndUpdate(
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

    const document = await this.assertVersionAndUpdate(
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
    const existing = await this.loadExisting(input, true);
    await this.validateAuthScopes({
      tenantId: input.tenantId,
      authScopeIds: [input.authScopeId],
    });
    await this.assertScopeAccesses(
      input,
      authenticatedOptions,
      "admin:documents:set-scope",
      [existing.authScopeId, input.authScopeId],
    );

    return this.assertVersionAndUpdate(
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
    const uniqueScopeIds = new Set(authScopeIds);
    const checks = uniqueScopeIds
      .values()
      .map(
        (targetScopeId) =>
          ({
            capabilities: [capability],
            targetScopeIds: [targetScopeId],
          }) satisfies CapabilityAccessCheck,
      )
      .toArray();
    const access = await this.authorizer.evaluateAccess({
      ...actorContext(input, options),
      checks,
    });
    const allowed =
      access.capabilities?.map((capEval) => capEval.missingCaps.length === 0) ??
      checks.map(() => access.allowed);
    const allowedByScopeId = new Map(
      uniqueScopeIds
        .values()
        .map((scopeId, index): [string | null, boolean] => [
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
    return this.authorizer.listAccessibleDocumentScopeIds({
      context: actorContext(input, options),
      capability,
    });
  }

  private async validateAuthScopes(input: {
    tenantId: string;
    authScopeIds: (string | null | undefined)[];
  }): Promise<void> {
    const scopeIds = input.authScopeIds.filter(
      (authScopeId): authScopeId is string =>
        authScopeId !== null && authScopeId !== undefined,
    );
    if (scopeIds.length === 0) {
      return;
    }

    const access = await this.authorizer.evaluateAccess({
      tenantId: input.tenantId,
      tenantAccess: { scopeId: scopeIds },
    });
    const invalidScopeId =
      access.failure?.kind === "scope" ? access.failure.scopeId : null;
    if (invalidScopeId) {
      throw new DocumentServiceError(
        "INVALID_AUTH_SCOPE",
        "Document auth scope does not belong to the tenant",
        { tenantId: input.tenantId, authScopeId: invalidScopeId },
      );
    }
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

  private async loadExisting<TData extends JsonObject = JsonObject>(
    input: VersionedDocumentInput,
    includeDeleted = false,
  ): Promise<StoredDocument<TData>> {
    this.registry.get(input.collection);

    const [existing] = await this.repository.findByIds<TData>({
      tenantId: input.tenantId,
      collection: input.collection,
      ids: [input.id],
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

  private async upsertRemoteProjection<TData extends JsonObject>(
    input: { tenantId: string; collection: string },
    projection: RemoteAdapterProjection<TData>,
  ): Promise<StoredDocument<TData>> {
    const [document] = await this.upsertRemoteProjections(input, [projection]);

    if (!document) {
      throw new Error("Remote projection upsert did not return a document");
    }

    return document;
  }

  private async upsertRemoteProjections<TData extends JsonObject>(
    input: { tenantId: string; collection: string },
    projections: RemoteAdapterProjection<TData>[],
  ): Promise<StoredDocument<TData>[]> {
    const collection = this.registry.get<TData>(input.collection);
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

    const parsedProjections = projections.map((projection) => ({
      remoteId: projection.remoteId,
      authScopeId: projection.authScopeId,
      data: parseData<TData>(
        collection.schema,
        projection.data,
        input.collection,
      ),
    }));

    await this.validateAuthScopes({
      tenantId: input.tenantId,
      authScopeIds: parsedProjections.map(
        (projection) => projection.authScopeId,
      ),
    });

    return this.repository.upsertRemoteProjections<TData>({
      tenantId: input.tenantId,
      collection: input.collection,
      schemaVersion: collection.schemaVersion,
      remoteSource: adapter.remoteSource,
      projections: parsedProjections,
    });
  }

  private async assertVersionAndUpdate<TData extends JsonObject>(
    input: VersionedDocumentInput,
    existing: StoredDocument,
    data?: TData,
    deletedAt?: Date | null,
    remoteIdentity?: { remoteSource: string; remoteId: string },
    authScopeId?: string | null,
  ): Promise<StoredDocument<TData>> {
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

    if (authScopeId !== undefined) {
      await this.validateAuthScopes({
        tenantId: input.tenantId,
        authScopeIds: [authScopeId],
      });
    }

    const updatedRows = await this.repository.updateMany<TData>({
      tenantId: input.tenantId,
      records: [
        {
          collection: input.collection,
          id: input.id,
          expectedVersion: input.expectedVersion,
          data,
          schemaVersion: this.registry.get(input.collection).schemaVersion,
          ...(authScopeId === undefined ? {} : { authScopeId }),
          ...(deletedAt === undefined ? {} : { deletedAt }),
          ...(remoteIdentity
            ? {
                remoteSource: remoteIdentity.remoteSource,
                remoteId: remoteIdentity.remoteId,
              }
            : {}),
        },
      ],
    });
    const updated = updatedRows?.[0];

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
