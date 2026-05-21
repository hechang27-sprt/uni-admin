import type {
  JsonObject,
  NormalizedListDocumentsInput,
  StoredDocument,
} from "../types";
import type {
  DocumentRepository,
  InsertDocumentRecord,
  InsertManyDocumentsRecord,
  UpdateDocumentRecord,
  UpdateManyDocumentsRecord,
  UpsertRemoteProjectionsRecord,
} from "./types";
import { applyDocumentUpdate, cloneDocument, cloneJsonObject } from "./mapping";
import { compareDocuments, matchesFilter, normalizeSort } from "./query";

export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly records = new Map<string, StoredDocument>();

  async insert<TData extends JsonObject>(
    record: InsertDocumentRecord<TData>,
  ): Promise<StoredDocument<TData>> {
    const now = new Date();
    const document: StoredDocument<TData> = {
      id: crypto.randomUUID(),
      tenantId: record.tenantId,
      collection: record.collection,
      schemaVersion: record.schemaVersion,
      data: cloneJsonObject(record.data),
      remoteSource: record.remoteSource ?? null,
      remoteId: record.remoteId ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    this.records.set(document.id, document);
    return cloneDocument(document);
  }

  async insertMany<TData extends JsonObject>(
    record: InsertManyDocumentsRecord<TData>,
  ): Promise<StoredDocument<TData>[]> {
    const documents: StoredDocument<TData>[] = [];

    for (const item of record.items) {
      const now = new Date();
      const document: StoredDocument<TData> = {
        id: crypto.randomUUID(),
        tenantId: record.tenantId,
        collection: record.collection,
        schemaVersion: record.schemaVersion,
        data: cloneJsonObject(item.data),
        remoteSource: item.remoteSource ?? null,
        remoteId: item.remoteId ?? null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      this.records.set(document.id, document);
      documents.push(cloneDocument(document));
    }

    return documents;
  }

  async findById<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    id: string;
    includeDeleted?: boolean;
  }): Promise<StoredDocument<TData> | null> {
    const document = this.records.get(input.id);

    if (!isVisibleDocument(document, input)) {
      return null;
    }

    return cloneDocument(document) as StoredDocument<TData>;
  }

  async findByIds<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    ids: string[];
    includeDeleted?: boolean;
  }): Promise<(StoredDocument<TData> | null)[]> {
    return input.ids.map((id) => {
      const document = this.records.get(id);

      if (!isVisibleDocument(document, input)) {
        return null;
      }

      return cloneDocument(document) as StoredDocument<TData>;
    });
  }

  async findByRemoteIdentity<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    remoteSource: string;
    remoteId: string;
    includeDeleted?: boolean;
  }): Promise<StoredDocument<TData> | null> {
    const document = [...this.records.values()].find((record) => {
      return (
        isVisibleDocument(record, input) &&
        record.remoteSource === input.remoteSource &&
        record.remoteId === input.remoteId
      );
    });

    return document ? (cloneDocument(document) as StoredDocument<TData>) : null;
  }

  async list<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    query: NormalizedListDocumentsInput;
  }): Promise<StoredDocument<TData>[]> {
    const filtered = [...this.records.values()].filter((document) => {
      return (
        isVisibleDocument(document, {
          tenantId: input.tenantId,
          collection: input.collection,
          includeDeleted: input.query.includeDeleted,
        }) &&
        (!input.query.filter || matchesFilter(document, input.query.filter))
      );
    });

    filtered.sort((left, right) =>
      compareDocuments(left, right, normalizeSort(input.query.sort)),
    );

    return filtered
      .slice(input.query.offset, input.query.offset + input.query.limit)
      .map((document) => cloneDocument(document) as StoredDocument<TData>);
  }

  async update<TData extends JsonObject>(
    record: UpdateDocumentRecord<TData>,
  ): Promise<StoredDocument<TData> | null> {
    const document = this.records.get(record.id);

    if (
      !document ||
      document.tenantId !== record.tenantId ||
      document.collection !== record.collection ||
      document.version !== record.expectedVersion
    ) {
      return null;
    }

    const updated = applyDocumentUpdate(document, record);

    this.records.set(record.id, updated);
    return cloneDocument(updated);
  }

  async updateMany<TData extends JsonObject>(
    record: UpdateManyDocumentsRecord<TData>,
  ): Promise<StoredDocument<TData>[] | null> {
    const draft = new Map(this.records);
    const documents: StoredDocument<TData>[] = [];

    for (const updateRecord of record.records) {
      const document = draft.get(updateRecord.id);

      if (
        !document ||
        document.tenantId !== updateRecord.tenantId ||
        document.collection !== updateRecord.collection ||
        document.version !== updateRecord.expectedVersion
      ) {
        return null;
      }

      const updated = applyDocumentUpdate(document, updateRecord);

      draft.set(updateRecord.id, updated);
      documents.push(cloneDocument(updated));
    }

    this.records.clear();
    for (const [id, document] of draft) {
      this.records.set(id, document);
    }

    return documents;
  }

  async upsertRemoteProjections<TData extends JsonObject>(
    record: UpsertRemoteProjectionsRecord<TData>,
  ): Promise<StoredDocument<TData>[]> {
    const documents: StoredDocument<TData>[] = [];

    for (const projection of record.projections) {
      const existing = [...this.records.values()].find((document) => {
        return (
          document.tenantId === record.tenantId &&
          document.collection === record.collection &&
          document.remoteSource === record.remoteSource &&
          document.remoteId === projection.remoteId
        );
      });
      const now = new Date();

      if (!existing) {
        const document: StoredDocument<TData> = {
          id: crypto.randomUUID(),
          tenantId: record.tenantId,
          collection: record.collection,
          schemaVersion: record.schemaVersion,
          data: cloneJsonObject(projection.data),
          remoteSource: record.remoteSource,
          remoteId: projection.remoteId,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };

        this.records.set(document.id, document);
        documents.push(cloneDocument(document));
        continue;
      }

      const updated: StoredDocument<TData> = {
        ...existing,
        schemaVersion: record.schemaVersion,
        data: cloneJsonObject(projection.data),
        remoteSource: record.remoteSource,
        remoteId: projection.remoteId,
        version: existing.version + 1,
        updatedAt: now,
        deletedAt: null,
      };

      this.records.set(existing.id, updated);
      documents.push(cloneDocument(updated));
    }

    return documents;
  }

  async hardDelete(input: {
    tenantId: string;
    collection: string;
    id: string;
  }): Promise<boolean> {
    const document = this.records.get(input.id);

    if (
      !document ||
      document.tenantId !== input.tenantId ||
      document.collection !== input.collection
    ) {
      return false;
    }

    return this.records.delete(input.id);
  }
}

function isVisibleDocument(
  document: StoredDocument | undefined,
  input: {
    tenantId: string;
    collection: string;
    includeDeleted?: boolean;
  },
): document is StoredDocument {
  return Boolean(
    document &&
    document.tenantId === input.tenantId &&
    document.collection === input.collection &&
    (input.includeDeleted || !document.deletedAt),
  );
}
