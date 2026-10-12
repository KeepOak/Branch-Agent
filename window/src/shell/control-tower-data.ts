// Right now (Control tower) readers: health from usage.status and lockdown from config, Needs you from approvals and questions.
import type { Conversation } from "../connect/conversations";
import { clockWords, readLimits, type Limits } from "./status-data";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Preview: used ≥ 85% is "nearly used up" (towerHtmlT5 health). */
const NEARLY = 15;
/** Preview: used ≥ 60% warms the meter. */

export type HealthTone = "ok" | "warn" | "bad" | "";

/** Preview towerHtmlT5: all-clear only after a real healthy usage.status with at least one account. */
export function towerHealth(locked: boolean, checking: boolean, limits: Limits | null, failed = false): { tone: HealthTone; text: string } {
  if (locked) return { tone: "bad", text: "Lockdown is on. Trunks can only read." };
  if (checking || (!failed && limits == null)) return { tone: "", text: "Checking every account…" };
  if (failed || limits == null) return { tone: "warn", text: "Couldn’t check accounts right now. Branch will try again." };
  if (limits.rows.length === 0) return { tone: "", text: "No accounts connected yet." };
  const low = limits.rows.some((row) => {
    const five = row.windows.find((window) => /5-hour/i.test(window.name)) ?? row.windows[0];
    return Boolean(five && five.left <= NEARLY);
  });
  return low
    ? { tone: "warn", text: "One account is nearly used up. Everything else is fine." }
    : { tone: "ok", text: "Everything is running fine." };
}

export function towerClock(at: number, now = Date.now()): string {
  if (!at) return "";
  const when = new Date(at);
  const today = new Date(now);
  if (when.toDateString() === today.toDateString()) return clockWords(when);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (now - at < 6 * 86_400_000) return days[when.getDay()] ?? clockWords(when);
  return clockWords(when);
}

export type TowerNeedKind = "approval" | "question" | "waiting";

export type TowerNeed = {
  id: string;
  kind: TowerNeedKind;
  title: string;
  sub: string;
  who: string;
  sessionKey: string;
  item?: Record<string, unknown>;
};

function questionLines(item: Record<string, unknown>): { title: string; header: string } {
  const first = rec(Array.isArray(item.questions) ? item.questions[0] : undefined);
  return {
    title: str(first.question) || str(item.question) || "Needs your yes",
    header: str(first.header) || str(item.command) || str(item.cmd),
  };
}

/** Preview towerHtmlT5 needItems: approvals, pending asks, then other waiting rows. Never invents rows. */
export function towerNeeds(
  rows: Conversation[],
  approvals: Record<string, unknown>[],
  questions: Record<string, unknown>[],
  trunkName: (id?: string) => string,
): TowerNeed[] {
  const used = new Set<string>();
  const out: TowerNeed[] = [];
  for (const item of approvals) {
    const request = rec(item.request);
    const sessionKey = str(request.sessionKey);
    const who = trunkName(str(request.agentId));
    const title = str(request.title) || str(request.commandPreview) || str(request.command) || str(request.description) || "A Trunk needs your answer";
    const id = `approval:${str(item.kind)}:${str(item.id)}`;
    if (sessionKey) used.add(sessionKey);
    out.push({
      id,
      kind: "approval",
      title,
      sub: [who, str(request.description) || str(item.kind)].filter(Boolean).join(" · "),
      who,
      sessionKey,
      item,
    });
  }
  for (const item of questions) {
    if (str(item.status) && str(item.status) !== "pending") continue;
    const sessionKey = str(item.sessionKey);
    const who = trunkName(str(item.agentId));
    const { title, header } = questionLines(item);
    const id = `question:${str(item.id)}`;
    if (sessionKey) used.add(sessionKey);
    out.push({
      id,
      kind: "question",
      title,
      sub: [who, header].filter(Boolean).join(" · "),
      who,
      sessionKey,
      item,
    });
  }
  for (const row of rows) {
    if (!row.needsYou || row.archived || row.system || used.has(row.key)) continue;
    const who = trunkName(row.agentId);
    out.push({
      id: `waiting:${row.key}`,
      kind: "waiting",
      title: row.headline || row.preview || row.title || "Waiting for your answer",
      sub: who,
      who,
      sessionKey: row.key,
    });
  }
  return out;
}

export function readLocked(result: unknown): boolean {
  return rec(rec(rec(result).config).security).lockdown === true;
}

export function readUsage(result: unknown, now = Date.now()): Limits {
  return readLimits(result, now);
}
