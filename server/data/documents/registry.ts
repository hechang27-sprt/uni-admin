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

const collectionOperationValues = [
  "read",
  "create",
  "update",
  "patch",
  "delete",
  "restore",
  "hard-delete",
] as const;

const permissionSourceValues = ["collection", "action", "admin"] as const;

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
  key: z.string(),
  source: z.enum(permissionSourceValues),
  description: z.string().optional(),
});

const collectionRegistrationSchema = z.object({
  name: safePermissionSegmentSchema,
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
    schema: z.ZodType<TData>;
    remoteAdapter?: RemoteCollectionAdapter<TData>;
  };

@injectable()
export class CollectionRegistry {
  private readonly collections = new Map<string, CollectionRegistration>();

  register<TData extends JsonObject>(
    registration: CollectionRegistration<TData>,
  ): this {
    validateRegistration(registration);

    if (this.collections.has(registration.name)) {
      throw new DocumentServiceError(
        "VALIDATION_FAILED",
        `Duplicate collection name: ${registration.name}`,
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
        addPermissionDefinition(permissions, {
          key: auth.capability,
          source: "collection",
        });
      }
    }

    for (const action of Object.keys(collection.auth?.actions ?? {})) {
      const auth = resolveCollectionActionAuth(collection, action);
      if (auth) {
        addPermissionDefinition(permissions, {
          key: auth.capability,
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

  const existing = permissions.get(definition.key);

  if (existing) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `Duplicate derived permission key: ${definition.key}`,
      {
        capability: definition.key,
        operation: `${existing.source}->${definition.source}`,
      },
    );
  }

  permissions.set(definition.key, definition);
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
    collection: registration.name,
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
