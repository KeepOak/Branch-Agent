import { randomUUID } from "node:crypto";

// Preserve the existing gateway error/message; the shared id connects its response
// to the server-side failure log without exposing any additional exception data.
export function createRequestErrorCorrelation(message: string): {
  errorId: string;
  logMessage: string;
  details: { error_id: string };
} {
  const errorId = randomUUID().replaceAll("-", "");
  return {
    errorId,
    logMessage: `request handler failed: ${message} [error_id=${errorId}]`,
    details: { error_id: errorId },
  };
}
