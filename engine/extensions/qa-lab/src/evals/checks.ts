// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421 packages/evals/src/scorers/code/checks/index.ts
// (zero-LLM quick checks over a Branch agent run).
import { createScorer } from "./scorer.js";
import { compareTwoStrings } from "./string-similarity.js";
import {
  extractToolCalls,
  getTextContentFromMessage,
  mergeToolInvocations,
  type AgentScorerRun,
  type EvalToolInvocation,
  type ScorerRunOutputForAgent,
} from "./scorer-utils.js";

type AgentRunInput = AgentScorerRun["input"];

function agentScorer(config: { id: string; name: string; description: string }) {
  return createScorer<AgentRunInput, ScorerRunOutputForAgent>(config);
}

function assistantText(output: ScorerRunOutputForAgent, separator: string): string {
  return output
    .filter((message) => message.role === "assistant")
    .map((message) => getTextContentFromMessage(message))
    .join(separator);
}

export type IncludesOptions = {
  /** Case-insensitive match (default: true). */
  ignoreCase?: boolean;
};

/** Scores 1 if the assistant output contains the expected substring. */
export function includes(expected: string, options: IncludesOptions = {}) {
  const { ignoreCase = true } = options;
  return agentScorer({
    id: "check-includes",
    name: "Includes Check",
    description: `Checks if output includes "${expected}"`,
  })
    .preprocess(({ run }) => {
      let output = assistantText(run.output, " ");
      let target = expected;
      if (ignoreCase) {
        output = output.toLowerCase();
        target = target.toLowerCase();
      }
      return { output, target, found: output.includes(target) };
    })
    .generateScore(({ results }) => (results.preprocessStepResult.found ? 1 : 0));
}

/** Scores 1 if the assistant output does NOT contain the substring. */
export function excludes(unwanted: string, options: IncludesOptions = {}) {
  const { ignoreCase = true } = options;
  return agentScorer({
    id: "check-excludes",
    name: "Excludes Check",
    description: `Checks that output does not include "${unwanted}"`,
  })
    .preprocess(({ run }) => {
      let output = assistantText(run.output, " ");
      let target = unwanted;
      if (ignoreCase) {
        output = output.toLowerCase();
        target = target.toLowerCase();
      }
      return { output, target, excluded: !output.includes(target) };
    })
    .generateScore(({ results }) => (results.preprocessStepResult.excluded ? 1 : 0));
}

/** Scores 1 if the assistant output exactly equals the expected string. */
export function equals(expected: string, options: IncludesOptions = {}) {
  const { ignoreCase = true } = options;
  return agentScorer({
    id: "check-equals",
    name: "Equals Check",
    description: `Checks if output equals "${expected}"`,
  })
    .preprocess(({ run }) => {
      let output = assistantText(run.output, "");
      let target = expected;
      if (ignoreCase) {
        output = output.toLowerCase();
        target = target.toLowerCase();
      }
      return { output, target, isEqual: output === target };
    })
    .generateScore(({ results }) => (results.preprocessStepResult.isEqual ? 1 : 0));
}

export type MatchesOptions = {
  /** Anchor the pattern so the whole output must match (default: substring match). */
  exact?: boolean;
};

/** Scores 1 if the assistant output matches the regular expression. */
export function matches(pattern: RegExp, options: MatchesOptions = {}) {
  const { exact = false } = options;
  return agentScorer({
    id: "check-matches",
    name: "Matches Check",
    description: `Checks if output matches pattern ${String(pattern)}`,
  })
    .preprocess(({ run }) => {
      const output = assistantText(run.output, "");
      const regex = exact ? new RegExp(`^${pattern.source}$`, pattern.flags) : pattern;
      // g/y regexes keep lastIndex between calls, and the scorer is reused across items.
      regex.lastIndex = 0;
      const matched = regex.test(output);
      return { output, pattern: String(pattern), matched };
    })
    .generateScore(({ results }) => (results.preprocessStepResult.matched ? 1 : 0));
}

export type SimilarityOptions = {
  /** Minimum similarity (0-1) to score 1; without it the raw similarity is the score. */
  threshold?: number;
  ignoreCase?: boolean;
};

/** String similarity (0-1) between the assistant output and an expected string. */
export function similarity(expected: string, options: SimilarityOptions = {}) {
  const { ignoreCase = true, threshold } = options;
  return agentScorer({
    id: "check-similarity",
    name: "Similarity Check",
    description: `Checks string similarity to "${expected}"`,
  })
    .preprocess(({ run }) => {
      let output = assistantText(run.output, " ");
      let target = expected;
      if (ignoreCase) {
        output = output.toLowerCase();
        target = target.toLowerCase();
      }
      const score = compareTwoStrings(output, target);
      return { output, target, score, threshold };
    })
    .generateScore(({ results }) => {
      const { score, threshold: limit } = results.preprocessStepResult;
      return limit !== undefined ? (score >= limit ? 1 : 0) : score;
    });
}

export type CalledToolOptions = {
  /** Minimum number of calls (default: 1). */
  times?: number;
};

/** Scores 1 if the tool was called at least `times` times. */
export function calledTool(toolName: string, options: CalledToolOptions = {}) {
  const { times = 1 } = options;
  return agentScorer({
    id: "check-called-tool",
    name: "Called Tool Check",
    description: `Checks that "${toolName}" was called${times > 1 ? ` at least ${times} times` : ""}`,
  })
    .preprocess(({ run }) => {
      const { tools } = extractToolCalls(run.output);
      const count = tools.filter((tool) => tool === toolName).length;
      return { toolName, expectedTimes: times, actualCount: count, passed: count >= times };
    })
    .generateScore(({ results }) => (results.preprocessStepResult.passed ? 1 : 0));
}

/** Scores 1 if the tool was NOT called. */
export function didNotCall(toolName: string) {
  return agentScorer({
    id: "check-did-not-call",
    name: "Did Not Call Check",
    description: `Checks that "${toolName}" was NOT called`,
  })
    .preprocess(({ run }) => {
      const { tools } = extractToolCalls(run.output);
      const count = tools.filter((tool) => tool === toolName).length;
      return { toolName, count, passed: count === 0 };
    })
    .generateScore(({ results }) => (results.preprocessStepResult.passed ? 1 : 0));
}

/** Scores 1 if the tools were called in this order (other calls may sit in between). */
export function toolOrder(expectedOrder: string[]) {
  return agentScorer({
    id: "check-tool-order",
    name: "Tool Order Check",
    description: `Checks tool call order: [${expectedOrder.join(" → ")}]`,
  })
    .preprocess(({ run }) => {
      const { tools } = extractToolCalls(run.output);
      let orderIndex = 0;
      for (const tool of tools) {
        if (orderIndex < expectedOrder.length && tool === expectedOrder[orderIndex]) {
          orderIndex += 1;
        }
      }
      return { actualTools: tools, expectedOrder, passed: orderIndex === expectedOrder.length };
    })
    .generateScore(({ results }) => (results.preprocessStepResult.passed ? 1 : 0));
}

/** Scores 1 if the run made no more than `max` tool calls. */
export function maxToolCalls(max: number) {
  return agentScorer({
    id: "check-max-tool-calls",
    name: "Max Tool Calls Check",
    description: `Checks that no more than ${max} tool calls were made`,
  })
    .preprocess(({ run }) => {
      const { tools } = extractToolCalls(run.output);
      return { count: tools.length, max, passed: tools.length <= max };
    })
    .generateScore(({ results }) => (results.preprocessStepResult.passed ? 1 : 0));
}

/** Scores 1 if the run made no tool calls at all. */
export function usedNoTools() {
  return agentScorer({
    id: "check-used-no-tools",
    name: "Used No Tools Check",
    description: "Checks that no tools were called",
  })
    .preprocess(({ run }) => {
      const { tools } = extractToolCalls(run.output);
      return { count: tools.length, passed: tools.length === 0 };
    })
    .generateScore(({ results }) => (results.preprocessStepResult.passed ? 1 : 0));
}

/**
 * Scores 1 if no tool invocation failed: a thrown call (output-error), an incomplete call
 * (call), a result flagged isError, or a result carrying an `error` field all count as errors.
 */
export function noToolErrors() {
  return agentScorer({
    id: "check-no-tool-errors",
    name: "No Tool Errors Check",
    description: "Checks that no tool calls resulted in errors",
  })
    .preprocess(({ run }) => {
      const invocations = run.output.flatMap((message) => mergeToolInvocations(message));
      const errorCount = invocations.filter(isErrorInvocation).length;
      return { errorCount, totalCalls: invocations.length, passed: errorCount === 0 };
    })
    .generateScore(({ results }) => (results.preprocessStepResult.passed ? 1 : 0));
}

function isErrorInvocation(invocation: EvalToolInvocation): boolean {
  const result = invocation.result as { error?: unknown } | null | undefined;
  return (
    invocation.state === "call" ||
    invocation.state === "output-error" ||
    invocation.isError === true ||
    Boolean(result?.error)
  );
}

/** Quick checks: composable zero-LLM micro-scorers. */
export const checks = {
  includes,
  excludes,
  equals,
  matches,
  similarity,
  calledTool,
  didNotCall,
  toolOrder,
  maxToolCalls,
  usedNoTools,
  noToolErrors,
};
