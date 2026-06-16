export { AuthRbacError, isAuthRbacError } from "./errors";
export { hashPassword, verifyPassword } from "./password";
export { buildPermissionKey } from "./permission-key";
export {
  KyselyAuthRbacRepository,
  tenantRootScopeKey,
  type AuthRbacRepository,
} from "./repository";
export { AuthRbacService, builtInAdminPermissions } from "./service";
export type {
  AssignRoleInput,
  AccessCheckEvaluation,
  AccessCheckFailure,
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
