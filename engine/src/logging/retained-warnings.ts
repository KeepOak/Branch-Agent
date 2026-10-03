/** Retained diagnostics, adapted from letta-code's mod-diagnostics collector. */
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
export const RETAINED_WARNINGS_MAX_COUNT = 200;
export const RETAINED_WARNINGS_RESET_COUNT = 50;

export type RetainedWarning = {
  severity: "warning" | "error";
  message: string;
  source: string;
  timestamp: number;
  stack?: string;
};

export type RetainedWarningsReport = {
  diagnostics: RetainedWarning[];
  warningCount: number;
  errorCount: number;
};

// Match the logger's process singleton across runtime module reloads.
const diagnostics = resolveGlobalSingleton<RetainedWarning[]>(
  Symbol.for("branch.retainedWarnings"),
  () => [],
);

export function retainedWarningSeverity(level: string): RetainedWarning["severity"] | undefined {
  switch (level.toLowerCase()) {
    case "warn":
    case "warning":
      return "warning";
    case "error":
    case "fatal":
      return "error";
    default:
      return undefined;
  }
}

/** The logger supplies already redacted text, before diagnostics interest filtering. */
export function retainWarning(input: {
  level: string;
  message: string;
  loggerName?: string;
  timestamp?: number;
  stack?: string;
}): void {
  const severity = retainedWarningSeverity(input.level);
  if (!severity) {
    return;
  }
  diagnostics.push({
    severity,
    message: input.message,
    source: input.loggerName ?? "branch",
    timestamp: input.timestamp ?? Date.now(),
    ...(input.stack ? { stack: input.stack } : {}),
  });
  if (diagnostics.length > RETAINED_WARNINGS_MAX_COUNT) {
    diagnostics.splice(0, diagnostics.length - RETAINED_WARNINGS_RESET_COUNT);
  }
}

export function readRetainedWarnings(
  extra: readonly RetainedWarning[] = [],
): RetainedWarningsReport {
  const entries = [...diagnostics, ...extra].map((entry) => ({ ...entry }));
  return {
    diagnostics: entries,
    warningCount: entries.filter((entry) => entry.severity === "warning").length,
    errorCount: entries.filter((entry) => entry.severity === "error").length,
  };
}

export function resetRetainedWarningsForTests(): void {
  diagnostics.length = 0;
}
