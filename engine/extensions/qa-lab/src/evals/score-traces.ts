// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421
// packages/core/src/evals/scoreTraces/scoreTraces.ts and scoreTracesWorkflow.ts (scoreTrace /
// scoreTraceBatch): score stored Branch runs after the fact; one failed target never aborts siblings.
import { runTasksWithConcurrency } from "branch/plugin-sdk/concurrency-runtime";
import { formatErrorMessage } from "branch/plugin-sdk/error-runtime";
import { ScorerRunError, type AnyBranchScorer, type NotScorableOutcome } from "./scorer.js";
import type { AgentScorerRun, ScorerRunOutputForAgent } from "./scorer-utils.js";
import type { StoredScorerRun } from "./trajectory-run.js";

export type ScoreRowData = {
  scorerId: string;
  scorerName: string;
  runId: string;
  score: number;
  reason?: string;
  sourcePath: string;
  sessionId?: string;
  traceId?: string;
  scoreSource: "TRACE";
  createdAt: string;
  preprocessStepResult?: unknown;
  analyzeStepResult?: unknown;
};

export type ScoreTraceBatchResult =
  | { ok: true; index: number; sourcePath: string; score: ScoreRowData }
  | { ok: true; index: number; sourcePath: string; notScorable: NotScorableOutcome }
  | { ok: false; index: number; sourcePath: string; error: string; failedStep?: string };

type AgentScorer = AnyBranchScorer<AgentScorerRun["input"], ScorerRunOutputForAgent>;

/** Scores one stored run; resolves null when the scorer declares it not scorable. */
export async function scoreStoredRun(params: {
  scorer: AgentScorer;
  target: StoredScorerRun;
  now?: () => Date;
}): Promise<ScoreRowData | { notScorable: NotScorableOutcome }> {
  const { scorer, target } = params;
  const result = await scorer.run({
    ...(target.run.runId ? { runId: target.run.runId } : {}),
    input: target.run.input,
    output: target.run.output,
    ...(target.run.groundTruth !== undefined ? { groundTruth: target.run.groundTruth } : {}),
    ...(target.run.requestContext ? { requestContext: target.run.requestContext } : {}),
  });
  if (result.notScorable) {
    return { notScorable: result.notScorable };
  }
  if (typeof result.score !== "number") {
    throw new Error(`Scorer ${scorer.id} produced no score`);
  }
  return {
    scorerId: scorer.id,
    scorerName: scorer.name,
    runId: result.runId,
    score: result.score,
    ...(typeof result.reason === "string" ? { reason: result.reason } : {}),
    sourcePath: target.sourcePath,
    ...(target.sessionId ? { sessionId: target.sessionId } : {}),
    ...(target.traceId ? { traceId: target.traceId } : {}),
    scoreSource: "TRACE",
    createdAt: (params.now?.() ?? new Date()).toISOString(),
    ...(result.preprocessStepResult !== undefined
      ? { preprocessStepResult: result.preprocessStepResult }
      : {}),
    ...(result.analyzeStepResult !== undefined ? { analyzeStepResult: result.analyzeStepResult } : {}),
  };
}

/** Scores every target with one scorer; results keep target order, failures are isolated. */
export async function scoreStoredRunBatch(params: {
  scorer: AgentScorer;
  targets: readonly StoredScorerRun[];
  concurrency?: number;
  now?: () => Date;
}): Promise<ScoreTraceBatchResult[]> {
  const { results } = await runTasksWithConcurrency({
    tasks: params.targets.map((target, index) => async (): Promise<ScoreTraceBatchResult> => {
      try {
        const scored = await scoreStoredRun({ scorer: params.scorer, target, now: params.now });
        if ("notScorable" in scored) {
          return { ok: true, index, sourcePath: target.sourcePath, notScorable: scored.notScorable };
        }
        return { ok: true, index, sourcePath: target.sourcePath, score: scored };
      } catch (error) {
        return {
          ok: false,
          index,
          sourcePath: target.sourcePath,
          error: formatErrorMessage(error),
          ...(error instanceof ScorerRunError ? { failedStep: error.failedStep } : {}),
        };
      }
    }),
    limit: params.concurrency ?? 3,
  });
  return results;
}
