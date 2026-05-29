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
  validateAuthScopes?: (input: {
    tenantId: string;
    authScopeIds: (string | null | undefined)[];
  }) => Promise<void>;
}

export async function loadExisting<TData extends JsonObject = JsonObject>(
  dependencies: DocumentServiceDependencies,
  input: VersionedDocumentInput,
  includeDeleted = false,
): Promise<StoredDocument<TData>> {
  const { registry, repository } = dependencies;
  registry.get(input.collection);

  const [existing] = await repository.findByIds<TData>({
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
  const collection = registry.get<TData>(input.collection);
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

  await dependencies.validateAuthScopes?.({
    tenantId: input.tenantId,
    authScopeIds: parsedProjections.map((projection) => projection.authScopeId),
  });

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
  const collection = registry.get<TData>(collectionName);
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

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- String registry lookup cannot retain adapter operation generics.
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

export function parseData<TData extends JsonObject = JsonObject>(
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
