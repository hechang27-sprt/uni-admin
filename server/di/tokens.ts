export const SERVER_DI_TYPES = {
  DatabaseClient: Symbol.for("uni-admin.server.DatabaseClient"),
  CollectionRegistry: Symbol.for("uni-admin.server.CollectionRegistry"),
  DocumentRepository: Symbol.for("uni-admin.server.DocumentRepository"),
  CatalogRepository: Symbol.for("uni-admin.server.CatalogRepository"),
  AuthRbacRepository: Symbol.for("uni-admin.server.AuthRbacRepository"),
  AuthRbacService: Symbol.for("uni-admin.server.AuthRbacService"),
  CatalogService: Symbol.for("uni-admin.server.CatalogService"),
  DocumentService: Symbol.for("uni-admin.server.DocumentService"),
} as const;
