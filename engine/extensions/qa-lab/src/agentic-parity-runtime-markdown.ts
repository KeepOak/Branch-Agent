import {
  formatCacheMisses,
  formatRuntimeCacheCount,
  formatRuntimeCacheHitPercent,
} from "./agentic-parity-cache-usage.js";
import type { QaRuntimeParityReport } from "./agentic-parity-runtime-report-contract.js";
import { pushQaReportListSection } from "./report.js";
import type { RuntimeParityCacheDiagnostics } from "./runtime-parity-cache-diagnostics.js";
import { formatRuntimeSpeedComparison, formatRuntimeWallClockMs } from "./runtime-parity-timing.js";

function formatRuntimeCacheMisses(diagnostics: RuntimeParityCacheDiagnostics | undefined): string {
  if (!diagnostics) {
    return "N/A";
  }
  return formatCacheMisses(
    diagnostics.cacheTelemetryTurns === 0 ? null : diagnostics.cacheMisses,
    diagnostics.unmeasuredPostWarmTurns,
    "uncached input",
  );
}

export function renderQaRuntimeParityMarkdownReport(report: QaRuntimeParityReport): string {
  const lines = [
    `# Branch Agent Runtime Parity Report — ${report.runtimePair[0]} vs ${report.runtimePair[1]}`,
    "",
    `- Compared at: ${report.comparedAt}`,
    `- Provider mode: ${report.providerMode ?? "unknown"}`,
    `- Primary model: ${report.primaryModel ?? "unknown"}`,
    `- Verdict: ${report.pass ? "pass" : "fail"}`,
    "",
    "## Aggregate Metrics",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Total scenarios | ${report.totalScenarios} |`,
    `| Passed scenarios | ${report.passedScenarios} |`,
    `| Failed scenarios | ${report.failedScenarios} |`,
    `| No drift | ${report.driftCounts.none} |`,
    `| Text-only drift | ${report.driftCounts["text-only"]} |`,
    `| Tool-call-shape drift | ${report.driftCounts["tool-call-shape"]} |`,
    `| Tool-result-shape drift | ${report.driftCounts["tool-result-shape"]} |`,
    `| Structural drift | ${report.driftCounts.structural} |`,
    `| Failure-mode drift | ${report.driftCounts["failure-mode"]} |`,
    "",
    "## Prompt Cache",
    "",
    "| Runtime | Gross input | Uncached input | Cached input | Cache writes | Output | Total tokens | Cache hit |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| branch | ${formatRuntimeCacheCount(report.usage.branch?.grossInputTokens)} | ${formatRuntimeCacheCount(report.usage.branch?.uncachedInputTokens)} | ${formatRuntimeCacheCount(report.usage.branch?.cachedInputTokens)} | ${formatRuntimeCacheCount(report.usage.branch?.cacheWriteTokens)} | ${formatRuntimeCacheCount(report.usage.branch?.outputTokens)} | ${formatRuntimeCacheCount(report.usage.branch?.totalTokens)} | ${formatRuntimeCacheHitPercent(report.usage.branch?.cacheHitPercent)} |`,
    `| codex | ${formatRuntimeCacheCount(report.usage.codex?.grossInputTokens)} | ${formatRuntimeCacheCount(report.usage.codex?.uncachedInputTokens)} | ${formatRuntimeCacheCount(report.usage.codex?.cachedInputTokens)} | ${formatRuntimeCacheCount(report.usage.codex?.cacheWriteTokens)} | ${formatRuntimeCacheCount(report.usage.codex?.outputTokens)} | ${formatRuntimeCacheCount(report.usage.codex?.totalTokens)} | ${formatRuntimeCacheHitPercent(report.usage.codex?.cacheHitPercent)} |`,
    "",
    "## Runtime Timing",
    "",
    "| Runtime | Total wall time | p50 per scenario | p90 per scenario |",
    "| --- | ---: | ---: | ---: |",
    `| branch | ${formatRuntimeWallClockMs(report.timing.branch.totalWallClockMs)} | ${formatRuntimeWallClockMs(report.timing.branch.p50WallClockMs)} | ${formatRuntimeWallClockMs(report.timing.branch.p90WallClockMs)} |`,
    `| codex | ${formatRuntimeWallClockMs(report.timing.codex.totalWallClockMs)} | ${formatRuntimeWallClockMs(report.timing.codex.p50WallClockMs)} | ${formatRuntimeWallClockMs(report.timing.codex.p90WallClockMs)} |`,
    "",
    `- Faster runtime: ${formatRuntimeSpeedComparison(report.timing)}`,
    "",
  ];
  if (report.timing.bootstrap) {
    lines.push(
      "## Gateway Bootstrap (Excluded From Runtime Timing)",
      "",
      "| Runtime | Total bootstrap | p50 per scenario | p90 per scenario |",
      "| --- | ---: | ---: | ---: |",
      `| branch | ${formatRuntimeWallClockMs(report.timing.bootstrap.branch.totalWallClockMs)} | ${formatRuntimeWallClockMs(report.timing.bootstrap.branch.p50WallClockMs)} | ${formatRuntimeWallClockMs(report.timing.bootstrap.branch.p90WallClockMs)} |`,
      `| codex | ${formatRuntimeWallClockMs(report.timing.bootstrap.codex.totalWallClockMs)} | ${formatRuntimeWallClockMs(report.timing.bootstrap.codex.p50WallClockMs)} | ${formatRuntimeWallClockMs(report.timing.bootstrap.codex.p90WallClockMs)} |`,
      "",
    );
  }
  if (report.failures.length > 0) {
    pushQaReportListSection(lines, "Gate Failures", report.failures);
  }
  lines.push("## Scenario Comparison", "");
  for (const scenario of report.scenarios) {
    const usageNotApplicable = scenario.runtimeParityUsage.expectation === "not-applicable";
    const branchTokens = usageNotApplicable ? "N/A" : String(scenario.branchTokens);
    const codexTokens = usageNotApplicable ? "N/A" : String(scenario.codexTokens);
    lines.push(`### ${scenario.name}`, "");
    lines.push(`- status: ${scenario.status}`);
    lines.push(`- drift: ${scenario.drift}`);
    lines.push(
      `- branch: ${scenario.branchStatus} (${scenario.branchToolCalls} tool calls, ${branchTokens} tokens)`,
    );
    lines.push(
      `- codex: ${scenario.codexStatus} (${scenario.codexToolCalls} tool calls, ${codexTokens} tokens)`,
    );
    lines.push(
      `- wall time: branch ${formatRuntimeWallClockMs(scenario.branchWallClockMs)}; codex ${formatRuntimeWallClockMs(scenario.codexWallClockMs)}; ${formatRuntimeSpeedComparison(scenario)}`,
    );
    if (
      scenario.branchBootstrapWallClockMs !== undefined ||
      scenario.codexBootstrapWallClockMs !== undefined
    ) {
      lines.push(
        `- gateway bootstrap (excluded): branch ${formatRuntimeWallClockMs(scenario.branchBootstrapWallClockMs ?? null)}; codex ${formatRuntimeWallClockMs(scenario.codexBootstrapWallClockMs ?? null)}`,
      );
    }
    lines.push(
      `- prompt cache: branch ${formatRuntimeCacheHitPercent(scenario.branchUsage?.cacheHitPercent)} (${formatRuntimeCacheCount(scenario.branchUsage?.cachedInputTokens)} cached, ${formatRuntimeCacheCount(scenario.branchUsage?.uncachedInputTokens)} uncached input); codex ${formatRuntimeCacheHitPercent(scenario.codexUsage?.cacheHitPercent)} (${formatRuntimeCacheCount(scenario.codexUsage?.cachedInputTokens)} cached, ${formatRuntimeCacheCount(scenario.codexUsage?.uncachedInputTokens)} uncached input)`,
    );
    lines.push(
      `- post-warm cache misses: branch ${formatRuntimeCacheMisses(scenario.branchCacheDiagnostics)}; codex ${formatRuntimeCacheMisses(scenario.codexCacheDiagnostics)}`,
    );
    if (scenario.runtimeParityUsage.expectation === "not-applicable") {
      lines.push(`- assistant-message usage: N/A (${scenario.runtimeParityUsage.reason})`);
    }
    if (scenario.driftDetails) {
      lines.push(`- details: ${scenario.driftDetails}`);
    }
    lines.push("");
  }
  pushQaReportListSection(lines, "Notes", report.notes);
  return lines.join("\n");
}
