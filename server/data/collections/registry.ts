import { z } from "zod";
import { injectable } from "inversify";

import { DocumentServiceError } from "../documents/errors";
import type { RemoteCollectionAdapter } from "../documents/remote";

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
  "app",
  "admin",
  "global",
] as const;
export const DEFAULT_APP_KEY = "default";

const collectionOperationSchema = z.enum(collectionOperationValues);

const collectionResourceScopeModeSchema = z.enum(["document", "tenant-root"]);

const collectionOperationAuthDeclarationSchema = z
  .object({
    resourceScope: collectionResourceScopeModeSchema.optional(),
  })
  .strict();

const collectionOperationAuthInputSchema = z.union([
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
  "hard-delete": collectionOperationAuthInputSchema.optional(),
  actions: z
    .record(safePermissionSegmentSchema, collectionOperationAuthInputSchema)
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

export type CollectionSchema<TData extends JsonObject = JsonObject> =
  z.ZodObject<z.ZodRawShape> & z.ZodType<TData>;

type CollectionSchemaData<TSchema extends CollectionSchema> =
  z.output<TSchema> & JsonObject;

type CollectionActionDefinitions = Record<string, CollectionActionDefinition>;

type CollectionActionKey<TActions extends CollectionActionDefinitions> =
  Extract<keyof TActions, string>;

export type CollectionActionHandler<TInput = unknown, TOutput = unknown> = (
  context: unknown,
  input: TInput,
) => TOutput | Promise<TOutput>;

export type CollectionActionDefinition<
  TInputSchema extends z.ZodType = z.ZodType,
  TOutput = unknown,
> = {
  input?: TInputSchema;
  handler: CollectionActionHandler<z.output<TInputSchema>, TOutput>;
};

const collectionActionDefinitionSchema = z
  .object({
    input: z
      .custom<z.ZodType>(
        (value) => value instanceof z.ZodType,
        "Collection action input must be a Zod schema",
      )
      .optional(),
    handler: z.custom<CollectionActionHandler>(
      (value) => typeof value === "function",
      "Collection action handler must be a function",
    ),
  })
  .strict();

export const collectionRegistrationBaseSchema = z.object({
  appKey: safePermissionSegmentSchema.optional(),
  key: safePermissionSegmentSchema.optional(),
  name: z.string().min(1).optional(),
  definitionKey: safePermissionSegmentSchema.optional(),
  schemaVersion: z.number().int().positive(),
});

function collectionRegistrationSchema<
  TSchema extends CollectionSchema = CollectionSchema,
>() {
  return collectionRegistrationBaseSchema
    .extend({
      schema: z.custom<TSchema>(
        (value) => value instanceof z.ZodObject,
        "Collection schema must be a Zod object",
      ),
      actions: z
        .record(safePermissionSegmentSchema, collectionActionDefinitionSchema)
        .optional(),
      auth: collectionAuthDeclarationSchema.optional(),
      remoteAdapter: z
        .custom<RemoteCollectionAdapter<CollectionSchemaData<TSchema>>>()
        .optional(),
    })
    .superRefine((registration, context) => {
      const actions = registration.actions ?? {};

      for (const action of Object.keys(registration.auth?.actions ?? {})) {
        if (actions[action]) {
          continue;
        }

        context.addIssue({
          code: "custom",
          message: `Action auth requires a matching action callback: ${action}`,
          path: ["auth", "actions", action],
        });
      }
    });
}

function registeredCollectionSchema<
  TSchema extends CollectionSchema = CollectionSchema,
>() {
  return collectionRegistrationSchema<TSchema>()
    .transform((registration, context) => {
      const key = registration.key ?? registration.name;

      if (!key) {
        context.addIssue({
          code: "custom",
          message: "Collection registration requires a key or name",
          path: ["key"],
        });

        return z.NEVER;
      }

      return {
        ...registration,
        appKey: registration.appKey ?? DEFAULT_APP_KEY,
        key,
        name: registration.name ?? key,
        definitionKey: registration.definitionKey ?? key,
      };
    })
    .brand<"RegisteredCollection">();
}

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

export type CollectionAuthDeclaration<TActionKey extends string = string> =
  Omit<z.infer<typeof collectionAuthDeclarationSchema>, "actions"> & {
    actions?: Partial<Record<TActionKey, CollectionOperationAuthInput>>;
  };

export type CollectionActionAuthDeclaration<
  TActionKey extends string = string,
> = NonNullable<CollectionAuthDeclaration<TActionKey>["actions"]>[TActionKey];

export type ResolvedCollectionOperationAuth = z.infer<
  typeof _resolvedCollectionOperationAuthSchema
>;
export type PermissionDefinition = z.infer<typeof permissionDefinitionSchema>;

type CollectionRegistrationInput<TSchema extends CollectionSchema> = z.input<
  ReturnType<typeof collectionRegistrationSchema<TSchema>>
>;

export type CollectionRegistration<
  TSchema extends CollectionSchema = CollectionSchema,
  TActions extends CollectionActionDefinitions = CollectionActionDefinitions,
> = Omit<CollectionRegistrationInput<TSchema>, "actions" | "auth"> & {
  actions?: TActions;
  auth?: CollectionAuthDeclaration<CollectionActionKey<NoInfer<TActions>>>;
};

export type RegisteredCollection<
  TSchema extends CollectionSchema = CollectionSchema,
> = z.output<ReturnType<typeof registeredCollectionSchema<TSchema>>>;

export function defineCollection<
  TSchema extends CollectionSchema,
  const TActions extends CollectionActionDefinitions = Record<never, never>,
>(
  registration: CollectionRegistration<TSchema, TActions>,
): CollectionRegistration<TSchema, TActions> {
  parseRegistration(registration);
  return registration;
}

@injectable()
export class CollectionRegistry {
  private readonly collections = new Map<string, RegisteredCollection>();

  static fromRegistrations(
    registrations: CollectionRegistration[] = [],
  ): CollectionRegistry {
    const registry = new CollectionRegistry();

    for (const registration of registrations) {
      registry.register(registration);
    }

    return registry;
  }

  static resolveOperationAuth(
    collection: CollectionRegistration,
    operation: CollectionOperation,
  ): ResolvedCollectionOperationAuth | null {
    const declaration = collection.auth?.[operation];

    if (declaration === false) {
      return null;
    }

    return {
      capability: operation,
      resourceScope:
        declaration?.resourceScope ??
        collection.auth?.resourceScope ??
        "document",
    };
  }

  static resolveActionAuth(
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

  register<TSchema extends CollectionSchema>(
    registration: CollectionRegistration<TSchema>,
  ): this {
    const collection = parseRegistration(registration);
    const registryKey = CollectionRegistry.registryKey(
      collection.appKey,
      collection.key,
    );

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

  get<TSchema extends CollectionSchema = CollectionSchema>(
    key: string,
  ): RegisteredCollection<TSchema>;
  get(key: string): RegisteredCollection {
    const collection = this.collections.get(
      CollectionRegistry.registryKey(DEFAULT_APP_KEY, key),
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

    return collection;
  }

  has(key: string): boolean {
    return this.collections.has(
      CollectionRegistry.registryKey(DEFAULT_APP_KEY, key),
    );
  }

  getForApp<TSchema extends CollectionSchema = CollectionSchema>(
    appKey: string,
    key: string,
  ): RegisteredCollection<TSchema>;
  getForApp(appKey: string, key: string): RegisteredCollection {
    const collection = this.collections.get(
      CollectionRegistry.registryKey(appKey, key),
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

    return collection;
  }

  hasForApp(appKey: string, key: string): boolean {
    return this.collections.has(CollectionRegistry.registryKey(appKey, key));
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

  derivePermissionDefinitions(): PermissionDefinition[] {
    const permissions = new Map<string, PermissionDefinition>();

    for (const collection of this.list()) {
      for (const operation of collectionOperations) {
        const auth = CollectionRegistry.resolveOperationAuth(
          collection,
          operation,
        );
        if (auth) {
          CollectionRegistry.addPermissionDefinition(permissions, {
            appKey: collection.appKey,
            collectionKey: collection.key,
            capabilityId: auth.capability,
            source: "collection",
          });
        }
      }

      for (const action of Object.keys(collection.actions ?? {})) {
        const auth = CollectionRegistry.resolveActionAuth(collection, action);
        if (auth) {
          CollectionRegistry.addPermissionDefinition(permissions, {
            appKey: collection.appKey,
            collectionKey: collection.key,
            capabilityId: auth.capability,
            source: "collection",
          });
        }
      }
    }

    return permissions.values().toArray();
  }

  private static addPermissionDefinition(
    permissions: Map<string, PermissionDefinition>,
    definition: PermissionDefinition,
  ): void {
    permissionDefinitionSchema.parse(definition);

    const derivedKey =
      CollectionRegistry.permissionDefinitionIdentity(definition);
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

  private static permissionDefinitionIdentity(
    definition: PermissionDefinition,
  ): string {
    return [
      definition.appKey ?? "",
      definition.collectionKey ?? "",
      definition.capabilityId ?? definition.key ?? "",
    ].join(":");
  }

  private static registryKey(appKey: string, key: string): string {
    return `${appKey}:${key}`;
  }
}

function parseRegistration<TSchema extends CollectionSchema>(
  registration: CollectionRegistration<TSchema>,
): RegisteredCollection<TSchema> {
  const { success, data, error } =
    registeredCollectionSchema<TSchema>().safeParse(registration);

  if (success) {
    return data;
  }

  const invalidPath = error.issues[0]?.path.join(".");
  const message = invalidPath
    ? `Collection registration is invalid at ${invalidPath}`
    : "Collection registration is invalid";

  throw new DocumentServiceError("VALIDATION_FAILED", message, {
    collection: registration.key ?? registration.name,
    issues: error.issues,
  });
}

const collectionOperations: CollectionOperation[] =
  collectionOperationSchema.options;
