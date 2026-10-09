// What the status bar's popovers read from the engine (DESIGN-SPEC §4.9), as pure readers so they can be tested.
// Sources: usage.status (infra/provider-usage.types.ts),
// sessions.usage with includeContextWeight (config/sessions/session-system-prompt-report.ts, the way the Control UI's
// usage/view-details.ts splits it), sessions.usage.timeseries, cron.list and update.status (gateway-protocol config.ts).
import { readMeasuredPercent } from "./limit-window-reading";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);

/** Under this share left, the ring, bars and label turn amber (§4.9.4 rule 4). */
export const LOW_LEFT = 15;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "6 PM", "7:40 PM" (§1.9). */
export function clockWords(at: Date): string {
  const h = at.getHours();
  const m = at.getMinutes();
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** Reset times use the same 12-hour words on every account surface. */
export function resetWords(resetAt: number | undefined, usedPercent: number, now: number): string {
  if (!resetAt || resetAt <= now) {
    return usedPercent <= 0 ? "not used yet" : "";
  }
  const at = new Date(resetAt);
  const today = new Date(now);
  if (at.toDateString() === today.toDateString()) {
    return `resets ${clockWords(at)}`;
  }
  if (resetAt - now < 6 * 86_400_000) {
    return `resets ${clockWords(at)} ${DAYS[at.getDay()].slice(0, 3)}`;
  }
  return `resets ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** The engine's window labels ("5h", "Week", "Day") in the spec's words ("This 5-hour window", "This week", "Today"). */
export function windowName(label: string): string {
  const hours = /^(\d+)h$/i.exec(label.trim());
  if (hours) {
    const count = Number(hours[1]);
    if (count >= 168) return "This week";
    if (count === 24) return "Today";
    return `This ${count}-hour window`;
  }
  const words: Record<string, string> = { week: "This week", weekly: "This week", day: "Today", daily: "Today", month: "This month", monthly: "This month" };
  return words[label.trim().toLowerCase()] ?? label;
}

/** "just now", "4 min ago", "1 h ago". */
export function ageWords(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  if (min < 1) {
    return "just now";
  }
  return min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`;
}

export type LimitWindow = { name: string; left: number; reset: string; low: boolean };
export type LimitPill = "Measured" | "Not published";
export type LimitRow = { id: string; name: string; provider?: string; email?: string; plan?: string; account: string; pill: LimitPill; windows: LimitWindow[]; line: string; inUse?: boolean; stale?: boolean };
export type Limits = { rows: LimitRow[]; updatedAt: number; refreshing: boolean };

/** Limits carried on branch:usage-checked when the status-bar poll got a result. */
export function usagePollResult(event: Event): Limits | null {
  const detail = (event as CustomEvent).detail;
  if (!detail || typeof detail !== "object" || !Array.isArray((detail as Limits).rows)) return null;
  return detail as Limits;
}

/** Usage endpoints return diagnostic text; the status bar only shows human-facing status words. */
export function usageStatusWords(error: unknown, provider: string): string {
  const raw = str(error);
  if (!raw) return `${provider} hasn't shared a limit with Branch.`;
  if (/\b429\b|rate.?limit/i.test(raw)) return `${provider} didn't share what's left right now. Branch checks again in 5 min.`;
  if (/\b401\b|\b403\b|unauthori[sz]ed|forbidden/i.test(raw)) return `${provider} needs you to sign in again to check usage.`;
  return `${provider} couldn't share usage right now. Branch will try again.`;
}

/** A reading the engine kept because the latest check was rate limited or timed out: say how old it is and why. */
export function staleReadingWords(reason: unknown, age: string): string {
  return /\b429\b|rate.?limit/i.test(str(reason)) ? `Rate limited · last reading ${age}. Branch checks again in 5 min.` : `No answer · last reading ${age}. Branch will try again.`;
}

function limitRow(p: Record<string, unknown>, updatedAt: number, now: number, accountNumber: number): LimitRow {
  const windows = list(p.windows).flatMap((w) => {
    const measured = readMeasuredPercent(w.usedPercent);
    if (!measured) return [];
    const { used, left } = measured;
    return [{ name: windowName(str(w.label)), left, reset: resetWords(num(w.resetAt) || undefined, used, now), low: left < LOW_LEFT }];
  });
  const account = [str(p.accountEmail), str(p.plan)].filter(Boolean).join(" · ");
  const measured = windows.length > 0;
  const provider = str(p.provider);
  const service = str(p.displayName) || provider;
  const name = provider === "openai-codex" || /^ChatGPT plan$/i.test(service) ? `ChatGPT · Account ${accountNumber}` : provider === "anthropic" ? `Claude · Account ${accountNumber}` : service.replace(/\s+plan$/i, "");
  const readingAt = num(p.readingAt);
  const stale = measured && readingAt > 0;
  const line = stale ? staleReadingWords(p.staleReason, ageWords(readingAt, now)) : p.error === "Usage not reported" ? "Usage not reported" : p.error ? usageStatusWords(p.error, name) : measured ? `as of ${ageWords(updatedAt, now)}` : str(p.summary) === "Usage not reported" ? "Usage not reported" : usageStatusWords(undefined, name);
  return { id: `${str(p.provider)}:${str(p.authProfileId) || str(p.accountEmail) || account}`, name, provider: str(p.provider), email: str(p.accountEmail), plan: str(p.plan), account, pill: measured ? "Measured" : "Not published", windows, line, inUse: p.inUse === true, ...(stale ? { stale } : {}) };
}

/** usage.status: one row per connection and account, never added together (§4.9.4 rule 1). */
export function readLimits(result: unknown, now = Date.now()): Limits {
  const r = rec(result);
  const updatedAt = num(r.updatedAt) || now;
  const numbers = new Map<string, number>();
  const rows = list(r.providers).map((p) => {
    const provider = str(p.provider);
    const number = (numbers.get(provider) ?? 0) + 1;
    numbers.set(provider, number);
    return limitRow(p, updatedAt, now, number);
  });
  return { rows, updatedAt, refreshing: r.refreshing === true };
}

export type RingReading = { name: string; left: number; reset: string; low: boolean };

function readingFrom(row: LimitRow): RingReading | null {
  const w = row.windows.find((window) => /5-hour/i.test(window.name)) ?? row.windows[0];
  return w ? { name: row.name, left: w.left, reset: w.reset, low: w.low } : null;
}

/** The ring shows the account used next when it has a reading; otherwise the first measured account. */
export function ringReading(limits: Limits | null): RingReading | null {
  const rows = limits?.rows ?? [];
  const usedNext = rows.find((row) => row.inUse);
  const preferred = usedNext ? readingFrom(usedNext) : null;
  if (preferred) {
    return preferred;
  }
  for (const row of rows) {
    const reading = readingFrom(row);
    if (reading) {
      return reading;
    }
  }
  return null;
}

/** usage.cost params for this calendar month on this computer's clock. */
export function monthParams(now = new Date()): Record<string, unknown> {
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const offset = -now.getTimezoneOffset();
  const abs = Math.abs(offset);
  const utcOffset = `UTC${offset >= 0 ? "+" : "-"}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : ""}`;
  return {
    startDate: day(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: day(now),
    mode: "specific",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utcOffset,
    agentScope: "all",
  };
}

/** usage.cost: "$14.20", or null when the engine reports no cost. */
export function readMonthSpend(result: unknown): string | null {
  const totals = rec(rec(result).totals);
  return typeof totals.totalCost === "number" ? `$${totals.totalCost.toFixed(2)}` : null;
}

/** "256K", "32K", "1.2M": the size of a model's window, in the words the spec uses for tokens. */
export function sizeWords(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  }
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens);
}

const CHARS_PER_TOKEN = 4; // the Control UI's usage/metrics.ts charsToTokens

export type RoomPart = { name: string; share: number; entries: { name: string; share: number }[] };
export type Room = { free: number; size: number; parts: RoomPart[] };

type Weight = Record<string, unknown>;
function weightParts(w: Weight, size: number): RoomPart[] {
  const share = (chars: number) => (chars / CHARS_PER_TOKEN / size) * 100;
  const skills = rec(w.skills), tools = rec(w.tools), prompt = rec(w.systemPrompt);
  const files = list(w.injectedWorkspaceFiles).filter((f) => typeof f.injectedChars === "number");
  const fileChars = files.reduce((n, f) => n + num(f.injectedChars), 0);
  const instructionChars = Math.max(0, num(prompt.chars) - fileChars - num(skills.promptChars) - num(tools.listChars));
  return [
    { name: "Instructions", share: share(instructionChars), entries: [] },
    { name: "Skills", share: share(num(skills.promptChars)), entries: list(skills.entries).map((e) => ({ name: str(e.name), share: share(num(e.blockChars)) })) },
    { name: "Tools", share: share(num(tools.listChars) + num(tools.schemaChars)), entries: list(tools.entries).map((e) => ({ name: str(e.name), share: share(num(e.summaryChars) + num(e.schemaChars)) })) },
    { name: "Files", share: share(fileChars), entries: files.map((f) => ({ name: str(f.name), share: share(num(f.injectedChars)) })) },
  ];
}

/** Room left (§4.9.5): the free share of the model's window, and what fills it by part. Null until the engine says. */
export function readRoom(totalTokens: number, contextTokens: number, usage: unknown): Room | null {
  if (contextTokens <= 0 || totalTokens <= 0) {
    return null;
  }
  const used = Math.min(100, (totalTokens / contextTokens) * 100);
  const weight = rec(list(rec(usage).sessions)[0]?.contextWeight);
  const parts = Object.keys(weight).length ? weightParts(weight, contextTokens) : [];
  const fixed = parts.reduce((n, p) => n + p.share, 0);
  const conversation = { name: "Conversation", share: Math.max(0, used - fixed), entries: [] };
  return { free: Math.max(0, Math.round(100 - used)), size: contextTokens, parts: parts.length ? [conversation, ...parts] : [] };
}

export type Round = { words: number; cached: number };

/** sessions.usage.timeseries: one bar per model call, newest last, and the share read from the cache. */
export function readRounds(result: unknown): { rounds: Round[]; cachedShare: number } {
  const points = list(rec(result).points);
  const rounds = points.map((p) => ({ words: num(p.totalTokens), cached: num(p.cacheRead) }));
  const input = points.reduce((n, p) => n + num(p.input) + num(p.cacheRead), 0);
  const cached = points.reduce((n, p) => n + num(p.cacheRead), 0);
  return { rounds, cachedShare: input > 0 ? Math.round((cached / input) * 100) : 0 };
}

/** "due", "in 12 min", "in 2 h", "in 3 days" (§4.9.6 Coming up). */
export function dueWords(at: number, now: number): string {
  const min = Math.round((at - now) / 60_000);
  if (min <= 0) {
    return "due";
  }
  if (min < 60) {
    return `in ${min} min`;
  }
  const hours = Math.round(min / 60);
  return hours < 24 ? `in ${hours} h` : `in ${Math.round(hours / 24)} days`;
}

/** cron.list jobs: enabled ones with a next run, soonest first, at most 8 (§4.9.6 Coming up). */
export function comingUp(jobs: unknown[], now = Date.now()): { name: string; when: string }[] {
  return jobs
    .map(rec)
    .filter((j) => j.enabled !== false && num(rec(j.state).nextRunAtMs) > 0)
    .sort((a, b) => num(rec(a.state).nextRunAtMs) - num(rec(b.state).nextRunAtMs))
    .slice(0, 8)
    .map((j) => ({ name: str(j.displayName) || str(j.name) || str(j.id), when: dueWords(num(rec(j.state).nextRunAtMs), now) }));
}

export type UpdateInfo = { current: string; latest: string | null; notes: string[]; installing: boolean; waiting: string | null; statusMessage?: string };

/** "3 days, 4 hours" (§4.9.3 "Up <uptime>"). */
export function uptimeWords(ms: number): string {
  const min = Math.floor(ms / 60_000);
  const days = Math.floor(min / 1440), hours = Math.floor((min % 1440) / 60), mins = min % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (days) {
    return hours ? `${part(days, "day")}, ${part(hours, "hour")}` : part(days, "day");
  }
  if (hours) {
    return mins ? `${part(hours, "hour")}, ${part(mins, "minute")}` : part(hours, "hour");
  }
  return part(Math.max(1, mins), "minute");
}
