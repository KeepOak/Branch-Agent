import { toStringifiedError } from "@branch/normalization-core/error-coercion";
import { z } from "zod";
import { nativeErrorResponseSchema } from "../infra/native-error-response-schema.js";
import {
  restoreNativeErrorResponse,
  serializeNativeErrorResponse,
} from "../infra/native-error-response.js";
import { formatSqliteReadOnlyInspectionFailure } from "../infra/sqlite-error-diagnostics.js";
import {
  encodeBranchStateWorkerError,
  hydrateBranchStateWorkerError,
  retainBranchStateWorkerErrorPayload,
} from "./branch-state-worker-error.js";

export const agentSchemaInspectionErrorSchema = nativeErrorResponseSchema.extend({
  stateError: z.unknown().optional(),
});

type InspectionError = z.infer<typeof agentSchemaInspectionErrorSchema>;

export function serializeAgentSchemaInspectionError(value: unknown): InspectionError {
  const error = toStringifiedError(value);
  return {
    ...serializeNativeErrorResponse(error),
    message: formatSqliteReadOnlyInspectionFailure(error),
    stateError: encodeBranchStateWorkerError(error),
  };
}

export function restoreAgentSchemaInspectionError(value: InspectionError): Error {
  const error = restoreNativeErrorResponse(value);
  if (value.stateError) {
    retainBranchStateWorkerErrorPayload(error, value.stateError);
  }
  const restored = hydrateBranchStateWorkerError(error);
  restored.message = value.message;
  return restored;
}
