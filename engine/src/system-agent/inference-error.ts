import { truncateUtf16Safe } from "@branch/normalization-core/utf16-slice";
import { formatErrorMessage } from "../infra/errors.js";

type SystemAgentInferenceStage = "agent-turn" | "planner" | "conversation";

/** Why a Branch Agent turn failed, in terms a person can act on. */
export type SystemAgentInferenceFailureReason = "agent-database-busy" | "inference-unavailable";
/** The one fix the chat surface should offer next to the plain sentence. */
export type SystemAgentInferenceFixAction = "retry" | "open-accounts";

const INFERENCE_UNAVAILABLE_MESSAGE =
  "Branch Agent could not reach working inference. Run `branch onboard` on the machine running Branch Agent to reconnect — it live-tests the route before saving it. Then try again.";
const INFERENCE_FAILURE_SUMMARY_MAX_CHARS = 300;

const USER_FACING: Record<
  SystemAgentInferenceFailureReason,
  { message: string; action: SystemAgentInferenceFixAction }
> = {
  "agent-database-busy": {
    message: "Branch is busy finishing other work. Try again in a moment.",
    action: "retry",
  },
  "inference-unavailable": {
    message: "Branch can't reach your AI account right now. Reconnect it in Accounts, then try again.",
    action: "open-accounts",
  },
};

// Local database contention (another agent or worker holds the shared file) is
// transient and unrelated to the AI account, so it must not send people to setup.
const AGENT_DATABASE_BUSY_PATTERNS = [
  /agent database .* is already open for agent/i,
  /\bSQLITE_BUSY\b/,
  /\bdatabase is locked\b/i,
  /\bSQLITE_READONLY_WORKER_BUSY\b/,
  /Branch is busy finishing other work/i,
];

function failureText(failure: unknown): string {
  const parts: string[] = [];
  let current: unknown = failure;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    parts.push(formatErrorMessage(current));
    if (current instanceof Error && "code" in current && typeof current.code === "string") {
      parts.push(current.code);
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join("\n");
}

export function classifySystemAgentInferenceFailure(
  failures: readonly unknown[],
): SystemAgentInferenceFailureReason {
  for (const failure of failures) {
    const text = failureText(failure);
    if (AGENT_DATABASE_BUSY_PATTERNS.some((pattern) => pattern.test(text))) {
      return "agent-database-busy";
    }
  }
  return "inference-unavailable";
}

function inferenceUnavailableMessage(failures: readonly unknown[]): string {
  const detail = failures.length > 0 ? formatErrorMessage(failures[0]).trim() : "";
  if (!detail) {
    return INFERENCE_UNAVAILABLE_MESSAGE;
  }
  const summary =
    detail.length > INFERENCE_FAILURE_SUMMARY_MAX_CHARS
      ? `${truncateUtf16Safe(detail, INFERENCE_FAILURE_SUMMARY_MAX_CHARS - 1)}…`
      : detail;
  return `${INFERENCE_UNAVAILABLE_MESSAGE} Cause: ${summary}`;
}

/**
 * Safe public error for a Branch Agent turn that could not complete with intelligence.
 * `message` keeps the operator detail for the CLI and logs; chat surfaces show
 * `userMessage` with `action` instead of raw internals.
 */
export class SystemAgentInferenceUnavailableError extends Error {
  readonly code = "SYSTEM_AGENT_INFERENCE_UNAVAILABLE";
  readonly reason: SystemAgentInferenceFailureReason;
  readonly userMessage: string;
  readonly action: SystemAgentInferenceFixAction;

  constructor(
    readonly stage: SystemAgentInferenceStage,
    readonly failures: readonly unknown[] = [],
  ) {
    super(inferenceUnavailableMessage(failures));
    this.name = "SystemAgentInferenceUnavailableError";
    this.reason = classifySystemAgentInferenceFailure(failures);
    this.userMessage = USER_FACING[this.reason].message;
    this.action = USER_FACING[this.reason].action;
  }
}

/** One plain sentence plus a fix action for chat; never the raw cause. */
export function describeSystemAgentInferenceFailureForChat(error: unknown): {
  message: string;
  reason: SystemAgentInferenceFailureReason;
  action: SystemAgentInferenceFixAction;
} {
  if (error instanceof SystemAgentInferenceUnavailableError) {
    return { message: error.userMessage, reason: error.reason, action: error.action };
  }
  const failures =
    error instanceof Error && "failures" in error && Array.isArray(error.failures)
      ? (error.failures as unknown[])
      : [error];
  const reason = classifySystemAgentInferenceFailure(failures);
  return { message: USER_FACING[reason].message, reason, action: USER_FACING[reason].action };
}

export function isSystemAgentInferenceUnavailableError(
  error: unknown,
): error is SystemAgentInferenceUnavailableError {
  return (
    error instanceof SystemAgentInferenceUnavailableError ||
    (error instanceof Error &&
      "code" in error &&
      error.code === "SYSTEM_AGENT_INFERENCE_UNAVAILABLE")
  );
}
