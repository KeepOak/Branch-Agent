// Source: NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2
// agent/usage_anchor.py. Only the provider-priced prefix anchors the estimate.
import { createHash } from "node:crypto";
import type { ImageCostMessage, ImageUsageAnchor } from "./image-token-cost.js";

export type UsageAnchor = ImageUsageAnchor & {
  promptTokens: number;
  completionTokens: number;
  baseLastRole: unknown;
  baseLastFingerprint: string;
  basePrefixFingerprint: string;
};
const fingerprintKeys = ["role", "content", "api_content", "tool_call_id", "tool_calls"];
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    }
    return item;
  });
}
function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
export function messageFingerprint(message: ImageCostMessage): string | null {
  try {
    const fields = Object.fromEntries(fingerprintKeys.filter((key) => message[key] !== null && message[key] !== undefined).map((key) => [key, message[key]]));
    return digest(fields);
  } catch { return null; }
}
function prefixFingerprint(messages: readonly ImageCostMessage[], baseCount: number): string | null {
  if (baseCount <= 0 || messages.length < baseCount) { return null; }
  const rows: unknown[] = [];
  for (const message of messages.slice(0, baseCount)) {
    const fingerprint = messageFingerprint(message);
    if (!fingerprint) { return null; }
    rows.push([message.role ?? null, fingerprint]);
  }
  return digest(rows);
}
function usageInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === "") { return 0; }
  if (typeof value !== "number" && typeof value !== "string") { return null; }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}
export function captureUsageAnchor(promptTokens: unknown, completionTokens: unknown, messages: readonly ImageCostMessage[]): UsageAnchor | null {
  const prompt = usageInteger(promptTokens);
  const completion = usageInteger(completionTokens);
  const last = messages.at(-1);
  if (prompt === null || prompt <= 0 || completion === null || !last) { return null; }
  const lastFingerprint = messageFingerprint(last);
  const prefix = prefixFingerprint(messages, messages.length);
  if (!lastFingerprint || !prefix) { return null; }
  return { promptTokens: prompt, completionTokens: Math.max(0, completion), baseCount: messages.length,
    baseLastRole: last.role ?? null, baseLastFingerprint: lastFingerprint, basePrefixFingerprint: prefix };
}
export function usageAnchorMatches(messages: readonly ImageCostMessage[], anchor: UsageAnchor): boolean {
  if (!Number.isInteger(anchor.baseCount) || anchor.baseCount <= 0 || messages.length < anchor.baseCount) { return false; }
  const last = messages[anchor.baseCount - 1];
  return Boolean(last && (last.role ?? null) === anchor.baseLastRole && anchor.baseLastFingerprint &&
    messageFingerprint(last) === anchor.baseLastFingerprint && anchor.basePrefixFingerprint &&
    prefixFingerprint(messages, anchor.baseCount) === anchor.basePrefixFingerprint);
}
/** Delta estimator is injected from the actual caller; image calibration supplies
 * its turn-local zero cost, so this same validated anchor serves both paths. */
export function anchoredContextTokens(messages: readonly ImageCostMessage[], anchor: UsageAnchor | null,
  estimateDelta: (messages: readonly ImageCostMessage[]) => number): number | null {
  if (!anchor || !usageAnchorMatches(messages, anchor) || !Number.isFinite(anchor.promptTokens) || anchor.promptTokens <= 0 ||
      !Number.isFinite(anchor.completionTokens) || anchor.completionTokens < 0) { return null; }
  let delta = messages.slice(anchor.baseCount);
  if (delta[0]?.role === "assistant") { delta = delta.slice(1); }
  const estimate = delta.length ? estimateDelta(delta) : 0;
  return Number.isFinite(estimate) && estimate >= 0 ? anchor.promptTokens + anchor.completionTokens + estimate : null;
}
