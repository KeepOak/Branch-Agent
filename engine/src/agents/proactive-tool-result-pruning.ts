// From NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:agent/context_compressor.py (atlas AGENT-LOOP-0102). Converted to TypeScript with Branch canonical messages; optional token tail protects R-1558. Canonical transcript and tool arguments are never edited.

import { estimateMessagesTokens } from "./compaction-planning.js";
import type { AgentMessage } from "./runtime/index.js";
export const PRUNED_TOOL_PLACEHOLDER = "[Old tool output cleared to save context space]";
export type ProactivePruneConfig = {
  proactivePruneTokens?: unknown;
  proactivePruneMinResultChars?: unknown;
  proactivePruneMinReclaimTokens?: unknown;
  protectFirstN?: number;
  protectLastN?: number;
  protectTailTokens?: number;
  thresholdTokens?: number;
};
export function pruneInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  if (typeof value === "string" && !value.trim()) return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}
export function estimateMsgBudgetTokens(message: AgentMessage): number {
  return estimateMessagesTokens([message]);
}
function text(message: AgentMessage): string {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
}
function summarizeToolResult(message: Extract<AgentMessage, { role: "toolResult" }>): string {
  const content = text(message),
    lines = content.trim() ? content.split("\n").length : 0;
  return message.toolName === "terminal" || message.toolName === "exec"
    ? `[${message.toolName}] -> exit ${/"exit_code"\s*:\s*(-?\d+)/.exec(content)?.[1] ?? "?"}, ${lines} lines output (${content.length.toLocaleString("en-US")} chars)`
    : `[${message.toolName}] (${content.length.toLocaleString("en-US")} chars result)`;
}
export class ProactiveToolResultPruner {
  readonly proactivePruneTokens: number;
  readonly proactivePruneMinResultChars: number;
  readonly proactivePruneMinReclaimTokens: number;
  readonly thresholdTokens: number;
  rearmTokens = 0;
  private lastWarning: string | undefined;
  constructor(
    readonly config: ProactivePruneConfig = {},
    private readonly warn: (text: string) => void = () => {},
  ) {
    this.proactivePruneTokens = pruneInteger(config.proactivePruneTokens, 0);
    this.proactivePruneMinResultChars = Math.max(
      200,
      pruneInteger(config.proactivePruneMinResultChars, 8000) || 8000,
    );
    this.proactivePruneMinReclaimTokens =
      config.proactivePruneMinReclaimTokens === null ||
      (typeof config.proactivePruneMinReclaimTokens === "number" &&
        config.proactivePruneMinReclaimTokens < 0)
        ? 0
        : pruneInteger(config.proactivePruneMinReclaimTokens, 4096);
    this.thresholdTokens = config.thresholdTokens ?? 500_000;
  }
  onSessionReset(): void {
    this.rearmTokens = 0;
    this.lastWarning = undefined;
  }
  onFullCompression(): void {
    this.onSessionReset();
  }
  private warnNoOp(reason: string, currentTokens: number | undefined): void {
    if (currentTokens === undefined || currentTokens < this.thresholdTokens) {
      this.lastWarning = undefined;
      return;
    }
    const key = reason + ":" + this.rearmTokens;
    if (key === this.lastWarning) return;
    this.lastWarning = key;
    this.warn(
      `Context is over the compression threshold (${currentTokens} of ${this.thresholdTokens} tokens) but reclamation did not run: ${reason} (prune rearm mark ${this.rearmTokens}).`,
    );
  }
  scan(messages: AgentMessage[]): { messages: AgentMessage[]; pruned: number } {
    const result = messages.slice(),
      seen = new Set<string>();
    let pruned = 0;
    let boundary = Math.max(0, messages.length - (this.config.protectLastN ?? 4));
    if (this.config.protectTailTokens) {
      let tokens = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        tokens += estimateMsgBudgetTokens(messages[i]);
        boundary = Math.min(boundary, i);
        if (tokens >= this.config.protectTailTokens) break;
      }
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role !== "toolResult") continue;
      const body = text(message);
      if (!body) continue;
      // Dedup is lossless and tail-agnostic at source. Owner token protection is stronger.
      const duplicate = body.length >= 200 && seen.has(body);
      seen.add(body);
      const protectedTokenTail = this.config.protectTailTokens !== undefined && i >= boundary;
      if (protectedTokenTail) continue;
      if (
        !duplicate &&
        (i >= boundary ||
          body.length <= this.proactivePruneMinResultChars ||
          body.startsWith("[Duplicate tool output") ||
          body === PRUNED_TOOL_PLACEHOLDER)
      )
        continue;
      // Leave multimodal envelopes live rather than silently erasing image evidence.
      if (message.content.some((p) => p.type !== "text")) continue;
      result[i] = {
        ...message,
        content: [
          {
            type: "text",
            text: duplicate
              ? "[Duplicate tool output — same content as a more recent call]"
              : summarizeToolResult(message),
          },
        ],
      };
      pruned++;
    }
    return { messages: result, pruned };
  }
  async pruneToolResultsOnly(
    messages: AgentMessage[],
    currentTokens?: number,
    persist?: (messages: AgentMessage[], rearmTokens: number) => Promise<void>,
  ): Promise<{ messages: AgentMessage[]; pruned: number }> {
    const unchanged = { messages, pruned: 0 };
    if (
      this.proactivePruneTokens <= 0 ||
      (currentTokens !== undefined && currentTokens < this.proactivePruneTokens)
    )
      return unchanged;
    if (messages.length <= (this.config.protectLastN ?? 4) + (this.config.protectFirstN ?? 2) + 1) {
      this.warnNoOp("prune:tail_only", currentTokens);
      return unchanged;
    }
    const before = estimateMessagesTokens(messages),
      over = currentTokens !== undefined && currentTokens >= this.thresholdTokens;
    if (before < this.rearmTokens && !over) return unchanged;
    const candidate = this.scan(messages);
    if (!candidate.pruned) {
      this.warnNoOp("prune:nothing_eligible", currentTokens);
      return unchanged;
    }
    const after = estimateMessagesTokens(candidate.messages),
      reclaimed = Math.max(0, before - after);
    if (reclaimed < this.proactivePruneMinReclaimTokens) {
      this.warnNoOp("prune:reclaim_below_minimum", currentTokens);
      return unchanged;
    }
    const next =
      after + Math.max(reclaimed, this.proactivePruneTokens, this.proactivePruneMinReclaimTokens);
    if (persist) {
      try {
        await persist(candidate.messages, next);
      } catch {
        this.warnNoOp("prune:store_commit_failed", currentTokens);
        return unchanged;
      }
    }
    this.rearmTokens = next;
    this.lastWarning = undefined;
    return candidate;
  }
}
/** Summary input only: retained history and the provider's cached main prompt remain unchanged. */
export async function pruneBeforeSummarizing(messages: AgentMessage[]): Promise<AgentMessage[]> {
  const pruner = new ProactiveToolResultPruner({
    proactivePruneTokens: 1,
    protectFirstN: 0,
    protectLastN: 0,
    protectTailTokens: 40_000,
    proactivePruneMinReclaimTokens: 0,
  });
  return (await pruner.pruneToolResultsOnly(messages)).messages;
}
