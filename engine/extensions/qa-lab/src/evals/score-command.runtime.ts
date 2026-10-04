// `branch qa score`: run scorers over stored Branch runs (trajectory bundles or session
// transcripts), gate on thresholds, and write a Markdown or JSON score report.
import fs from "node:fs/promises";
import path from "node:path";
import type { QaProviderModeInput } from "../model-selection.js";
import { normalizeQaProviderMode } from "../providers/index.js";
import { createQaScoreJudgeModel, type QaScoreJudgeRunner } from "./judge.js";
import { scoreStoredRunBatch, type ScoreTraceBatchResult } from "./score-traces.js";
import {
  parseQaScorerSpec,
  qaScorerNeedsJudge,
  resolveQaScorers,
  type QaResolvedScorer,
} from "./scorer-registry.js";
import { checkThresholdPassed, validateThresholdConfig, type ThresholdConfig } from "./thresholds.js";
import { loadStoredScorerRuns, type StoredScorerRun } from "./trajectory-run.js";

export type QaScoreCommandOptions = {
  repoRoot?: string;
  trajectory?: string[];
  scorer?: string[];
  threshold?: string[];
  judgeModel?: string;
  judgeProviderMode?: QaProviderModeInput;
  judgeTimeoutMs?: number;
  concurrency?: number;
  output?: string;
  json?: boolean;
  allowFailures?: boolean;
  /** Test seam: replaces the live judge lane. */
  runJudge?: QaScoreJudgeRunner;
  now?: () => Date;
};

export type QaScoreRowResult = ScoreTraceBatchResult & { gate?: "pass" | "fail" };

export type QaScoreScorerReport = {
  spec: string;
  scorerId: string;
  scorerName: string;
  threshold?: ThresholdConfig;
  results: QaScoreRowResult[];
  summary: {
    scored: number;
    notScorable: number;
    errored: number;
    meanScore: number | null;
    gateFailures: number;
  };
};

export type QaScoreReport = {
  generatedAt: string;
  targets: Array<Pick<StoredScorerRun, "sourcePath" | "source" | "sessionId" | "traceId">>;
  scorers: QaScoreScorerReport[];
  pass: boolean;
  failures: string[];
};

type ParsedThresholds = { all?: ThresholdConfig; byKey: Map<string, ThresholdConfig> };

function parseThresholdValue(raw: string, key: string): ThresholdConfig {
  const value = raw.trim();
  const range = /^([\d.]*)\.\.([\d.]*)$/u.exec(value);
  const toNumber = (text: string) => (text === "" ? undefined : Number(text));
  const threshold: ThresholdConfig = range
    ? {
        ...(toNumber(range[1] ?? "") !== undefined ? { min: toNumber(range[1] ?? "") } : {}),
        ...(toNumber(range[2] ?? "") !== undefined ? { max: toNumber(range[2] ?? "") } : {}),
      }
    : Number(value === "" ? Number.NaN : value);
  validateThresholdConfig(threshold, key);
  return threshold;
}

/** `--threshold 0.8` (all scorers), `--threshold <scorer>=0.8`, or `<scorer>=0.2..0.9`. */
export function parseQaScoreThresholds(entries: readonly string[]): ParsedThresholds {
  const parsed: ParsedThresholds = { byKey: new Map() };
  for (const entry of entries) {
    const separator = entry.lastIndexOf("=");
    if (separator === -1) {
      parsed.all = parseThresholdValue(entry, "all");
      continue;
    }
    const key = entry.slice(0, separator).trim();
    parsed.byKey.set(key, parseThresholdValue(entry.slice(separator + 1), key));
  }
  return parsed;
}

function thresholdFor(scorer: QaResolvedScorer, thresholds: ParsedThresholds) {
  return (
    thresholds.byKey.get(scorer.spec) ??
    thresholds.byKey.get(scorer.name) ??
    thresholds.byKey.get(scorer.scorer.id) ??
    thresholds.all
  );
}

function summarize(results: readonly QaScoreRowResult[]): QaScoreScorerReport["summary"] {
  const scores = results.flatMap((row) => (row.ok && "score" in row ? [row.score.score] : []));
  return {
    scored: scores.length,
    notScorable: results.filter((row) => row.ok && "notScorable" in row).length,
    errored: results.filter((row) => !row.ok).length,
    meanScore: scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
    gateFailures: results.filter((row) => row.gate === "fail").length,
  };
}

function applyGate(row: ScoreTraceBatchResult, threshold: ThresholdConfig | undefined): QaScoreRowResult {
  if (threshold === undefined) {
    return row;
  }
  if (!row.ok) {
    return { ...row, gate: "fail" };
  }
  // Not-scorable runs carry no score and stay out of the gate.
  if ("notScorable" in row) {
    return row;
  }
  return { ...row, gate: checkThresholdPassed(row.score.score, threshold) ? "pass" : "fail" };
}

function formatThreshold(threshold: ThresholdConfig | undefined): string {
  if (threshold === undefined) {
    return "none";
  }
  if (typeof threshold === "number") {
    return `>= ${threshold}`;
  }
  return [threshold.min !== undefined ? `>= ${threshold.min}` : "", threshold.max !== undefined ? `<= ${threshold.max}` : ""]
    .filter(Boolean)
    .join(" and ");
}

function describeRow(row: QaScoreRowResult): string {
  if (!row.ok) {
    return `error${row.failedStep ? ` in ${row.failedStep}` : ""}: ${row.error}`;
  }
  if ("notScorable" in row) {
    return `not scorable${row.notScorable.reason ? `: ${row.notScorable.reason}` : ""}`;
  }
  const reason = row.score.reason ? ` - ${row.score.reason.replace(/\s+/gu, " ").slice(0, 160)}` : "";
  return `${Number(row.score.score.toFixed(4))}${reason}`;
}

export function renderQaScoreMarkdownReport(report: QaScoreReport): string {
  const lines = [
    "# Branch QA Score Report",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Runs: ${report.targets.length}`,
    `- Verdict: ${report.pass ? "pass" : "fail"}`,
    "",
    "| Scorer | Threshold | Scored | Mean | Not scorable | Errors | Gate failures |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const scorer of report.scorers) {
    const { summary } = scorer;
    const mean = summary.meanScore === null ? "-" : summary.meanScore.toFixed(3);
    lines.push(
      `| ${scorer.spec} | ${formatThreshold(scorer.threshold)} | ${summary.scored} | ${mean} | ${summary.notScorable} | ${summary.errored} | ${summary.gateFailures} |`,
    );
  }
  for (const scorer of report.scorers) {
    lines.push("", `## ${scorer.spec}`, "");
    for (const row of scorer.results) {
      const gate = row.gate ? ` [${row.gate}]` : "";
      lines.push(`- ${row.sourcePath}: ${describeRow(row)}${gate}`);
    }
  }
  if (report.failures.length > 0) {
    lines.push("", "## Failures", "", ...report.failures.map((failure) => `- ${failure}`));
  }
  return `${lines.join("\n")}\n`;
}

/** Scores the stored runs and returns the report (no printing, no exit code). */
export async function buildQaScoreReport(opts: QaScoreCommandOptions): Promise<QaScoreReport> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const targets = (opts.trajectory ?? []).map((entry) => path.resolve(repoRoot, entry));
  const specs = opts.scorer ?? [];
  if (targets.length === 0) {
    throw new Error("--trajectory must name at least one trajectory bundle or session transcript.");
  }
  if (specs.length === 0) {
    throw new Error("--scorer must name at least one scorer.");
  }
  const thresholds = parseQaScoreThresholds(opts.threshold ?? []);
  const needsJudge = specs.some((spec) => qaScorerNeedsJudge(parseQaScorerSpec(spec)));
  const judge =
    needsJudge && opts.judgeModel?.trim()
      ? createQaScoreJudgeModel({
          repoRoot,
          judgeModel: opts.judgeModel.trim(),
          ...(opts.judgeProviderMode
            ? { providerMode: normalizeQaProviderMode(opts.judgeProviderMode) }
            : {}),
          ...(opts.judgeTimeoutMs !== undefined ? { timeoutMs: opts.judgeTimeoutMs } : {}),
          ...(opts.runJudge ? { runJudge: opts.runJudge } : {}),
        })
      : undefined;
  const scorers = resolveQaScorers(specs, judge ? { judge } : {});
  const runs = await loadStoredScorerRuns(targets);
  if (runs.length === 0) {
    throw new Error(`No stored runs found in ${targets.join(", ")}.`);
  }
  const scorerReports: QaScoreScorerReport[] = [];
  for (const scorer of scorers) {
    const threshold = thresholdFor(scorer, thresholds);
    const batch = await scoreStoredRunBatch({
      scorer: scorer.scorer,
      targets: runs,
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
    const results = batch.map((row) => applyGate(row, threshold));
    scorerReports.push({
      spec: scorer.spec,
      scorerId: scorer.scorer.id,
      scorerName: scorer.scorer.name,
      ...(threshold !== undefined ? { threshold } : {}),
      results,
      summary: summarize(results),
    });
  }
  const failures = scorerReports.flatMap((scorer) =>
    scorer.results
      .filter((row) => row.gate === "fail")
      .map((row) => `${scorer.spec} on ${row.sourcePath}: ${describeRow(row)} (threshold ${formatThreshold(scorer.threshold)})`),
  );
  return {
    generatedAt: (opts.now?.() ?? new Date()).toISOString(),
    targets: runs.map(({ sourcePath, source, sessionId, traceId }) => ({
      sourcePath,
      source,
      ...(sessionId ? { sessionId } : {}),
      ...(traceId ? { traceId } : {}),
    })),
    scorers: scorerReports,
    pass: failures.length === 0,
    failures,
  };
}

export async function runQaScoreCommand(opts: QaScoreCommandOptions): Promise<QaScoreReport> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const report = await buildQaScoreReport(opts);
  const body = opts.json ? `${JSON.stringify(report, null, 2)}\n` : renderQaScoreMarkdownReport(report);
  if (!report.pass && opts.allowFailures !== true) {
    process.exitCode = 1;
  }
  if (opts.output) {
    const outputPath = path.resolve(repoRoot, opts.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, body, "utf8");
    process.stdout.write(`QA score report: ${outputPath}\n`);
    return report;
  }
  process.stdout.write(body);
  return report;
}
