import type { QaRuntimeParityCacheUsage } from "./agentic-parity-cache-usage.js";
import type { RuntimeId } from "./runtime-id.js";
import type { RuntimeParityCacheDiagnostics } from "./runtime-parity-cache-diagnostics.js";
import type { QaRuntimeTiming } from "./runtime-parity-timing.js";
import type { RuntimeParityDrift, RuntimeParityUsagePolicy } from "./runtime-parity.js";

export type QaRuntimeParityScenarioReport = {
  name: string;
  status: "pass" | "fail";
  runtimeParityUsage: RuntimeParityUsagePolicy;
  drift: RuntimeParityDrift | "missing";
  driftDetails?: string;
  branchStatus: "pass" | "fail" | "skip" | "missing";
  codexStatus: "pass" | "fail" | "skip" | "missing";
  branchTokens: number;
  codexTokens: number;
  branchUsage: QaRuntimeParityCacheUsage | null;
  codexUsage: QaRuntimeParityCacheUsage | null;
  branchCacheDiagnostics?: RuntimeParityCacheDiagnostics;
  codexCacheDiagnostics?: RuntimeParityCacheDiagnostics;
  branchToolCalls: number;
  codexToolCalls: number;
  branchWallClockMs: number | null;
  codexWallClockMs: number | null;
  branchBootstrapWallClockMs?: number;
  codexBootstrapWallClockMs?: number;
  fasterRuntime: RuntimeId | "tie" | null;
  speedupPercent: number | null;
};

export type QaRuntimeParityReport = {
  runtimePair: [RuntimeId, RuntimeId];
  comparedAt: string;
  providerMode?: string;
  primaryModel?: string;
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  driftCounts: Record<RuntimeParityDrift, number>;
  scenarios: QaRuntimeParityScenarioReport[];
  timing: QaRuntimeTiming;
  usage: {
    branch: QaRuntimeParityCacheUsage | null;
    codex: QaRuntimeParityCacheUsage | null;
  };
  pass: boolean;
  failures: string[];
  notes: string[];
};
