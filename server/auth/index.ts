export { AuthRbacError, isAuthRbacError } from "./errors";
export { hashPassword, verifyPassword } from "./password";
export {
  DrizzleAuthRbacRepository,
  tenantRootScopeKey,
  type AuthRbacRepository,
} from "./repository";
export { builtInAdminPermissions, createAuthRbacService } from "./service";
export type {
  AssignRoleInput,
  AuthRbacService,
  AuthScope,
  AuthUser,
  BootstrapTenantOwnerInput,
  BootstrapTenantOwnerResult,
  CheckAccessInput,
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
