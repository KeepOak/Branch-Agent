// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/integration/api_compliance/run_compliance.py (atlas AGENT-LOOP-0094). Converted to strict TypeScript; uses the native OpenAI-compatible diagnostic transport.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { UnmatchedToolUseTest } from "./a01_unmatched_tool_use.js";
import { ParallelWrongOrderTest } from "./a08_parallel_wrong_order.js";
import { runSingleTest, type ComplianceModel, type Completion } from "./base.js";
import { reportCounts, type ComplianceReport } from "./result.js";
export const DEFAULT_MODELS: Record<string, ComplianceModel> = {
  "claude-sonnet-4-5": {
    model: "litellm_proxy/claude-sonnet-4-5-20250929",
    temperature: 0,
    _display: "claude",
  },
  "gpt-5.5": { model: "litellm_proxy/openai/gpt-5.5", _display: "gpt" },
  "gemini-3.1-pro": { model: "litellm_proxy/gemini-3.1-pro-preview", _display: "gemini" },
};
export const PATTERNS = [UnmatchedToolUseTest, ParallelWrongOrderTest];
export function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "_");
}
export async function runComplianceTests(
  options: {
    patterns?: string[];
    modelIds?: string[];
    create?: () => Completion;
    now?: Date;
  } = {},
): Promise<ComplianceReport> {
  const patterns = PATTERNS.filter(
    (p) => !options.patterns || options.patterns.includes(p.pattern_name),
  );
  if (!patterns.length) throw new Error("No compliance tests found!");
  const models = Object.entries(DEFAULT_MODELS).filter(
    ([id]) => !options.modelIds?.length || options.modelIds.includes(id),
  );
  if (!models.length)
    throw new Error(`No valid models found. Available: ${Object.keys(DEFAULT_MODELS).join(", ")}`);
  const start = performance.now();
  const now = options.now ?? new Date();
  const report: ComplianceReport = {
    test_run_id: `compliance_${timestamp(now)}`,
    timestamp: now.toISOString(),
    elapsed_time: 0,
    patterns_tested: patterns.length,
    models_tested: models.map(([id]) => id),
    results: [],
  };
  for (const pattern of patterns) {
    const results = [];
    for (const [id, model] of models)
      results.push(await runSingleTest(pattern, model, id, options.create));
    report.results.push({
      pattern_name: pattern.pattern_name,
      pattern_description: pattern.pattern_description,
      results,
    });
  }
  report.elapsed_time = (performance.now() - start) / 1000;
  return report;
}
export function generateMarkdownReport(report: ComplianceReport): string {
  const lines = [
    "# API Compliance Test Report",
    "",
    `**Run:** \`${report.test_run_id}\` | **Time:** ${report.timestamp} | **Duration:** ${report.elapsed_time.toFixed(1)}s`,
    "",
    "## Results Matrix",
    "",
    "✅ accepted  ❌ rejected  ⚠️ error",
    "",
    `| Pattern | ${report.models_tested.map((id) => DEFAULT_MODELS[id]?._display ?? id).join(" | ")} |`,
    `|:--------|${report.models_tested.map(() => ":---:").join("|")}|`,
  ];
  for (const pattern of report.results) {
    const file =
      pattern.pattern_name === "unmatched_tool_use"
        ? "a01_unmatched_tool_use.py"
        : "a08_parallel_wrong_order.py";
    const summary =
      pattern.pattern_name === "unmatched_tool_use"
        ? "tool_use without following tool_result"
        : "Parallel tool call results in wrong order";
    const cells = report.models_tested.map((id) => {
      const r = pattern.results.find((r) => r.model_id === id);
      return !r
        ? "-"
        : r.response_type === "accepted"
          ? "✅"
          : r.response_type === "rejected"
            ? "❌"
            : "⚠️";
    });
    lines.push(
      `| [\`${pattern.pattern_name}\`](https://github.com/OpenHands/software-agent-sdk/blob/main/tests/integration/tests/${file})<br><sub>${summary}</sub> | ${cells.join(" | ")} |`,
    );
  }
  const counts = reportCounts(report);
  lines.push(
    "",
    "## Summary",
    "",
    `- **Total tests:** ${counts.total_tests}`,
    `- **Rejected (expected for malformed input):** ${counts.total_rejected}`,
    `- **Accepted (lenient API behavior):** ${counts.total_accepted}`,
    "",
    "---",
    "",
    process.env.GITHUB_RUN_ID
      ? `*Full API responses available in [workflow artifacts](https://github.com/OpenHands/software-agent-sdk/actions/runs/${process.env.GITHUB_RUN_ID})*`
      : "*Full API responses available in \`compliance_report.json\`*",
  );
  return lines.join("\n");
}
export async function saveReport(report: ComplianceReport, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "compliance_report.json");
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(path.join(outputDir, "compliance_report.md"), generateMarkdownReport(report));
  return jsonPath;
}
