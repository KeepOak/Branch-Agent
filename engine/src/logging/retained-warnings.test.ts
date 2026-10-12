import { afterEach, describe, expect, it } from "vitest";
import {
  readRetainedWarnings,
  resetRetainedWarningsForTests,
  retainWarning,
  RETAINED_WARNINGS_MAX_COUNT,
  RETAINED_WARNINGS_RESET_COUNT,
} from "./retained-warnings.js";

afterEach(resetRetainedWarningsForTests);

describe("retained warning reports", () => {
  it("retains warnings and fatal errors with source identity and timestamps", () => {
    retainWarning({ level: "info", message: "ordinary message" });
    retainWarning({
      level: "WARN",
      message: "startup warning",
      loggerName: "gateway",
      timestamp: 1,
    });
    retainWarning({ level: "FATAL", message: "runtime error", timestamp: 2 });
    expect(readRetainedWarnings()).toEqual({
      warningCount: 1,
      errorCount: 1,
      diagnostics: [
        { severity: "warning", message: "startup warning", source: "gateway", timestamp: 1 },
        { severity: "error", message: "runtime error", source: "branch", timestamp: 2 },
      ],
    });
  });

  it("ports the source collector's 200 to 50 hysteresis without a stricter cap", () => {
    for (let index = 0; index <= RETAINED_WARNINGS_MAX_COUNT; index += 1) {
      retainWarning({ level: "error", message: `diagnostic ${index}`, timestamp: index });
    }
    const report = readRetainedWarnings();
    expect(report.diagnostics).toHaveLength(RETAINED_WARNINGS_RESET_COUNT);
    expect(report.diagnostics[0]?.message).toBe("diagnostic 151");
    expect(report.diagnostics.at(-1)?.message).toBe("diagnostic 200");
    retainWarning({ level: "warn", message: "diagnostic 201" });
    expect(readRetainedWarnings().diagnostics).toHaveLength(51);
  });

  it("reports copied records and does not evict retained warnings when adding live plugin errors", () => {
    retainWarning({ level: "warn", message: "startup warning", timestamp: 1 });
    const report = readRetainedWarnings([
      { severity: "error", message: "activation failed", source: "plugin", timestamp: 2 },
    ]);
    expect(report.errorCount).toBe(1);
    report.diagnostics[0]!.message = "changed by reader";
    expect(readRetainedWarnings().diagnostics[0]?.message).toBe("startup warning");
    expect(readRetainedWarnings().diagnostics).toHaveLength(1);
  });
});
