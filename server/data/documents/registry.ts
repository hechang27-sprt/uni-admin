import type { z } from "zod";

import { DocumentServiceError } from "./errors";
import type { JsonObject } from "./types";

export interface CollectionRegistration<TData extends JsonObject = JsonObject> {
  name: string;
  schema: z.ZodType<TData>;
  schemaVersion: number;
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

    this.collections.set(registration.name, registration);
    return this;
  }

  get(name: string): CollectionRegistration {
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

    return collection;
  }

  has(name: string): boolean {
    return this.collections.has(name);
  }

  list(): CollectionRegistration[] {
    return [...this.collections.values()];
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
