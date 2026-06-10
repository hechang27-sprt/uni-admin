import "reflect-metadata";

import { Container, type ContainerOptions } from "inversify";

import {
  AuthRbacService,
  KyselyAuthRbacRepository,
  type AuthRbacRepository,
} from "#server/auth/um";
import {
  CatalogService,
  KyselyCatalogRepository,
  type CatalogRepository,
} from "#server/data/catalog";
import type { CollectionRegistry } from "#server/data/collections";
import {
  DocumentService,
  KyselyDocumentRepository,
  type DocumentRepository,
} from "#server/data/documents";
import { SERVER_DI_TYPES } from "./tokens";

export interface ServerContainerOptions {
  database: DatabaseClient;
  registry: CollectionRegistry;
  containerOptions?: ContainerOptions;
}

export function createServerContainer(
  options: ServerContainerOptions,
): Container {
  const container = new Container(options.containerOptions);

  container
    .bind<DatabaseClient>(SERVER_DI_TYPES.DatabaseClient)
    .toConstantValue(options.database);
  container
    .bind<CollectionRegistry>(SERVER_DI_TYPES.CollectionRegistry)
    .toConstantValue(options.registry);
  container
    .bind<AuthRbacRepository>(SERVER_DI_TYPES.AuthRbacRepository)
    .to(KyselyAuthRbacRepository)
    .inSingletonScope();
  container
    .bind<DocumentRepository>(SERVER_DI_TYPES.DocumentRepository)
    .to(KyselyDocumentRepository)
    .inSingletonScope();
  container
    .bind<CatalogRepository>(SERVER_DI_TYPES.CatalogRepository)
    .to(KyselyCatalogRepository)
    .inSingletonScope();
  container
    .bind<AuthRbacService>(SERVER_DI_TYPES.AuthRbacService)
    .to(AuthRbacService)
    .inSingletonScope();
  container
    .bind<CatalogService>(SERVER_DI_TYPES.CatalogService)
    .to(CatalogService)
    .inSingletonScope();
  container
    .bind<DocumentService>(SERVER_DI_TYPES.DocumentService)
    .to(DocumentService)
    .inSingletonScope();

  return container;
}
