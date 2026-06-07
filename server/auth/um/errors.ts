export type AuthRbacErrorCode =
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_USER_DISABLED"
  | "AUTH_TENANT_MEMBERSHIP_REQUIRED"
  | "AUTH_SCOPE_NOT_FOUND"
  | "AUTH_SCOPE_CROSS_TENANT"
  | "AUTH_PERMISSION_DENIED"
  | "AUTH_ROLE_NOT_FOUND"
  | "AUTH_PERMISSION_NOT_FOUND"
  | "AUTH_LAST_OWNER_PROTECTED";

export interface AuthRbacErrorDetails {
  tenantId?: string;
  userId?: string;
  scopeId?: string | null;
  roleId?: string;
  roleKey?: string;
  permissionKey?: string;
  capability?: string;
}

export class AuthRbacError extends Error {
  readonly code: AuthRbacErrorCode;
  readonly details: AuthRbacErrorDetails;

  constructor(
    code: AuthRbacErrorCode,
    message: string,
    details: AuthRbacErrorDetails = {},
  ) {
    super(message);
    this.name = "AuthRbacError";
    this.code = code;
    this.details = details;
  }
}

export function isAuthRbacError(error: unknown): error is AuthRbacError {
  return error instanceof AuthRbacError;
}
