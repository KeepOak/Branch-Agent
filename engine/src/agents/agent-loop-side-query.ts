/**
 * One short side call on the agent's utility model, shared by the agent-loop
 * helpers ported from gemini-cli and qwen-code (next-speaker check, rolling
 * summary, distillation, tool-use labels). Upstream routes these through its
 * fast model; the utility model is that role here.
 */
import type { BranchConfig } from "../config/types.branch.js";
import { runIsolatedCompletion } from "./isolated-completion.js";
import { prepareUtilityCompletionForAgent } from "./utility-completion.js";

/**
 * Upstream sets no deadline on these calls (only the turn's abort signal ends
 * them). The isolated runtime requires one, so use a day: effectively none,
 * with headroom for runtimes that add grace periods to timer values.
 */
export const SIDE_QUERY_NO_DEADLINE_MS = 86_400_000;

export type SideQueryRequest = {
  systemPrompt: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Returns the visible reply text, or null when the model returned nothing. Throws on failure. */
export type SideQuery = (request: SideQueryRequest) => Promise<string | null>;

export type SideQueryDeps = {
  prepare?: typeof prepareUtilityCompletionForAgent;
  run?: typeof runIsolatedCompletion;
};

export function createUtilityModelSideQuery(params: {
  cfg: BranchConfig;
  agentId: string;
  /** Skip (throw) when no utility model resolves instead of using the primary model. */
  requireUtilityModel?: boolean;
  deps?: SideQueryDeps;
}): SideQuery {
  const prepare = params.deps?.prepare ?? prepareUtilityCompletionForAgent;
  const run = params.deps?.run ?? runIsolatedCompletion;
  return async (request) => {
    request.signal?.throwIfAborted();
    const prepared = await prepare({
      cfg: params.cfg,
      agentId: params.agentId,
      useUtilityModel: params.requireUtilityModel ? "required" : true,
    });
    const streamParams = {
      ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    };
    const result = await run({
      ...prepared,
      config: params.cfg,
      systemPrompt: request.systemPrompt,
      prompt: request.prompt,
      timeoutMs: request.timeoutMs ?? SIDE_QUERY_NO_DEADLINE_MS,
      ...(request.signal ? { abortSignal: request.signal } : {}),
      ...(Object.keys(streamParams).length > 0 ? { streamParams } : {}),
    });
    const text = result.text.trim();
    return text || null;
  };
}
