export { AuthRbacError, isAuthRbacError } from "./errors";
export { hashPassword, verifyPassword } from "./password";
export {
  KyselyAuthRbacRepository,
  tenantRootScopeKey,
  type AuthRbacRepository,
} from "./repository";
export {
  AuthRbacService,
  builtInAdminPermissions,
  type AuthRbacServiceConfig,
} from "./service";
export type {
  AssignRoleInput,
  AuthScope,
  AuthUser,
  BootstrapTenantOwnerInput,
  BootstrapTenantOwnerResult,
  CheckAccessInput,
  CheckAccessManyInput,
  CreateRoleInput,
  CreateScopeInput,
  CreateTenantMembershipInput,
  CreateUserInput,
  DocumentAuthorizer,
  GrantPermissionInput,
  ListAccessibleScopesInput,
  Permission,
  PermissionDefinitionInput,
  Role,
  SetPasswordCredentialInput,
  TenantMembership,
  UsernamePasswordCredential,
  VerifyPasswordInput,
} from "./types";
