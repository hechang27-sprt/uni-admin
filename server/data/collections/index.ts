export {
  DEFAULT_APP_KEY,
  CollectionRegistry,
  defineCollection,
  createCollectionRegistry,
  deriveCollectionPermissionDefinitions,
  resolveCollectionActionAuth,
  resolveCollectionOperationAuth,
} from "./registry";
export type {
  CollectionActionAuthDeclaration,
  CollectionActionDefinition,
  CollectionActionHandler,
  CollectionAuthDeclaration,
  CollectionOperation,
  CollectionOperationAuthDeclaration,
  CollectionOperationAuthInput,
  CollectionSchema,
  CollectionRegistration,
  CollectionResourceScopeMode,
  PermissionDefinition,
  ResolvedCollectionOperationAuth,
  RegisteredCollection,
} from "./registry";
