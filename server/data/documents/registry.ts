import { z } from "zod";
import { injectable } from "inversify";

import { DocumentServiceError } from "./errors";
import type { RemoteCollectionAdapter } from "./remote";
import type { JsonObject } from "./types";

const safePermissionSegmentSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*$/,
    "Must start with a lowercase letter and contain only lowercase letters, digits, or hyphens",
  );

export const collectionOperationValues = [
  "read",
  "create",
  "update",
  "patch",
  "delete",
  "restore",
  "hard-delete",
] as const;

const permissionSourceValues = [
  "collection",
  "action",
  "admin",
  "global",
] as const;
export const DEFAULT_APP_KEY = "default";

const collectionOperationSchema = z.enum(collectionOperationValues);

const collectionResourceScopeModeSchema = z.enum(["document", "tenant-root"]);

const collectionOperationAuthDeclarationSchema = z.object({
  capability: z.string().optional(),
  resourceScope: collectionResourceScopeModeSchema.optional(),
});

const collectionOperationAuthInputSchema = z.union([
  z.string(),
  z.literal(false),
  collectionOperationAuthDeclarationSchema,
]);

const collectionAuthDeclarationSchema = z.object({
  resourceScope: collectionResourceScopeModeSchema.optional(),
  read: collectionOperationAuthInputSchema.optional(),
  create: collectionOperationAuthInputSchema.optional(),
  update: collectionOperationAuthInputSchema.optional(),
  patch: collectionOperationAuthInputSchema.optional(),
  delete: collectionOperationAuthInputSchema.optional(),
  restore: collectionOperationAuthInputSchema.optional(),
  hardDelete: collectionOperationAuthInputSchema.optional(),
  actions: z
    .record(
      safePermissionSegmentSchema,
      z.union([collectionOperationAuthDeclarationSchema, z.literal(false)]),
    )
    .optional(),
});

const _resolvedCollectionOperationAuthSchema = z.object({
  capability: z.string(),
  resourceScope: collectionResourceScopeModeSchema,
});

const permissionDefinitionSchema = z.object({
  key: z.string().optional(),
  appKey: safePermissionSegmentSchema.nullable().optional(),
  collectionKey: safePermissionSegmentSchema.nullable().optional(),
  capabilityId: safePermissionSegmentSchema.optional(),
  source: z.enum(permissionSourceValues),
  description: z.string().optional(),
});

const collectionRegistrationSchema = z.object({
  appKey: safePermissionSegmentSchema.optional(),
  key: safePermissionSegmentSchema.optional(),
  name: z.string().min(1).optional(),
  definitionKey: safePermissionSegmentSchema.optional(),
  schema: z.custom<z.ZodType<JsonObject>>(
    (value) => value instanceof z.ZodType,
  ),
  schemaVersion: z.number().int().positive(),
  auth: collectionAuthDeclarationSchema.optional(),
  remoteAdapter: z.custom<RemoteCollectionAdapter>().optional(),
});

export type CollectionOperation = z.infer<typeof collectionOperationSchema>;

export type CollectionResourceScopeMode = z.infer<
  typeof collectionResourceScopeModeSchema
>;

export type CollectionOperationAuthDeclaration = z.infer<
  typeof collectionOperationAuthDeclarationSchema
>;

export type CollectionOperationAuthInput = z.infer<
  typeof collectionOperationAuthInputSchema
>;

export type CollectionActionAuthDeclaration =
  CollectionOperationAuthDeclaration;

export type CollectionAuthDeclaration = z.infer<
  typeof collectionAuthDeclarationSchema
>;

export type ResolvedCollectionOperationAuth = z.infer<
  typeof _resolvedCollectionOperationAuthSchema
>;

export type PermissionDefinition = z.infer<typeof permissionDefinitionSchema>;

type CollectionRegistrationBase = z.infer<typeof collectionRegistrationSchema>;

export type CollectionRegistration<TData extends JsonObject = JsonObject> =
  Omit<CollectionRegistrationBase, "schema" | "remoteAdapter"> & {
    appKey?: string;
    definitionKey?: string;
    schema: z.ZodType<TData>;
    remoteAdapter?: RemoteCollectionAdapter<TData>;
  };

export type RegisteredCollection<TData extends JsonObject = JsonObject> = Omit<
  CollectionRegistration<TData>,
  "appKey" | "definitionKey"
> & {
  appKey: string;
  key: string;
  name: string;
  definitionKey: string;
};

@injectable()
export class CollectionRegistry {
  private readonly collections = new Map<string, RegisteredCollection>();

  register<TData extends JsonObject>(
    registration: CollectionRegistration<TData>,
  ): this {
    validateRegistration(registration);

    const collection = normalizeRegistration(registration);
    const registryKey = collectionRegistryKey(collection.appKey, collection.key);

    if (this.collections.has(registryKey)) {
      throw new DocumentServiceError(
        "VALIDATION_FAILED",
        `Duplicate collection key in app ${collection.appKey}: ${collection.key}`,
        {
          appKey: collection.appKey,
          collection: collection.key,
        },
      );
    }

    if (
      collection.remoteAdapter &&
      !collection.remoteAdapter.remoteSource.trim()
    ) {
      throw new DocumentServiceError(
        "VALIDATION_FAILED",
        "Remote source is required for remote-backed collections",
        {
          appKey: collection.appKey,
          collection: collection.key,
        },
      );
    }

    this.collections.set(registryKey, collection);
    return this;
  }

  get<TData extends JsonObject = JsonObject>(
    key: string,
  ): RegisteredCollection<TData> {
    const collection = this.collections.get(
      collectionRegistryKey(DEFAULT_APP_KEY, key),
    );

    if (!collection) {
      throw new DocumentServiceError(
        "UNKNOWN_COLLECTION",
        `Unknown collection: ${key}`,
        {
          collection: key,
        },
      );
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Registered collection names establish their schema data type at runtime.
    return collection as RegisteredCollection<TData>;
  }

  has(key: string): boolean {
    return this.collections.has(collectionRegistryKey(DEFAULT_APP_KEY, key));
  }

  getForApp<TData extends JsonObject = JsonObject>(
    appKey: string,
    key: string,
  ): RegisteredCollection<TData> {
    const collection = this.collections.get(
      collectionRegistryKey(appKey, key),
    );

    if (!collection) {
      throw new DocumentServiceError(
        "UNKNOWN_COLLECTION",
        `Unknown collection: ${appKey}/${key}`,
        {
          appKey,
          collection: key,
        },
      );
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Registered app/collection keys establish their schema data type at runtime.
    return collection as RegisteredCollection<TData>;
  }

  hasForApp(appKey: string, key: string): boolean {
    return this.collections.has(collectionRegistryKey(appKey, key));
  }

  list(): RegisteredCollection[] {
    return this.collections.values().toArray();
  }

  listForApp(appKey: string): RegisteredCollection[] {
    return this.collections
      .values()
      .filter((collection) => collection.appKey === appKey)
      .toArray();
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

  if (typeof declaration === "string" || declaration?.capability) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `Built-in collection capability cannot be overridden: ${collection.key}/${operation}`,
      {
        collection: collection.key,
        operation,
      },
    );
  }

  return {
    capability: operation,
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
    capability: `action-${action}`,
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
        addPermissionDefinition(permissions, {
          appKey: collection.appKey,
          collectionKey: collection.key,
          capabilityId: auth.capability,
          source: "collection",
        });
      }
    }

    for (const action of Object.keys(collection.auth?.actions ?? {})) {
      const auth = resolveCollectionActionAuth(collection, action);
      if (auth) {
        addPermissionDefinition(permissions, {
          appKey: collection.appKey,
          collectionKey: collection.key,
          capabilityId: auth.capability,
          source: "action",
        });
      }
    }
  }

  return permissions.values().toArray();
}

function addPermissionDefinition(
  permissions: Map<string, PermissionDefinition>,
  definition: PermissionDefinition,
): void {
  permissionDefinitionSchema.parse(definition);

  const derivedKey = permissionDefinitionIdentity(definition);
  const existing = permissions.get(derivedKey);

  if (existing) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `Duplicate derived permission key: ${derivedKey}`,
      {
        capability: definition.capabilityId ?? definition.key,
        operation: `${existing.source}->${definition.source}`,
      },
    );
  }

  permissions.set(derivedKey, definition);
}

function permissionDefinitionIdentity(
  definition: PermissionDefinition,
): string {
  return [
    definition.appKey ?? "",
    definition.collectionKey ?? "",
    definition.capabilityId ?? definition.key ?? "",
  ].join(":");
}

function normalizeRegistration<TData extends JsonObject>(
  registration: CollectionRegistration<TData>,
): RegisteredCollection<TData> {
  const key = registration.key ?? registration.name;

  if (!key) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      "Collection registration requires a key or name",
      { collection: registration.name },
    );
  }

  return {
    ...registration,
    appKey: registration.appKey ?? DEFAULT_APP_KEY,
    key,
    name: registration.name ?? key,
    definitionKey: registration.definitionKey ?? key,
  };
}

function collectionRegistryKey(appKey: string, key: string): string {
  return `${appKey}:${key}`;
}
function validateRegistration(registration: CollectionRegistration): void {
  const result = collectionRegistrationSchema.safeParse(registration);

  if (result.success) {
    return;
  }

  const invalidPath = result.error.issues[0]?.path.join(".");
  const message = invalidPath
    ? `Collection registration is invalid at ${invalidPath}`
    : "Collection registration is invalid";

  throw new DocumentServiceError("VALIDATION_FAILED", message, {
    collection: registration.key ?? registration.name,
    issues: result.error.issues,
  });
}

const collectionOperations: CollectionOperation[] =
  collectionOperationSchema.options;

function getOperationDeclaration(
  auth: CollectionAuthDeclaration | undefined,
  operation: CollectionOperation,
): CollectionOperationAuthInput | undefined {
  if (operation === "hard-delete") {
    return auth?.hardDelete;
  }

  return auth?.[operation];
}
