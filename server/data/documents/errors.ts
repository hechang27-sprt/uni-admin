import type { DocumentErrorCode, DocumentErrorDetails } from "./types";

export class DocumentServiceError extends Error {
  readonly code: DocumentErrorCode;
  readonly details: DocumentErrorDetails;

  constructor(
    code: DocumentErrorCode,
    message: string,
    details: DocumentErrorDetails = {},
  ) {
    super(message);
    this.name = "DocumentServiceError";
    this.code = code;
    this.details = details;
  }
}

export function isDocumentServiceError(
  error: unknown,
): error is DocumentServiceError {
  return error instanceof DocumentServiceError;
}
