import type { BranchConfig } from "../config/types.branch.js";
import { splitTrailingAuthProfile } from "./model-ref-profile.js";

export type ModelChoiceDecision = "allow" | "deny";

export type ModelChoiceRequest = {
  /** Requested model reference; null resets to the configured default. */
  model: string | null;
};

export const MODEL_CHOICE_OFF_MESSAGE =
  'Nothing was changed: "Trunks may switch their own model" is off in Settings › Models. Ask the person to change the model, or to turn that setting on.';

export const MODEL_CHOICE_NO_PROMPT_MESSAGE =
  "Nothing was changed: switching the model needs the person's approval, and Branch can't ask them from here.";

export const MODEL_CHOICE_PER_TASK_OFF_MESSAGE =
  'Nothing was started: "Pick the model per task" is off in Settings › Models. Start the task without a model, or ask the person to turn that setting on.';

/**
 * A Trunk may name the model when it starts a task (sessions_spawn `model`), as
 * upstream allows, unless the owner turns "Pick the model per task" off.
 */
export function isPerTaskModelChoiceEnabled(cfg: BranchConfig | undefined): boolean {
  return cfg?.tools?.modelChoice?.perTask !== false;
}

/** Trunk-made model and sign-in changes are off unless the owner turns them on. */
export function isAgentModelChoiceEnabled(cfg: BranchConfig | undefined): boolean {
  return cfg?.tools?.modelChoice?.enabled === true;
}

/** The one-line question shown on the approve card. */
export function describeModelChoiceRequest(request: ModelChoiceRequest): string {
  if (request.model === null) {
    return "Switch back to the default model?";
  }
  const { model, profile: account } = splitTrailingAuthProfile(request.model);
  return account
    ? `Switch to ${model} on account ${account}?`
    : `Switch to ${model} on the current account?`;
}

export function describeModelChoiceDenied(request: ModelChoiceRequest): string {
  const target =
    request.model === null ? "the default model" : splitTrailingAuthProfile(request.model).model;
  return `Nothing was changed: the person didn't allow switching to ${target}. The model stays as it was.`;
}

/**
 * Decides an agent-made model change: refused while the setting is off, applied
 * directly with Full access, otherwise exactly one approval request.
 */
export async function authorizeAgentModelChange(params: {
  cfg: BranchConfig | undefined;
  fullAccess: boolean;
  request: ModelChoiceRequest;
  requestApproval?: (question: string) => Promise<ModelChoiceDecision | "unavailable">;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isAgentModelChoiceEnabled(params.cfg)) {
    return { ok: false, reason: MODEL_CHOICE_OFF_MESSAGE };
  }
  if (params.fullAccess) {
    return { ok: true };
  }
  if (!params.requestApproval) {
    return { ok: false, reason: MODEL_CHOICE_NO_PROMPT_MESSAGE };
  }
  const decision = await params.requestApproval(describeModelChoiceRequest(params.request));
  if (decision === "unavailable") {
    return { ok: false, reason: MODEL_CHOICE_NO_PROMPT_MESSAGE };
  }
  return decision === "allow"
    ? { ok: true }
    : { ok: false, reason: describeModelChoiceDenied(params.request) };
}
