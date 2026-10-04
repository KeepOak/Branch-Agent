import type { ModelChoice } from "./model";
import type { AvailabilityReason } from "./model-capabilities";
import "./model-access-info.css";

const RUNTIME_NAMES: Record<string, string> = { branch: "Branch", codex: "Codex", "claude-cli": "Claude Code" };
const REASONS: Record<AvailabilityReason, string> = {
  "missing-auth": "Sign-in needed.",
  "auth-failed": "Sign-in needs attention.",
  cooldown: "Resting after a limit.",
  "unsupported-runtime": "This runtime does not support the model.",
};

/** Public metadata only: this line does not authenticate, probe or change a runtime. */
export function ModelAccessInfo({ model }: { model: ModelChoice | undefined }) {
  const metadata = model?.runtimeMetadata;
  if (!metadata) return null;
  const id = metadata.agentRuntime?.id;
  const runtime = id ? `Runs through ${RUNTIME_NAMES[id] ?? id}.` : "";
  const availability = metadata.available === false
    ? metadata.unavailableReason ? REASONS[metadata.unavailableReason] : "This runtime is unavailable."
    : metadata.available === undefined ? "Availability not reported." : "";
  const retry = metadata.available === false && metadata.unavailableReason === "cooldown" && metadata.unavailableUntil !== undefined
    ? new Date(metadata.unavailableUntil) : undefined;
  const validRetry = retry && Number.isFinite(retry.getTime()) ? retry : undefined;
  if (!runtime && !availability) return null;
  return (
    <p className="c-pp c-model-access-info" role="status">
      {[runtime, availability].filter(Boolean).join(" ")}
      {validRetry ? <> Retry time: <time dateTime={validRetry.toISOString()}>{validRetry.toLocaleString()}</time>.</> : null}
    </p>
  );
}
