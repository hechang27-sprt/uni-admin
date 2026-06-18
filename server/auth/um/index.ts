export { AuthRbacError, isAuthRbacError } from "./errors";
export { hashPassword, verifyPassword } from "./password";
export { buildPermissionKey } from "./permission-key";
export {
  KyselyAuthRbacRepository,
  tenantRootScopeKey,
  type AuthRbacRepository,
} from "./repository";
export { AuthRbacService, builtInAdminPermissions } from "./service";
export { BOTTOM_SCOPE_ID, resourceScopeModeSchema, SYSTEM_TENANT_ID } from "./types";
export type {
  AssignRoleInput,
  AccessCheckEvaluation,
  AccessCheckFailure,
  AuthScope,
  AuthUser,
  BootstrapTenantOwnerInput,
  BootstrapTenantOwnerResult,
  GrantedScopes,
  CheckAccessInput,
  CheckAccessManyInput,
  CreateRoleInput,
  CreateScopeInput,
  CreateTenantMembershipInput,
  CreateUserInput,
  GrantPermissionInput,
  ListAccessibleScopesInput,
  Permission,
  PermissionDefinitionInput,
  ResourceScopeMode,
  Role,
  SetPasswordCredentialInput,
  TenantMembership,
  UsernamePasswordCredential,
  VerifyPasswordInput,
} from "./types";
