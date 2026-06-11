import type { CollectionRegistry, CollectionSchema } from "../../collections";
import { DocumentServiceError } from "../errors";
import type { RemoteAdapterOutputs, RemoteCollectionAdapter } from "../remote";

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
  const collection = registry.get<CollectionSchema<TData>>(collectionName);
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
  return adapter as unknown as RemoteCollectionAdapter<
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
