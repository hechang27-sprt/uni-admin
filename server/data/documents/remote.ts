import type { z } from "zod";

import type {
  JsonObject,
  StoredDocument,
  TenantActorContext,
  TenantContext,
} from "./types";

type RemoteAdapterCallback<TInput, TContext, TResult> = {
  bivarianceHack(input: TInput, context: TContext): Promise<TResult>;
}["bivarianceHack"];

export interface RemoteAdapterContext extends TenantContext {
  collection: string;
  actor?: TenantActorContext["actor"];
}

export interface RemoteAdapterProjection<
  TData extends JsonObject = JsonObject,
> {
  remoteId: string;
  data: TData;
  authScopeId?: string | null;
}

export interface RemoteIdempotencyOptions<TInput = unknown> {
  stableKey?: (input: TInput, context: RemoteAdapterContext) => string | null;
}

export interface RemoteAdapterOutputs {
  syncOne?: unknown;
  syncList?: unknown;
  create?: unknown;
  update?: unknown;
  delete?: unknown;
}

export interface RemoteSyncOneResult<
  TData extends JsonObject = JsonObject,
  TOutput = unknown,
> {
  projection: RemoteAdapterProjection<TData> | null;
  output?: TOutput;
}

export interface RemoteSyncListResult<
  TData extends JsonObject = JsonObject,
  TOutput = unknown,
> {
  projections: RemoteAdapterProjection<TData>[];
  output?: TOutput;
}

export interface RemoteProjectionResult<
  TData extends JsonObject = JsonObject,
  TOutput = unknown,
> {
  projection: RemoteAdapterProjection<TData>;
  output?: TOutput;
}

export interface RemoteDeleteResult<
  TData extends JsonObject = JsonObject,
  TOutput = unknown,
> {
  projection?: RemoteAdapterProjection<TData>;
  output?: TOutput;
}

export interface RemoteCollectionAdapter<
  TData extends JsonObject = JsonObject,
  TSyncOneInput = never,
  TSyncListInput = never,
  TCreateInput = never,
  TUpdateInput = never,
  TDeleteInput = never,
  TOutputs extends RemoteAdapterOutputs = RemoteAdapterOutputs,
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
    RemoteSyncOneResult<TData, TOutputs["syncOne"]>
  >;
  syncList: RemoteAdapterCallback<
    TSyncListInput,
    RemoteAdapterContext,
    RemoteSyncListResult<TData, TOutputs["syncList"]>
  >;
  createRemote: RemoteAdapterCallback<
    TCreateInput,
    RemoteAdapterContext,
    RemoteProjectionResult<TData, TOutputs["create"]>
  >;
  updateRemote: RemoteAdapterCallback<
    TUpdateInput,
    RemoteAdapterContext & {
      current: StoredDocument<TData>;
    },
    RemoteProjectionResult<TData, TOutputs["update"]>
  >;
  deleteRemote: RemoteAdapterCallback<
    TDeleteInput,
    RemoteAdapterContext & {
      current: StoredDocument<TData>;
    },
    RemoteDeleteResult<TData, TOutputs["delete"]> | undefined
  >;
}

export interface CreateRemoteProjectionMapperOptions<
  TRemote,
  TData extends JsonObject,
> {
  schema: z.ZodType<TRemote>;
  getRemoteId: (remote: TRemote) => string;
  mapData: (remote: TRemote) => TData;
  getAuthScopeId?: (remote: TRemote) => string | null | undefined;
}

export function createRemoteProjectionMapper<TRemote, TData extends JsonObject>(
  options: CreateRemoteProjectionMapperOptions<TRemote, TData>,
): (payload: unknown) => RemoteAdapterProjection<TData> {
  return (payload) => {
    const remote = options.schema.parse(payload);

    return {
      remoteId: options.getRemoteId(remote),
      data: options.mapData(remote),
      authScopeId: options.getAuthScopeId?.(remote),
    };
  };
}
