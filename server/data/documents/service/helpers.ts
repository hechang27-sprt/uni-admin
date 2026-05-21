import type { CollectionRegistry } from "../registry";
import type { DocumentRepository } from "../repository";
import { DocumentServiceError } from "../errors";
import type {
  RemoteAdapterOutputs,
  RemoteAdapterProjection,
  RemoteCollectionAdapter,
} from "../remote";
import type { VersionedDocumentInput } from "./contracts";
import type { JsonObject, StoredDocument, TenantContext } from "../types";

export interface DocumentServiceDependencies {
  registry: CollectionRegistry;
  repository: DocumentRepository;
}

export async function loadExisting(
  dependencies: DocumentServiceDependencies,
  input: VersionedDocumentInput,
  includeDeleted = false,
): Promise<StoredDocument> {
  const { registry, repository } = dependencies;
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

export async function assertVersionAndUpdate<TData extends JsonObject>(
  dependencies: DocumentServiceDependencies,
  input: VersionedDocumentInput,
  data?: TData,
  deletedAt?: Date | null,
  remoteIdentity?: { remoteSource: string; remoteId: string },
): Promise<StoredDocument<TData>> {
  const { registry, repository } = dependencies;
  const existing = await loadExisting(dependencies, input, true);

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

export async function upsertRemoteProjection<TData extends JsonObject>(
  dependencies: DocumentServiceDependencies,
  input: TenantContext & { collection: string },
  projection: RemoteAdapterProjection<TData>,
): Promise<StoredDocument<TData>> {
  const [document] = await upsertRemoteProjections(dependencies, input, [
    projection,
  ]);

  if (!document) {
    throw new Error("Remote projection upsert did not return a document");
  }

  return document;
}

export async function upsertRemoteProjections<TData extends JsonObject>(
  dependencies: DocumentServiceDependencies,
  input: TenantContext & { collection: string },
  projections: RemoteAdapterProjection<TData>[],
): Promise<StoredDocument<TData>[]> {
  const { registry, repository } = dependencies;
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

  const parsedProjections = projections.map((projection) => ({
    remoteId: projection.remoteId,
    data: parseData(
      collection.schema,
      projection.data,
      input.collection,
    ) as TData,
  }));

  return repository.upsertRemoteProjections<TData>({
    tenantId: input.tenantId,
    collection: input.collection,
    schemaVersion: collection.schemaVersion,
    remoteSource: adapter.remoteSource,
    projections: parsedProjections,
  });
}

export function getRemoteAdapter<
  TData extends JsonObject,
  TSyncOneInput = never,
  TSyncListInput = never,
  TCreateInput = never,
  TUpdateInput = never,
  TDeleteInput = never,
  TOutputs extends RemoteAdapterOutputs = RemoteAdapterOutputs,
>(
  registry: CollectionRegistry,
  collectionName: string,
): RemoteCollectionAdapter<
  TData,
  TSyncOneInput,
  TSyncListInput,
  TCreateInput,
  TUpdateInput,
  TDeleteInput,
  TOutputs
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
    TDeleteInput,
    TOutputs
  >;
}

export function withRemoteOutput<TResult extends object, TOutput>(
  result: TResult,
  output: TOutput | undefined,
): TResult & { output?: TOutput } {
  return output === undefined ? result : { ...result, output };
}

export function parseData<TData extends JsonObject>(
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
