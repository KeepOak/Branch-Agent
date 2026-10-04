// Judge model for LLM scorers: routes every judge call through the same QA manual lane the
// character-eval judge uses (a live provider/model ref behind a QA gateway), no extra SDK.
import type { QaProviderMode } from "../model-selection.js";
import type { ScorerJudgeModel, ScorerJudgeRequest } from "./scorer.js";

export type QaScoreJudgeRunner = (params: {
  repoRoot: string;
  judgeModel: string;
  providerMode: QaProviderMode;
  prompt: string;
  timeoutMs?: number;
}) => Promise<string | null>;

export const DEFAULT_QA_SCORE_JUDGE_PROVIDER_MODE: QaProviderMode = "live-frontier";

async function defaultRunJudge(params: Parameters<QaScoreJudgeRunner>[0]): Promise<string | null> {
  const { runQaManualLane } = await import("../manual-lane.runtime.js");
  const result = await runQaManualLane({
    repoRoot: params.repoRoot,
    providerMode: params.providerMode,
    primaryModel: params.judgeModel,
    alternateModel: params.judgeModel,
    message: params.prompt,
    ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
  });
  return result.reply;
}

export function buildQaJudgePrompt(request: ScorerJudgeRequest): string {
  return `${request.instructions.trim()}\n\n${request.prompt}`;
}

export function createQaScoreJudgeModel(params: {
  repoRoot: string;
  judgeModel: string;
  providerMode?: QaProviderMode;
  timeoutMs?: number;
  runJudge?: QaScoreJudgeRunner;
}): ScorerJudgeModel {
  const runJudge = params.runJudge ?? defaultRunJudge;
  const providerMode = params.providerMode ?? DEFAULT_QA_SCORE_JUDGE_PROVIDER_MODE;
  const slash = params.judgeModel.indexOf("/");
  return {
    modelId: slash === -1 ? params.judgeModel : params.judgeModel.slice(slash + 1),
    ...(slash > 0 ? { provider: params.judgeModel.slice(0, slash) } : {}),
    generate: async (request) =>
      await runJudge({
        repoRoot: params.repoRoot,
        judgeModel: params.judgeModel,
        providerMode,
        prompt: buildQaJudgePrompt(request),
        ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      }),
  };
}
