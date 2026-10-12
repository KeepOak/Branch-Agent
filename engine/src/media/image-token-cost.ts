// Ported from NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2
// agent/image_token_cost.py; provider usage is authoritative, never a vendor formula.
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_IMAGE_TOKEN_COST = 1500;
const MIN_PLAUSIBLE = 64;
const MAX_PLAUSIBLE = 32768;
const costs = new AsyncLocalStorage<{ cost: number | null }>();
export function currentImageTokenCost(): number {
  return costs.getStore()?.cost ?? DEFAULT_IMAGE_TOKEN_COST;
}
export function withImageTokenCost<T>(cost: number | null, run: () => T): T {
  return costs.run({ cost }, run);
}
export type ImageCostMessage = Record<string, unknown>;
export type ImageUsageAnchor = { baseCount: number };
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parts(value: unknown, types: readonly string[]): number {
  return Array.isArray(value) ? value.filter((part) => record(part) && types.includes(String(part.type))).length : 0;
}
export function countImages(messages: readonly ImageCostMessage[]): number {
  return messages.reduce((total, message) => {
    const types = ["image", "image_url", "input_image"];
    let count = parts(message.content, types) + parts(message._anthropic_content_blocks, ["image"]);
    if (record(message.content) && message.content._multimodal) {
      count += parts(message.content.content, ["image", "image_url"]);
    }
    return total + count + parts(message.output, types);
  }, 0);
}
function key(model: string | null | undefined, baseUrl: string | null | undefined): string {
  let host = "";
  const raw = baseUrl?.trim();
  if (raw) {
    try { host = new URL(raw.includes("://") ? raw : `http://${raw}`).hostname.toLowerCase().replace(/\.$/, ""); }
    catch { /* An absent/unparseable host shares the source's empty host key. */ }
  }
  return `${model ?? ""}@${host}`;
}

/** One instance per resolved profile cache path; never a cross-profile global table. */
export class ImageTokenCosts {
  private table: Record<string, number> | undefined;
  private readonly cachePath: string;
  constructor(cachePath: string) { this.cachePath = cachePath; }
  private load(): Record<string, number> {
    if (this.table) { return this.table; }
    const result: Record<string, number> = Object.create(null) as Record<string, number>;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.cachePath, "utf8"));
      if (record(parsed)) {
        for (const [name, value] of Object.entries(parsed)) {
          if (typeof value === "number" && Number.isInteger(value) && value >= MIN_PLAUSIBLE && value <= MAX_PLAUSIBLE) {
            result[name] = value;
          }
        }
      }
    } catch { /* Missing or malformed cache starts uncalibrated, as upstream. */ }
    this.table = result;
    return result;
  }
  learned(model: string | null | undefined, baseUrl: string | null | undefined): number {
    return this.load()[key(model, baseUrl)] ?? DEFAULT_IMAGE_TOKEN_COST;
  }
  withModelCost<T>(model: string | null | undefined, baseUrl: string | null | undefined, run: () => T): T {
    return withImageTokenCost(this.learned(model, baseUrl), run);
  }
  /** The estimator MUST return null for stale/replaced priced prefixes, and include
   * prior completion tokens while skipping the already-priced first assistant delta.
   * It executes with image cost zero so only newly introduced images price the residual. */
  calibrate(params: {
    model?: string | null;
    baseUrl?: string | null;
    messages: readonly ImageCostMessage[];
    anchor: ImageUsageAnchor | null;
    promptTokens: unknown;
    anchoredContextTokens: (messages: readonly ImageCostMessage[], anchor: ImageUsageAnchor) => number | null;
  }): number | null {
    const { anchor, messages } = params;
    const real = typeof params.promptTokens === "number" || typeof params.promptTokens === "string"
      ? Math.trunc(Number(params.promptTokens)) : 0;
    if (!Number.isFinite(real) || real <= 0 || !anchor || !Number.isInteger(anchor.baseCount) || anchor.baseCount <= 0 || anchor.baseCount > messages.length) {
      return null;
    }
    let delta = messages.slice(anchor.baseCount);
    if (delta[0]?.role === "assistant") { delta = delta.slice(1); }
    const images = countImages(delta);
    if (!images) { return null; }
    const textOnly = withImageTokenCost(0, () => params.anchoredContextTokens(messages, anchor));
    if (textOnly === null || !Number.isFinite(textOnly)) { return null; }
    const perImage = Math.floor((real - textOnly) / images);
    if (perImage < MIN_PLAUSIBLE || perImage > MAX_PLAUSIBLE) { return null; }
    const table = this.load();
    const name = key(params.model, params.baseUrl);
    const prior = table[name];
    const learned = prior === undefined ? perImage : Math.trunc(prior + 0.5 * (perImage - prior));
    table[name] = learned;
    const bound = costs.getStore();
    if (bound) { bound.cost = learned; }
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true });
      const temporary = `${this.cachePath}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(table), { mode: 0o600 });
      renameSync(temporary, this.cachePath);
    } catch { /* Persistence is best effort; an observation still calibrates this turn. */ }
    return learned;
  }
}
