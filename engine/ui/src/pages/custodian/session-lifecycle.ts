import {
  readSystemAgentSessionInvalidatedErrorDetails,
  readSystemAgentInferenceUnavailableErrorDetails,
  type SystemAgentChatParams,
  type SystemAgentErrorFixAction,
} from "@branch/gateway-protocol";
import type { SystemAgentPluginReference } from "@branch/gateway-protocol/system-agent-context";
import { inferBasePathFromPathname, routeIdFromPath } from "../../app-route-paths.ts";

export type CustodianSessionVariant = "onboarding" | "new-agent" | "caretaker";

export function sessionVariant(
  onboarding: boolean,
  newAgentIntent: boolean,
): CustodianSessionVariant {
  return onboarding ? "onboarding" : newAgentIntent ? "new-agent" : "caretaker";
}

export function custodianChatParams(
  variant: CustodianSessionVariant,
  message?: string,
  plugin?: SystemAgentPluginReference,
): Pick<SystemAgentChatParams, "welcomeVariant" | "message" | "context"> {
  const variantParams = variant === "caretaker" ? {} : { welcomeVariant: variant };
  if (message === undefined) {
    return variantParams;
  }
  const pathname = window.location.pathname;
  const page = routeIdFromPath(pathname, inferBasePathFromPathname(pathname));
  return {
    ...variantParams,
    message,
    ...(page ? { context: { page, ...(plugin ? { plugin } : {}) } } : {}),
  };
}

export function hasCustodianUserInput(params: SystemAgentChatParams): boolean {
  return (
    params.message !== undefined ||
    params.wizardAnswer !== undefined ||
    params.wizardCancel !== undefined
  );
}

/**
 * The fix for the error on screen. A fix is bound to the one error sentence it
 * was offered for, so a later or cleared error drops it.
 */
export function custodianFixAction(
  fix: { error: string; action?: SystemAgentErrorFixAction } | null,
  error: string | null,
): SystemAgentErrorFixAction | null {
  return fix?.action && error !== null && fix.error === error ? fix.action : null;
}

export function custodianFailure(error: unknown): {
  inferenceUnavailable: boolean;
  sessionInvalidated: boolean;
  /** The fix the Gateway named for this failure, so the chat offers what the sentence says. */
  action?: SystemAgentErrorFixAction;
} {
  const details =
    error && typeof error === "object" ? (error as { details?: unknown }).details : undefined;
  const inference = readSystemAgentInferenceUnavailableErrorDetails(details);
  const invalidated = readSystemAgentSessionInvalidatedErrorDetails(details);
  const action = inference?.action ?? invalidated?.action;
  return {
    inferenceUnavailable: inference !== undefined,
    sessionInvalidated: invalidated !== undefined,
    ...(action ? { action } : {}),
  };
}
