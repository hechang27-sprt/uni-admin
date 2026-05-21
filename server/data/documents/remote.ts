import type { z } from "zod";

import type { JsonObject, StoredDocument, TenantContext } from "./types";

type RemoteAdapterCallback<TInput, TContext, TResult> = {
  bivarianceHack(input: TInput, context: TContext): Promise<TResult>;
}["bivarianceHack"];

export interface RemoteAdapterContext extends TenantContext {
  collection: string;
}

export interface RemoteAdapterProjection<
  TData extends JsonObject = JsonObject,
> {
  remoteId: string;
  data: TData;
}

export interface RemoteIdempotencyOptions<TInput = unknown> {
  stableKey?: (input: TInput, context: RemoteAdapterContext) => string | null;
}

export interface RemoteDeleteResult<TData extends JsonObject = JsonObject> {
  projection?: RemoteAdapterProjection<TData>;
}

export interface RemoteCollectionAdapter<
  TData extends JsonObject = JsonObject,
  TSyncOneInput = never,
  TSyncListInput = never,
  TCreateInput = never,
  TUpdateInput = never,
  TDeleteInput = never,
> {
  remoteSource: string;
  idempotency?: {
    create?: RemoteIdempotencyOptions<TCreateInput>;
    update?: RemoteIdempotencyOptions<TUpdateInput>;
    delete?: RemoteIdempotencyOptions<TDeleteInput>;
  };
  syncOne: RemoteAdapterCallback<
    TSyncOneInput,
    RemoteAdapterContext,
    RemoteAdapterProjection<TData> | null
  >;
  syncList: RemoteAdapterCallback<
    TSyncListInput,
    RemoteAdapterContext,
    RemoteAdapterProjection<TData>[]
  >;
  createRemote: RemoteAdapterCallback<
    TCreateInput,
    RemoteAdapterContext,
    RemoteAdapterProjection<TData>
  >;
  updateRemote: RemoteAdapterCallback<
    TUpdateInput,
    RemoteAdapterContext & {
      current: StoredDocument<TData>;
    },
    RemoteAdapterProjection<TData>
  >;
  deleteRemote: RemoteAdapterCallback<
    TDeleteInput,
    RemoteAdapterContext & {
      current: StoredDocument<TData>;
    },
    RemoteDeleteResult<TData> | void
  >;
}

export interface CreateRemoteProjectionMapperOptions<
  TRemote,
  TData extends JsonObject,
> {
  schema: z.ZodType<TRemote>;
  getRemoteId: (remote: TRemote) => string;
  mapData: (remote: TRemote) => TData;
}

export function createRemoteProjectionMapper<TRemote, TData extends JsonObject>(
  options: CreateRemoteProjectionMapperOptions<TRemote, TData>,
): (payload: unknown) => RemoteAdapterProjection<TData> {
  return (payload) => {
    const remote = options.schema.parse(payload);

    return {
      remoteId: options.getRemoteId(remote),
      data: options.mapData(remote),
    };
  };
}
