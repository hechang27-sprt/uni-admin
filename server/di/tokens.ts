export const SERVER_DI_TYPES = {
  DatabaseClient: Symbol.for("uni-admin.server.DatabaseClient"),
  CollectionRegistry: Symbol.for("uni-admin.server.CollectionRegistry"),
  DocumentRepository: Symbol.for("uni-admin.server.DocumentRepository"),
  AuthRbacRepository: Symbol.for("uni-admin.server.AuthRbacRepository"),
  AuthRbacService: Symbol.for("uni-admin.server.AuthRbacService"),
  DocumentService: Symbol.for("uni-admin.server.DocumentService"),
} as const;
