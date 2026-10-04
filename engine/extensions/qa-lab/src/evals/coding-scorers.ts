// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421 mastracode/sdk/src/evals/scorers/
// classify-command.ts, extract-tools.ts, outcome.ts and efficiency.ts. Tool names map to Branch's
// coding tools (exec/bash, read, edit, grep, find, ask_user) instead of MastraCode's.
import { createScorer } from "./scorer.js";
import type {
  AgentScorerRun,
  EvalMessage,
  EvalToolInvocation,
  ScorerRunOutputForAgent,
} from "./scorer-utils.js";

/** Branch tool names the coding scorers classify (MastraCode names in comments). */
export const BRANCH_CODING_TOOLS = {
  /** execute_command */
  commandTools: ["exec", "bash"],
  /** ask_user */
  askUserTools: ["ask_user"],
  /** search_content, find_files, lsp_inspect: errors here are expected. */
  benignErrorTools: ["grep", "find"],
  /** string_replace_lsp, ast_smart_edit: targeted edits that should follow a read. */
  editTools: ["edit"],
  /** view: the only tool that reads one specific file. */
  readTools: ["read"],
  /** Idempotent reads whose repeats are intentional. */
  redundancyWhitelist: ["read", "grep", "find", "web_search", "web_fetch"],
} as const;

const includesName = (names: readonly string[], name: string) => names.includes(name);

// ─── classify-command ─────────────────────────────────────────────────────────

/** True for build/typecheck commands, checking each segment of compound commands. */
export function isBuildCommand(command: string): boolean {
  const segments = command.split(/\s*(?:&&|\|\||;)\s*/);
  return segments.some((segment) => {
    const trimmed = segment.trim();
    if (!/\b(tsc|typecheck|type-check|build)\b/.test(trimmed)) {
      return false;
    }
    // Only reject when a test runner is the primary verb of this segment.
    const primaryVerb =
      trimmed.replace(/^(?:pnpm|npm|yarn|npx|bunx?|turbo)\s+(?:run\s+)?/, "").split(/\s/)[0] ?? "";
    return !/^(test|vitest|jest|mocha|pytest)$/.test(primaryVerb);
  });
}

export function isTestCommand(command: string): boolean {
  return /\b(test|vitest|jest|mocha|pytest|spec)\b/.test(command);
}

/** Exit code from a command result; trusts only explicit exitCode/code fields or "exit code N". */
export function getExitCode(result: unknown): number | null {
  if (result === null || result === undefined) {
    return null;
  }
  if (typeof result === "string") {
    const exitMatch = result.match(/exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?(\d+)/i);
    return exitMatch ? Number.parseInt(exitMatch[1] ?? "", 10) : null;
  }
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj.exitCode === "number") {
      return obj.exitCode;
    }
    if (typeof obj.code === "number") {
      return obj.code;
    }
  }
  return null;
}

/** True when a tool result shows exit code 0 and no error. */
export function isSuccessResult(result: unknown, error?: unknown): boolean {
  if (error || !result) {
    return false;
  }
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    const exitCode = (obj.exitCode as number | undefined) ?? (obj.code as number | undefined);
    if (typeof exitCode === "number") {
      return exitCode === 0;
    }
  }
  if (typeof result === "string") {
    const exitMatch = result.match(/exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?(\d+)/i);
    if (exitMatch) {
      return exitMatch[1] === "0";
    }
  }
  return false;
}

/** Exact or suffix path match ("src/foo.ts" matches "/abs/src/foo.ts"). */
export function matchFilePath(actual: string, expected: string): boolean {
  if (actual === expected) {
    return true;
  }
  return actual.endsWith(`/${expected}`) || expected.endsWith(`/${actual}`);
}

// ─── extract-tools ────────────────────────────────────────────────────────────

export type ExtractedToolCall = {
  toolCallId?: string;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean;
  index: number;
};

const COMPLETED_STATES = new Set(["result", "error", "output-error", "output-denied"]);
const ERROR_STATES = new Set(["error", "output-error", "output-denied"]);

/** Branch keeps the exec exit code in the result details; prefer it over the text. */
function resolveResult(invocation: EvalToolInvocation): unknown {
  const details = invocation.details as { exitCode?: unknown } | null | undefined;
  if (details && typeof details === "object" && typeof details.exitCode === "number") {
    return details;
  }
  return invocation.result ?? null;
}

/** Completed tool calls from parts first, then legacy toolInvocations not already seen. */
export function extractCodingToolCalls(messages: readonly EvalMessage[]): ExtractedToolCall[] {
  const results: ExtractedToolCall[] = [];
  const seenToolCallIds = new Set<string>();
  let index = 0;
  for (const message of messages) {
    if (!message.content) {
      continue;
    }
    for (const part of message.content.parts ?? []) {
      if (part.type !== "tool-invocation" || !COMPLETED_STATES.has(part.toolInvocation.state)) {
        continue;
      }
      const invocation = part.toolInvocation;
      if (invocation.toolCallId) {
        seenToolCallIds.add(invocation.toolCallId);
      }
      results.push({
        toolCallId: invocation.toolCallId,
        toolName: invocation.toolName ?? "",
        args: invocation.args ?? {},
        result: resolveResult(invocation),
        isError: ERROR_STATES.has(invocation.state) || invocation.isError === true,
        index: index++,
      });
    }
    for (const invocation of message.content.toolInvocations ?? []) {
      if (invocation.state !== "result") {
        continue;
      }
      if (invocation.toolCallId && seenToolCallIds.has(invocation.toolCallId)) {
        continue;
      }
      if (invocation.toolCallId) {
        seenToolCallIds.add(invocation.toolCallId);
      }
      results.push({
        toolCallId: invocation.toolCallId,
        toolName: invocation.toolName ?? "",
        args: invocation.args ?? {},
        result: resolveResult(invocation),
        isError: false,
        index: index++,
      });
    }
  }
  return results;
}

// ─── outcome ──────────────────────────────────────────────────────────────────

const OUTCOME_WEIGHTS = {
  build: 0.3,
  tests: 0.25,
  toolErrors: 0.2,
  loops: 0.1,
  regression: 0.1,
  autonomy: 0.05,
} as const;

const OUTCOME_THRESHOLDS = {
  toolErrorPenaltyMultiplier: 1.0,
  loopMinRepetitions: 3,
  loopPenaltyPerOccurrence: 0.3,
  autonomyPenaltyPerAsk: 0.25,
  ambiguousExitScore: 0.75,
  minToolCalls: 1,
} as const;

type DimensionResult = { score: number; detail: string; applicable: boolean };

const commandOf = (call: ExtractedToolCall) => String(call.args.command ?? "");
const isCommandCall = (call: ExtractedToolCall) =>
  includesName(BRANCH_CODING_TOOLS.commandTools, call.toolName);
const isBuildCall = (call: ExtractedToolCall) => isBuildCommand(commandOf(call));
const isTestCall = (call: ExtractedToolCall) => isTestCommand(commandOf(call));
const resultText = (result: unknown) =>
  typeof result === "string" ? result : JSON.stringify(result ?? "");

function scoreBuild(execResults: ExtractedToolCall[]): DimensionResult {
  const builds = execResults.filter(isBuildCall);
  if (builds.length === 0) {
    return { score: 0, detail: "No build/typecheck ran", applicable: false };
  }
  const last = builds[builds.length - 1];
  if (!last || last.isError) {
    return { score: 0, detail: "Build/typecheck tool errored", applicable: true };
  }
  const exitCode = getExitCode(last.result);
  if (exitCode === 0) {
    return { score: 1, detail: "Build/typecheck passed", applicable: true };
  }
  if (exitCode !== null) {
    return { score: 0, detail: `Build failed (exit ${exitCode})`, applicable: true };
  }
  if (/error TS\d+|Cannot find module|is not assignable/i.test(resultText(last.result))) {
    return { score: 0, detail: "Build failed (TypeScript errors in output)", applicable: true };
  }
  return {
    score: OUTCOME_THRESHOLDS.ambiguousExitScore,
    detail: "Build ran, outcome unclear",
    applicable: true,
  };
}

function scoreTests(execResults: ExtractedToolCall[]): DimensionResult {
  const tests = execResults.filter(isTestCall);
  if (tests.length === 0) {
    return { score: 0, detail: "No tests ran", applicable: false };
  }
  const last = tests[tests.length - 1];
  if (!last || last.isError) {
    return { score: 0, detail: "Test command errored", applicable: true };
  }
  const exitCode = getExitCode(last.result);
  if (exitCode === 0) {
    return { score: 1, detail: "Tests passed", applicable: true };
  }
  if (exitCode !== null) {
    return { score: 0, detail: `Tests failed (exit ${exitCode})`, applicable: true };
  }
  const text = resultText(last.result);
  if (/\d+ (?:tests? )?passed|✓|PASS/i.test(text) && !/\bfail(?:ed|ure)?\b|\berror\b/i.test(text)) {
    return { score: 1, detail: "Tests passed (inferred)", applicable: true };
  }
  if (/\bFAIL\b|failed|✗|✘/i.test(text)) {
    return { score: 0, detail: "Tests failed (inferred)", applicable: true };
  }
  return {
    score: OUTCOME_THRESHOLDS.ambiguousExitScore,
    detail: "Tests ran, outcome unclear",
    applicable: true,
  };
}

function scoreToolErrors(results: ExtractedToolCall[]): DimensionResult {
  if (results.length === 0) {
    return { score: 1, detail: "No tool calls", applicable: false };
  }
  const nonBenign = results.filter(
    (call) => !includesName(BRANCH_CODING_TOOLS.benignErrorTools, call.toolName),
  );
  if (nonBenign.length === 0) {
    return { score: 1, detail: "All tool calls are benign-error tools", applicable: true };
  }
  const errors = nonBenign.filter((call) => call.isError);
  const rate = errors.length / nonBenign.length;
  if (rate === 0) {
    return { score: 1, detail: "No tool errors", applicable: true };
  }
  return {
    score: Math.max(0, 1 - rate * OUTCOME_THRESHOLDS.toolErrorPenaltyMultiplier),
    detail: `${errors.length}/${nonBenign.length} tools errored (${(rate * 100).toFixed(0)}%)`,
    applicable: true,
  };
}

const fingerprint = (call: ExtractedToolCall) => `${call.toolName}:${JSON.stringify(call.args)}`;

function scoreStuckLoops(results: ExtractedToolCall[]): DimensionResult {
  if (results.length < 3) {
    return { score: 1, detail: "Too few calls for loop detection", applicable: true };
  }
  let maxConsecutive = 1;
  let currentRun = 1;
  for (let i = 1; i < results.length; i += 1) {
    const current = results[i];
    const previous = results[i - 1];
    if (current && previous && fingerprint(current) === fingerprint(previous)) {
      currentRun += 1;
      maxConsecutive = Math.max(maxConsecutive, currentRun);
    } else {
      currentRun = 1;
    }
  }
  const errorCounts = new Map<string, number>();
  for (const call of results) {
    if (call.isError) {
      errorCounts.set(fingerprint(call), (errorCounts.get(fingerprint(call)) ?? 0) + 1);
    }
  }
  const maxErrorRepeat = Math.max(0, ...errorCounts.values());
  const minReps = OUTCOME_THRESHOLDS.loopMinRepetitions;
  const loopSeverity = Math.max(
    maxConsecutive >= minReps ? maxConsecutive - (minReps - 1) : 0,
    maxErrorRepeat >= minReps ? maxErrorRepeat - (minReps - 1) : 0,
  );
  if (loopSeverity === 0) {
    return { score: 1, detail: "No stuck loops", applicable: true };
  }
  const details: string[] = [];
  if (maxConsecutive >= minReps) {
    details.push(`${maxConsecutive} consecutive identical calls`);
  }
  if (maxErrorRepeat >= minReps) {
    details.push(`same error repeated ${maxErrorRepeat}x`);
  }
  return {
    score: Math.max(0, 1 - loopSeverity * OUTCOME_THRESHOLDS.loopPenaltyPerOccurrence),
    detail: details.join("; "),
    applicable: true,
  };
}

function scoreRegression(execResults: ExtractedToolCall[]): DimensionResult {
  const regressions: Array<{ label: string; recovered: boolean }> = [];
  const kinds: Array<[string, (call: ExtractedToolCall) => boolean]> = [
    ["Build", isBuildCall],
    ["Tests", isTestCall],
  ];
  for (const [label, filter] of kinds) {
    const commands = execResults.filter(filter);
    if (commands.length < 2) {
      continue;
    }
    let sawPass = false;
    let sawRegression = false;
    for (const command of commands) {
      const exit = getExitCode(command.result);
      if (exit === 0) {
        if (sawRegression) {
          regressions.push({ label, recovered: true });
          sawRegression = false;
        }
        sawPass = true;
      }
      if (sawPass && exit !== null && exit !== 0) {
        sawRegression = true;
      }
    }
    if (sawRegression) {
      regressions.push({ label, recovered: false });
    }
  }
  if (regressions.length === 0) {
    return { score: 1, detail: "No regressions", applicable: true };
  }
  const persistent = regressions.filter((entry) => !entry.recovered).length;
  const recovered = regressions.filter((entry) => entry.recovered).length;
  return {
    score: Math.max(0, 1 - persistent * 0.5 - recovered * 0.1),
    detail: regressions
      .map((entry) => `${entry.label} ${entry.recovered ? "regressed then recovered" : "regressed (persisted)"}`)
      .join("; "),
    applicable: true,
  };
}

function scoreAutonomy(results: ExtractedToolCall[]): DimensionResult {
  const count = results.filter((call) =>
    includesName(BRANCH_CODING_TOOLS.askUserTools, call.toolName),
  ).length;
  if (count === 0) {
    return { score: 1, detail: "No ask_user calls (fully autonomous)", applicable: true };
  }
  return {
    score: Math.max(0, 1 - count * OUTCOME_THRESHOLDS.autonomyPenaltyPerAsk),
    detail: `${count} ask_user call${count > 1 ? "s" : ""}`,
    applicable: true,
  };
}

function weightedAverage(
  dimensions: Record<keyof typeof OUTCOME_WEIGHTS, DimensionResult>,
): number | null {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const key of Object.keys(OUTCOME_WEIGHTS) as Array<keyof typeof OUTCOME_WEIGHTS>) {
    const result = dimensions[key];
    if (!result.applicable) {
      continue;
    }
    totalWeight += OUTCOME_WEIGHTS[key];
    weightedSum += result.score * OUTCOME_WEIGHTS[key];
  }
  return totalWeight === 0 ? null : weightedSum / totalWeight;
}

type OutcomeDimensions = Record<keyof typeof OUTCOME_WEIGHTS, DimensionResult>;

/** Grades a coding session's outcome: build/tests, tool errors, loops, regressions, autonomy. */
export function createCodingOutcomeScorer() {
  return createScorer<AgentScorerRun["input"], ScorerRunOutputForAgent>({
    id: "coding-outcome",
    name: "Coding Outcome",
    description:
      "Grades coding session outcomes: build/test pass, tool errors, stuck loops, regressions, autonomy.",
  })
    .preprocess(({ run }) => {
      const allResults = extractCodingToolCalls(run.output ?? []);
      const totalCalls = allResults.length;
      if (totalCalls < OUTCOME_THRESHOLDS.minToolCalls) {
        const empty: DimensionResult = { score: 0, detail: "No tool calls", applicable: false };
        const dimensions: OutcomeDimensions = {
          build: empty,
          tests: empty,
          toolErrors: empty,
          loops: empty,
          regression: empty,
          autonomy: empty,
        };
        return { empty: true, ...dimensions, totalCalls };
      }
      const execResults = allResults.filter(isCommandCall);
      const dimensions: OutcomeDimensions = {
        build: scoreBuild(execResults),
        tests: scoreTests(execResults),
        toolErrors: scoreToolErrors(allResults),
        loops: scoreStuckLoops(allResults),
        regression: scoreRegression(execResults),
        autonomy: scoreAutonomy(allResults),
      };
      return { empty: false, ...dimensions, totalCalls };
    })
    .generateScore(({ results }) => {
      const p = results.preprocessStepResult;
      if (p.empty) {
        return 0;
      }
      const score = weightedAverage(p);
      return score === null ? 0 : Math.round(score * 100) / 100;
    })
    .generateReason(({ results, score }) => {
      const p = results.preprocessStepResult;
      if (p.empty) {
        return `Score: 0 (${p.totalCalls} tool calls — below minimum threshold for scoring)`;
      }
      const pct = (weight: number) => `${(weight * 100).toFixed(0)}%`;
      const line = (name: string, weight: number, result: DimensionResult) =>
        result.applicable
          ? `${name} (${pct(weight)}): ${result.detail} [${result.score}]`
          : `${name}: ${result.detail} [N/A — excluded from average]`;
      return [
        `Score: ${score} (${p.totalCalls} tool calls total)`,
        line("Build", OUTCOME_WEIGHTS.build, p.build),
        line("Tests", OUTCOME_WEIGHTS.tests, p.tests),
        line("Tool errors", OUTCOME_WEIGHTS.toolErrors, p.toolErrors),
        line("Loops", OUTCOME_WEIGHTS.loops, p.loops),
        line("Regression", OUTCOME_WEIGHTS.regression, p.regression),
        line("Autonomy", OUTCOME_WEIGHTS.autonomy, p.autonomy),
      ].join("\n");
    });
}

// ─── efficiency ───────────────────────────────────────────────────────────────

const EFFICIENCY_WEIGHTS = {
  redundancy: 0.35,
  turnCount: 0.3,
  retryEfficiency: 0.2,
  readBeforeEdit: 0.15,
} as const;

const EFFICIENCY_THRESHOLDS = {
  redundancyAcceptableRate: 0.05,
  redundancyPenaltyMultiplier: 3,
  turnCountNormalMax: 8,
  turnCountPenaltyPerTurn: 0.04,
  turnCountExtendedPenaltyPerTurn: 0.03,
  retryExcessiveThreshold: 3,
  minToolCalls: 2,
} as const;

const pathOf = (call: ExtractedToolCall) => String(call.args.path ?? call.args.file_path ?? "");

function scoreRedundancy(calls: ExtractedToolCall[]) {
  if (calls.length < 2) {
    return { score: 1, ratio: 0, detail: "Too few calls" };
  }
  const mutationCalls = calls.filter(
    (call) => !includesName(BRANCH_CODING_TOOLS.redundancyWhitelist, call.toolName),
  );
  if (mutationCalls.length < 2) {
    return { score: 1, ratio: 0, detail: "No mutation tools to check" };
  }
  const successCounts = new Map<string, number>();
  for (const call of mutationCalls) {
    if (!call.isError) {
      successCounts.set(fingerprint(call), (successCounts.get(fingerprint(call)) ?? 0) + 1);
    }
  }
  let redundantCount = 0;
  for (const successCount of successCounts.values()) {
    if (successCount > 1) {
      redundantCount += successCount - 1;
    }
  }
  const ratio = redundantCount / mutationCalls.length;
  const acceptable = EFFICIENCY_THRESHOLDS.redundancyAcceptableRate;
  const score =
    ratio <= acceptable
      ? 1
      : Math.max(0, 1 - (ratio - acceptable) * EFFICIENCY_THRESHOLDS.redundancyPenaltyMultiplier);
  return {
    score,
    ratio,
    detail: `${redundantCount}/${mutationCalls.length} redundant mutations (${(ratio * 100).toFixed(0)}%)`,
  };
}

function scoreTurnCount(turns: number) {
  const { turnCountNormalMax: normalMax, turnCountPenaltyPerTurn: perTurn } = EFFICIENCY_THRESHOLDS;
  if (turns <= 1) {
    return { score: 1, detail: `${turns} turn` };
  }
  if (turns <= normalMax) {
    return { score: 1, detail: `${turns} turns (within normal range)` };
  }
  if (turns <= 15) {
    return { score: 1 - (turns - normalMax) * perTurn, detail: `${turns} turns (slightly extended)` };
  }
  const midPenalty = (15 - normalMax) * perTurn;
  return {
    score: Math.max(0, 1 - midPenalty - (turns - 15) * EFFICIENCY_THRESHOLDS.turnCountExtendedPenaltyPerTurn),
    detail: `${turns} turns (extended session)`,
  };
}

function scoreRetryEfficiency(calls: ExtractedToolCall[]) {
  if (calls.length < 2) {
    return { score: 1, detail: "Too few calls" };
  }
  const byGroup = new Map<string, ExtractedToolCall[]>();
  for (const call of calls) {
    const key = `${call.toolName}:${String(call.args.path ?? call.args.command ?? "")}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), call]);
  }
  let totalRetryChains = 0;
  let excessiveRetries = 0;
  const threshold = EFFICIENCY_THRESHOLDS.retryExcessiveThreshold;
  for (const group of byGroup.values()) {
    let consecutiveFailures = 0;
    for (const call of group) {
      if (call.isError) {
        consecutiveFailures += 1;
        continue;
      }
      if (consecutiveFailures > 0) {
        totalRetryChains += 1;
        if (consecutiveFailures >= threshold) {
          excessiveRetries += 1;
        }
      }
      consecutiveFailures = 0;
    }
    if (consecutiveFailures > 0) {
      totalRetryChains += 1;
      if (consecutiveFailures >= threshold) {
        excessiveRetries += 1;
      }
    }
  }
  if (totalRetryChains === 0) {
    return { score: 1, detail: "No retry chains" };
  }
  if (excessiveRetries === 0) {
    return { score: 0.9, detail: `${totalRetryChains} retry chain(s), all resolved quickly` };
  }
  return {
    score: Math.max(0, 0.8 - excessiveRetries * 0.2),
    detail: `${excessiveRetries} excessive retry chain(s) (${threshold}+ failures before success)`,
  };
}

function hasReadPath(readPaths: Set<string>, editPath: string): boolean {
  if (readPaths.has(editPath)) {
    return true;
  }
  for (const readPath of readPaths) {
    if (readPath.endsWith(`/${editPath}`) || editPath.endsWith(`/${readPath}`)) {
      return true;
    }
  }
  return false;
}

function scoreReadBeforeEdit(calls: ExtractedToolCall[]) {
  const edits = calls.filter((call) => includesName(BRANCH_CODING_TOOLS.editTools, call.toolName));
  if (edits.length === 0) {
    return { score: 1, detail: "No edits to check" };
  }
  const readPaths = new Set<string>();
  let compliant = 0;
  let total = 0;
  for (const call of calls) {
    const rawPath = pathOf(call);
    if (!rawPath) {
      continue;
    }
    if (includesName(BRANCH_CODING_TOOLS.readTools, call.toolName)) {
      readPaths.add(rawPath);
    } else if (includesName(BRANCH_CODING_TOOLS.editTools, call.toolName)) {
      total += 1;
      if (hasReadPath(readPaths, rawPath)) {
        compliant += 1;
      }
    }
  }
  if (total === 0) {
    return { score: 1, detail: "No path-targeted edits" };
  }
  const violations = total - compliant;
  if (violations === 0) {
    return { score: 1, detail: `All ${total} edits had prior reads` };
  }
  return { score: compliant / total, detail: `${violations}/${total} edits without prior read` };
}

/** Measures how cleanly a coding session worked: redundancy, turns, retries, read-before-edit. */
export function createCodingEfficiencyScorer() {
  return createScorer<AgentScorerRun["input"], ScorerRunOutputForAgent>({
    id: "coding-efficiency",
    name: "Coding Efficiency",
    description:
      "Measures coding session efficiency: redundancy, turn count, retry patterns, read-before-edit.",
  })
    .preprocess(({ run }) => {
      const messages = run.output ?? [];
      const calls = extractCodingToolCalls(messages);
      const turns = messages.filter((message) => message.role === "assistant").length;
      if (calls.length < EFFICIENCY_THRESHOLDS.minToolCalls) {
        return { empty: true as const, totalCalls: calls.length, totalTurns: turns };
      }
      return {
        empty: false as const,
        redundancy: scoreRedundancy(calls),
        turnCount: scoreTurnCount(turns),
        retryEfficiency: scoreRetryEfficiency(calls),
        readBeforeEdit: scoreReadBeforeEdit(calls),
        totalCalls: calls.length,
        totalTurns: turns,
      };
    })
    .generateScore(({ results }) => {
      const p = results.preprocessStepResult;
      if (p.empty) {
        return 0;
      }
      const score =
        p.redundancy.score * EFFICIENCY_WEIGHTS.redundancy +
        p.turnCount.score * EFFICIENCY_WEIGHTS.turnCount +
        p.retryEfficiency.score * EFFICIENCY_WEIGHTS.retryEfficiency +
        p.readBeforeEdit.score * EFFICIENCY_WEIGHTS.readBeforeEdit;
      return Math.round(score * 100) / 100;
    })
    .generateReason(({ results, score }) => {
      const p = results.preprocessStepResult;
      if (p.empty) {
        return `Score: 0 (${p.totalCalls} tool calls — below minimum threshold for scoring)`;
      }
      const pct = (weight: number) => `${(weight * 100).toFixed(0)}%`;
      return [
        `Score: ${score} (${p.totalCalls} calls, ${p.totalTurns} turns)`,
        `Redundancy (${pct(EFFICIENCY_WEIGHTS.redundancy)}): ${p.redundancy.detail} [${p.redundancy.score}]`,
        `Turn count (${pct(EFFICIENCY_WEIGHTS.turnCount)}): ${p.turnCount.detail} [${p.turnCount.score}]`,
        `Retry efficiency (${pct(EFFICIENCY_WEIGHTS.retryEfficiency)}): ${p.retryEfficiency.detail} [${p.retryEfficiency.score}]`,
        `Read-before-edit (${pct(EFFICIENCY_WEIGHTS.readBeforeEdit)}): ${p.readBeforeEdit.detail} [${p.readBeforeEdit.score}]`,
      ].join("\n");
    });
}
