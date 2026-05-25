import type { z } from "zod";

import { DocumentServiceError } from "./errors";
import type { RemoteCollectionAdapter } from "./remote";
import type { JsonObject } from "./types";

export type CollectionOperation =
  | "read"
  | "create"
  | "update"
  | "patch"
  | "delete"
  | "restore"
  | "hard-delete";

export type CollectionResourceScopeMode = "document" | "none";

export interface CollectionOperationAuthDeclaration {
  capability?: string;
  resourceScope?: CollectionResourceScopeMode;
}

export type CollectionOperationAuthInput =
  | string
  | false
  | CollectionOperationAuthDeclaration;

export type CollectionActionAuthDeclaration =
  CollectionOperationAuthDeclaration;

export interface CollectionAuthDeclaration {
  resourceScope?: CollectionResourceScopeMode;
  read?: CollectionOperationAuthInput;
  create?: CollectionOperationAuthInput;
  update?: CollectionOperationAuthInput;
  patch?: CollectionOperationAuthInput;
  delete?: CollectionOperationAuthInput;
  restore?: CollectionOperationAuthInput;
  hardDelete?: CollectionOperationAuthInput;
  actions?: Record<string, CollectionActionAuthDeclaration | false>;
}

export interface ResolvedCollectionOperationAuth {
  capability: string;
  resourceScope: CollectionResourceScopeMode;
}

export interface PermissionDefinition {
  key: string;
  source: "collection" | "action" | "admin";
  description?: string;
}

export interface CollectionRegistration<TData extends JsonObject = JsonObject> {
  name: string;
  schema: z.ZodType<TData>;
  schemaVersion: number;
  auth?: CollectionAuthDeclaration;
  remoteAdapter?: RemoteCollectionAdapter<TData>;
}

export class CollectionRegistry {
  private readonly collections = new Map<string, CollectionRegistration>();

  register<TData extends JsonObject>(
    registration: CollectionRegistration<TData>,
  ): this {
    if (!registration.name.trim()) {
      throw new DocumentServiceError(
        "VALIDATION_FAILED",
        "Collection name is required",
      );
    }

    if (
      !Number.isInteger(registration.schemaVersion) ||
      registration.schemaVersion < 1
    ) {
      throw new DocumentServiceError(
        "VALIDATION_FAILED",
        "Collection schema version must be a positive integer",
        {
          collection: registration.name,
        },
      );
    }

    if (
      registration.remoteAdapter &&
      !registration.remoteAdapter.remoteSource.trim()
    ) {
      throw new DocumentServiceError(
        "VALIDATION_FAILED",
        "Remote source is required for remote-backed collections",
        {
          collection: registration.name,
        },
      );
    }

    this.collections.set(registration.name, registration);
    return this;
  }

  get<TData extends JsonObject = JsonObject>(
    name: string,
  ): CollectionRegistration<TData> {
    const collection = this.collections.get(name);

    if (!collection) {
      throw new DocumentServiceError(
        "UNKNOWN_COLLECTION",
        `Unknown collection: ${name}`,
        {
          collection: name,
        },
      );
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Registered collection names establish their schema data type at runtime.
    return collection as CollectionRegistration<TData>;
  }

  has(name: string): boolean {
    return this.collections.has(name);
  }

  list(): CollectionRegistration[] {
    return this.collections.values().toArray();
  }
}

export function createCollectionRegistry(
  registrations: CollectionRegistration[] = [],
): CollectionRegistry {
  const registry = new CollectionRegistry();

  for (const registration of registrations) {
    registry.register(registration);
  }

  return registry;
}

export function resolveCollectionOperationAuth(
  collection: CollectionRegistration,
  operation: CollectionOperation,
): ResolvedCollectionOperationAuth | null {
  const declaration = getOperationDeclaration(collection.auth, operation);

  if (declaration === false) {
    return null;
  }

  const baseResourceScope = collection.auth?.resourceScope ?? "document";

  if (typeof declaration === "string") {
    return {
      capability: declaration,
      resourceScope: baseResourceScope,
    };
  }

  return {
    capability:
      declaration?.capability ?? `collection:${collection.name}:${operation}`,
    resourceScope: declaration?.resourceScope ?? baseResourceScope,
  };
}

export function resolveCollectionActionAuth(
  collection: CollectionRegistration,
  action: string,
): ResolvedCollectionOperationAuth | null {
  const declaration = collection.auth?.actions?.[action];

  if (declaration === false) {
    return null;
  }

  return {
    capability:
      declaration?.capability ?? `action:${collection.name}:${action}`,
    resourceScope:
      declaration?.resourceScope ??
      collection.auth?.resourceScope ??
      "document",
  };
}

export function deriveCollectionPermissionDefinitions(
  registry: CollectionRegistry,
): PermissionDefinition[] {
  const permissions = new Map<string, PermissionDefinition>();

  for (const collection of registry.list()) {
    for (const operation of collectionOperations) {
      const auth = resolveCollectionOperationAuth(collection, operation);
      if (auth) {
        permissions.set(auth.capability, {
          key: auth.capability,
          source: "collection",
        });
      }
    }

    for (const action of Object.keys(collection.auth?.actions ?? {})) {
      const auth = resolveCollectionActionAuth(collection, action);
      if (auth) {
        permissions.set(auth.capability, {
          key: auth.capability,
          source: "action",
        });
      }
    }
  }

  return permissions.values().toArray();
}

const collectionOperations: CollectionOperation[] = [
  "read",
  "create",
  "update",
  "patch",
  "delete",
  "restore",
  "hard-delete",
];

function getOperationDeclaration(
  auth: CollectionAuthDeclaration | undefined,
  operation: CollectionOperation,
): CollectionOperationAuthInput | undefined {
  if (operation === "hard-delete") {
    return auth?.hardDelete;
  }

  return auth?.[operation];
}
