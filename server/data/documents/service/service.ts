import { applyJsonPatch } from "../json-patch";
import { normalizeListInput, type DocumentRepository } from "../repository";
import { DocumentServiceError } from "../errors";
import {
  CollectionRegistry,
  type CollectionOperation,
  type CollectionSchema,
  type RegisteredCollection,
} from "../../collections";
import type {
  ListDocumentsResult,
  StoredDocument,
  TenantActorContext,
} from "../types";
import type {
  CreateDocumentInput,
  CreateManyDocumentInput,
  DocumentServiceOptions,
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
import type { CatalogService, CatalogCollection } from "#server/data/catalog";
import {
  buildPermissionKey,
  isAuthRbacError,
  type AuthRbacService,
  type CheckAccessManyInput,
} from "#server/auth/um";
import { inject, injectable } from "inversify";
import type { RemoteAdapterProjection } from "../remote";
import { SERVER_DI_TYPES } from "#server/di/tokens";
import { isNotNil, uniq } from "es-toolkit";

@injectable()
export class DocumentService {
  constructor(
    @inject(SERVER_DI_TYPES.CollectionRegistry)
    private readonly registry: CollectionRegistry,
    @inject(SERVER_DI_TYPES.DocumentRepository)
    private readonly repository: DocumentRepository,
    @inject(SERVER_DI_TYPES.AuthRbacService)
    private readonly authorizer: AuthRbacService,
    @inject(SERVER_DI_TYPES.CatalogService)
    private readonly catalog: CatalogService,
  ) {}

  async create<TData extends JsonObject>(
    input: CreateDocumentInput<TData>,
    options?: DocumentServiceOptions,
  ): Promise<StoredDocument<TData>> {
    const collection = this.getCollection<TData>(input);
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
    const identity = await this.requireCollectionIdentity(input, collection);

    const [created] = await this.repository.insertMany<TData>({
      tenantId: input.tenantId,
      appId: identity.appId,
      collectionId: identity.collectionId,
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
    const collection = this.getCollection<TData>(input);
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
    const identity = await this.requireCollectionIdentity(input, collection);
    const items = input.items.map((item) => ({
      data: parseData<TData>(collection.schema, item.data, input.collection),
      authScopeId: item.authScopeId,
      remoteSource: item.remoteSource,
      remoteId: item.remoteId,
    }));

    return this.repository.insertMany<TData>({
      tenantId: input.tenantId,
      appId: identity.appId,
      collectionId: identity.collectionId,
      schemaVersion: collection.schemaVersion,
      items,
    });
  }

  async list<TData extends JsonObject>(
    input: ListDocumentServiceInput,
    options?: DocumentServiceOptions,
  ): Promise<ListDocumentsResult<TData>> {
    const collection = this.getCollection<TData>(input);
    const identity = await this.requireCollectionIdentity(input, collection);
    const query = normalizeListInput(input);
    let accessibleScopeIds: string[] | null | undefined;

    if (hasActorOptions(options)) {
      const auth = CollectionRegistry.resolveOperationAuth(
        collection,
        input.operation ?? "read",
      );
      if (auth) {
        const capability = buildPermissionKey(
          identity.appId,
          identity.collectionId,
          auth.capability,
        );

        if (auth.resourceScope === "document") {
          accessibleScopeIds = await this.buildAccessibleDocumentScopeFilter(
            input,
            options,
            capability,
          );
        } else {
          await this.assertDocumentAccess({
            ...actorContext(input, options),
            checks: [
              {
                capabilities: [capability],
                targetScopeIds: await this.translateResourceScopeTargets(
                  input.tenantId,
                  auth.resourceScope,
                ),
              },
            ],
          });
        }
      }
    }

    const items = await this.repository.list<TData>({
      tenantId: input.tenantId,
      appId: identity.appId,
      collectionId: identity.collectionId,
      query: {
        ...query,
        limit: query.limit + 1,
        accessibleScopeIds,
      },
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
    const collection = this.getCollection<TData>(input);
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
    const collection = this.getCollection<TData>(input);
    const identity = await this.requireCollectionIdentity(input, collection);
    const items = input.items.map((item) => ({
      ...item,
      data: parseData<TData>(collection.schema, item.data, input.collection),
    }));
    const existingDocuments = await this.repository.list<TData>({
      tenantId: input.tenantId,
      appId: identity.appId,
      collectionId: identity.collectionId,
      query: { ids: items.map((item) => item.id) },
    });
    const existingDocumentsById = new Map(
      existingDocuments.map((document) => [document.id, document] as const),
    );

    const authorizedDocuments: StoredDocument<TData>[] = [];

    for (const item of items) {
      const existing = existingDocumentsById.get(item.id);

      if (!existing) {
        throw new DocumentServiceError("NOT_FOUND", "Document not found", {
          collection: input.collection,
          documentId: item.id,
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
      appId: identity.appId,
      collectionId: identity.collectionId,
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
    const collection = this.getCollection<TData>(input);
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
    const collection = this.getCollection(input);
    const identity = await this.requireCollectionIdentity(input, collection);

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

    const [existing] = await this.repository.list({
      tenantId: input.tenantId,
      appId: identity.appId,
      collectionId: identity.collectionId,
      query: { ids: [input.id], includeDeleted: true },
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
      appId: identity.appId,
      collectionId: identity.collectionId,
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
    >(this.registry, input);
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
    >(this.registry, input);
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
    >(this.registry, input);
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
    >(this.registry, input);
    const collection = this.getCollection<TData>(input);
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
    >(this.registry, input);
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
    await this.assertDocumentAccess({
      ...actorContext(input, authenticatedOptions),
      checks: [
        {
          capabilities: ["admin:documents:set-scope"],
          targetScopeIds: await this.translateResourceScopeTargets(
            input.tenantId,
            "document",
            uniq([existing.authScopeId, input.authScopeId]),
          ),
        },
      ],
    });

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
    const collection = this.getCollection(input);
    const auth = CollectionRegistry.resolveOperationAuth(collection, "create");
    if (!auth) {
      return [];
    }
    const identity = await this.requireCollectionIdentity(input, collection);
    const capability = buildPermissionKey(
      identity.appId,
      identity.collectionId,
      auth.capability,
    );
    if (auth.resourceScope === "document") {
      return this.authorizer.listCreatableDocumentScopeIds({
        context: actorContext(input, authenticatedOptions),
        capability,
      });
    }

    await this.assertDocumentAccess({
      ...actorContext(input, authenticatedOptions),
      checks: [
        {
          capabilities: [capability],
          targetScopeIds: await this.translateResourceScopeTargets(
            input.tenantId,
            auth.resourceScope,
          ),
        },
      ],
    });

    return auth.resourceScope === "tenant-root" ? [null] : [];
  }

  private async authorizeCreate(
    input: CreateDocumentInput | RemoteCreateInput | CreateManyDocumentInput,
    authScopeIds: (string | null)[],
    options?: DocumentServiceOptions,
  ): Promise<void> {
    if (!hasActorOptions(options)) {
      return;
    }
    const collection = this.getCollection(input);
    const auth = CollectionRegistry.resolveOperationAuth(collection, "create");
    if (!auth) {
      return;
    }
    const identity = await this.requireCollectionIdentity(input, collection);

    await this.assertDocumentAccess({
      ...actorContext(input, options),
      checks: [
        {
          capabilities: [
            buildPermissionKey(
              identity.appId,
              identity.collectionId,
              auth.capability,
            ),
          ],
          targetScopeIds: await this.translateResourceScopeTargets(
            input.tenantId,
            auth.resourceScope,
            auth.resourceScope === "document" ? authScopeIds : [],
          ),
        },
      ],
    });
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
    const collection = this.getCollection(input);
    const auth = CollectionRegistry.resolveOperationAuth(collection, operation);
    if (!auth) {
      return;
    }
    const identity = await this.requireCollectionIdentity(input, collection);

    await this.assertDocumentAccess({
      ...actorContext(input, options),
      checks: [
        {
          capabilities: [
            buildPermissionKey(
              identity.appId,
              identity.collectionId,
              auth.capability,
            ),
          ],
          targetScopeIds: await this.translateResourceScopeTargets(
            input.tenantId,
            auth.resourceScope,
            auth.resourceScope === "document"
              ? documents.map((document) => document.authScopeId)
              : [],
          ),
        },
      ],
    });
  }

  private async assertDocumentAccess(
    input: CheckAccessManyInput,
  ): Promise<void> {
    try {
      await this.authorizer.evaluateAccess({
        ...input,
        throw: true,
      });
    } catch (error) {
      if (isAuthRbacError(error) && error.code === "AUTH_PERMISSION_DENIED") {
        throw new DocumentServiceError("AUTHORIZATION_DENIED", error.message, {
          ...error.details,
        });
      }

      throw error;
    }
  }

  private async translateResourceScopeTargets(
    tenantId: string,
    resourceScope: "document" | "tenant-root" | "none",
    authScopeIds: (string | null)[] = [],
  ): Promise<(string | null)[]> {
    if (resourceScope === "none") {
      return [null];
    }

    if (resourceScope === "tenant-root") {
      return [await this.authorizer.getTenantRootScopeId(tenantId)];
    }

    const rootScopeId = await this.authorizer.getTenantRootScopeId(tenantId);
    return uniq(
      authScopeIds.map((authScopeId) => authScopeId ?? rootScopeId),
    );
  }

  private async buildAccessibleDocumentScopeFilter(
    input: { tenantId: string },
    options: AuthenticatedDocumentServiceOptions,
    capability: string,
  ): Promise<string[] | null> {
    const scopeIds = await this.authorizer.listGrantedScopeIdsForCapability({
      context: actorContext(input, options),
      capability,
    });

    if (!scopeIds.every(isNotNil)) return null;
    return scopeIds;
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
    const collection = this.getCollection(input);
    const identity = await this.requireCollectionIdentity(input, collection);
    const [existing] = await this.repository.list<TData>({
      tenantId: input.tenantId,
      appId: identity.appId,
      collectionId: identity.collectionId,
      query: { ids: [input.id], includeDeleted },
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
    input: { tenantId: string; appKey?: string; collection: string },
    projection: RemoteAdapterProjection<TData>,
  ): Promise<StoredDocument<TData>> {
    const [document] = await this.upsertRemoteProjections(input, [projection]);

    if (!document) {
      throw new Error("Remote projection upsert did not return a document");
    }

    return document;
  }

  private async upsertRemoteProjections<TData extends JsonObject>(
    input: { tenantId: string; appKey?: string; collection: string },
    projections: RemoteAdapterProjection<TData>[],
  ): Promise<StoredDocument<TData>[]> {
    const collection = this.getCollection<TData>(input);
    const identity = await this.requireCollectionIdentity(input, collection);
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
      appId: identity.appId,
      collectionId: identity.collectionId,
      tenantId: input.tenantId,
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

    const identity = await this.requireCollectionIdentity(input);
    const updatedRows = await this.repository.updateMany<TData>({
      tenantId: input.tenantId,
      records: [
        {
          appId: identity.appId,
          collectionId: identity.collectionId,
          id: input.id,
          expectedVersion: input.expectedVersion,
          data,
          schemaVersion: this.getCollection(input).schemaVersion,
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

  private getCollection<TData extends JsonObject = JsonObject>(input: {
    appKey?: string;
    collection: string;
  }): RegisteredCollection<CollectionSchema<TData>> {
    return input.appKey
      ? this.registry.getForApp<CollectionSchema<TData>>(
          input.appKey,
          input.collection,
        )
      : this.registry.get<CollectionSchema<TData>>(input.collection);
  }

  private async requireCollectionIdentity(
    input: { tenantId: string; appKey?: string; collection: string },
    collection = this.getCollection(input),
  ): Promise<CatalogCollection> {
    const identity = await this.catalog.findTenantCollectionIdentity({
      tenantId: input.tenantId,
      appKey: collection.appKey,
      collectionKey: collection.key,
    });

    if (!identity) {
      throw new DocumentServiceError(
        "UNKNOWN_COLLECTION",
        "Collection is not enabled for tenant",
        { collection: input.collection },
      );
    }

    return identity;
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
