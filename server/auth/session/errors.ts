export type SessionErrorCode =
  | "SESSION_INVALID_CREDENTIALS"
  | "SESSION_INVALID_SESSION"
  | "SESSION_TENANT_REQUIRED"
  | "SESSION_TENANT_MEMBERSHIP_REQUIRED";

export interface SessionErrorDetails {
  userId?: string;
  tenantId?: string;
  reason?: string;
}

export class SessionError extends Error {
  readonly code: SessionErrorCode;
  readonly details: SessionErrorDetails;

  constructor(
    code: SessionErrorCode,
    message: string,
    details: SessionErrorDetails = {},
  ) {
    super(message);
    this.name = "SessionError";
    this.code = code;
    this.details = details;
  }
}

export function isSessionError(error: unknown): error is SessionError {
  return error instanceof SessionError;
}
