import { isProtocolRecord } from "./protocol-value-normalization.js";

/** Structured system-agent details carried in gateway error payloads. */
export const SystemAgentErrorDetailCodes = {
  INFERENCE_UNAVAILABLE: "system_agent_inference_unavailable",
  SESSION_INVALIDATED: "system_agent_session_invalidated",
} as const;

/** The single fix a chat surface offers beside a plain failure sentence. */
export type SystemAgentErrorFixAction = "retry" | "open-accounts";
const FIX_ACTIONS: readonly string[] = ["retry", "open-accounts"];

export type SystemAgentInferenceUnavailableErrorDetails = {
  code: typeof SystemAgentErrorDetailCodes.INFERENCE_UNAVAILABLE;
  action?: SystemAgentErrorFixAction;
};

export type SystemAgentSessionInvalidatedErrorDetails = {
  code: typeof SystemAgentErrorDetailCodes.SESSION_INVALIDATED;
  action?: SystemAgentErrorFixAction;
};

function withAction<T extends { code: string }>(
  details: T,
  action: SystemAgentErrorFixAction | undefined,
): T & { action?: SystemAgentErrorFixAction } {
  return action ? { ...details, action } : details;
}

function readAction(value: unknown): { action?: SystemAgentErrorFixAction } {
  return typeof value === "string" && FIX_ACTIONS.includes(value)
    ? { action: value as SystemAgentErrorFixAction }
    : {};
}

export function buildSystemAgentInferenceUnavailableErrorDetails(
  action?: SystemAgentErrorFixAction,
): SystemAgentInferenceUnavailableErrorDetails {
  return withAction({ code: SystemAgentErrorDetailCodes.INFERENCE_UNAVAILABLE }, action);
}

export function buildSystemAgentSessionInvalidatedErrorDetails(
  action?: SystemAgentErrorFixAction,
): SystemAgentSessionInvalidatedErrorDetails {
  return withAction({ code: SystemAgentErrorDetailCodes.SESSION_INVALIDATED }, action);
}

export function readSystemAgentInferenceUnavailableErrorDetails(
  details: unknown,
): SystemAgentInferenceUnavailableErrorDetails | undefined {
  if (!isProtocolRecord(details)) {
    return undefined;
  }
  const code = details.code;
  return code === SystemAgentErrorDetailCodes.INFERENCE_UNAVAILABLE
    ? { code, ...readAction(details.action) }
    : undefined;
}

export function readSystemAgentSessionInvalidatedErrorDetails(
  details: unknown,
): SystemAgentSessionInvalidatedErrorDetails | undefined {
  if (!isProtocolRecord(details)) {
    return undefined;
  }
  const code = details.code;
  return code === SystemAgentErrorDetailCodes.SESSION_INVALIDATED
    ? { code, ...readAction(details.action) }
    : undefined;
}
