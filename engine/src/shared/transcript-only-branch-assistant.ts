import { asOptionalRecord } from "@branch/normalization-core/record-coerce";

// Identifies Branch-authored assistant rows that are transcript bookkeeping,
// not provider model output. Some history surfaces keep gateway-injected rows
// visible, so use the narrower delivery-mirror predicate when visibility matters.
export const BRANCH_TRANSCRIPT_ARTIFACT_API = "branch-transcript" as const;
export const BRANCH_TRANSCRIPT_ARTIFACT_PROVIDER = "branch" as const;
export const BRANCH_DELIVERY_MIRROR_MODEL = "delivery-mirror" as const;
export const CRON_DIRECT_DELIVERY_CONTEXT_KIND = "cron-direct-delivery-context" as const;
const BRANCH_GATEWAY_INJECTED_MODEL = "gateway-injected" as const;

const TRANSCRIPT_ONLY_BRANCH_ASSISTANT_MODELS = new Set<string>([
  BRANCH_DELIVERY_MIRROR_MODEL,
  BRANCH_GATEWAY_INJECTED_MODEL,
]);
const BRANCH_DELIVERY_MIRROR_KINDS = new Set([
  "channel-final",
  "channel-final-suppressed",
  "message-tool-source-reply",
  CRON_DIRECT_DELIVERY_CONTEXT_KIND,
]);

function isBranchDeliveryMirrorMarker(value: unknown): boolean {
  const kind = asOptionalRecord(value)?.kind;
  return typeof kind === "string" && BRANCH_DELIVERY_MIRROR_KINDS.has(kind);
}

export function isTranscriptOnlyBranchAssistantModel(provider: unknown, model: unknown): boolean {
  return (
    provider === BRANCH_TRANSCRIPT_ARTIFACT_PROVIDER &&
    typeof model === "string" &&
    TRANSCRIPT_ONLY_BRANCH_ASSISTANT_MODELS.has(model)
  );
}

/**
 * Returns true when the message is a Branch-authored transcript artifact
 * that must not be replayed to providers.
 *
 * Primary check: provider="branch" + model in known transcript-only set.
 * Fallback: a valid branchDeliveryMirror marker catches observed historical
 * rows whose provider/model provenance was stripped (#99470).
 */
export function isTranscriptOnlyBranchAssistantMessage(message: unknown): boolean {
  const entry = asOptionalRecord(message);
  if (entry?.role !== "assistant") {
    return false;
  }
  if (isTranscriptOnlyBranchAssistantModel(entry.provider, entry.model)) {
    return true;
  }
  return isBranchDeliveryMirrorMarker(entry.branchDeliveryMirror);
}

export function isBranchMessageToolMirrorAssistantMessage(message: unknown): boolean {
  const entry = asOptionalRecord(message);
  return entry?.role === "assistant" && entry.branchMessageToolMirror !== undefined;
}

export function isBranchDeliveryMirrorAssistantMessage(message: unknown): boolean {
  const entry = asOptionalRecord(message);
  return (
    entry?.role === "assistant" &&
    entry.provider === BRANCH_TRANSCRIPT_ARTIFACT_PROVIDER &&
    entry.model === BRANCH_DELIVERY_MIRROR_MODEL
  );
}
