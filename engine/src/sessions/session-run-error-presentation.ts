import {
  PreparedModelRuntimePluginGenerationRetiredError,
  PreparedModelRuntimePublicationSupersededError,
} from "../agents/prepared-model-runtime.errors.js";
import { isSqliteLockError } from "../infra/sqlite-error-diagnostics.js";

export const STATE_CONTENTION_SUMMARY =
  "Your request was interrupted while the server was busy. Check its status before trying again.";

export const RUNTIME_RACE_SUMMARY =
  "This Trunk was still getting ready and couldn't start your request; please send it again.";

// Internal preparation races that survived every rejoin. Their text names files and internals.
// The retirement forms are the messages prepared-model-runtime.plugin-lifetime.ts emits.
const RUNTIME_RACE_FAILURES = [
  /prepared model runtime (?:publication|plugin generation) was superseded/i,
  /prepared model runtime lease admission made no publication progress/i,
  /Worker placement inventory changed/i,
  /Prepared plugin (?:generation|registry) has retired/i,
  /Prepared plugin generation retired before publication/i,
  /Prepared model runtime plugin generation retired/i,
];

/** Matches the text form too: run outcomes cross process and storage boundaries as strings. */
export function isRuntimeRaceFailure(error: unknown): boolean {
  if (
    error instanceof PreparedModelRuntimePluginGenerationRetiredError ||
    error instanceof PreparedModelRuntimePublicationSupersededError
  ) {
    return true;
  }
  const text = error instanceof Error ? error.message : String(error);
  return RUNTIME_RACE_FAILURES.some((pattern) => pattern.test(text));
}

export const STATE_CONTENTION_DIAGNOSTIC =
  "SQLite transaction admission remained busy. Execution may have occurred; check the recorded outcome before resending.";

/** Presentation is not replay authority. Only the direct typed failure is classified. */
export function resolveStateContentionPresentation(error: unknown) {
  return isSqliteLockError(error)
    ? {
        errorKind: "state_contention" as const,
        errorMessage: `${STATE_CONTENTION_SUMMARY}\n\n${STATE_CONTENTION_DIAGNOSTIC}`,
      }
    : undefined;
}
