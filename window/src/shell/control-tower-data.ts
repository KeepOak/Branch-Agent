// Control tower readers ported from design/spec-v23/index.html towerHtmlT5.
// Live numbers come from usage.status, cron.list and the conversation list; sample preview rows are never shown.
import type { Conversation } from "../connect/conversations";
import { scheduleWords } from "../places/automations/model";
import { agents, runMs, runs } from "../places/overview/engine";
import { runLength } from "../places/overview/format";
import { ageWords, clockWords, readLimits, type Limits } from "./status-data";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Preview: used ≥ 85% is "nearly used up" (towerHtmlT5 health). */
const NEARLY = 15;
/** Preview: used ≥ 60% warms the meter. */
const WARM_LEFT = 40;

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

export type TowerAccount = {
  id: string;
  email: string;
  name: string;
  plan: string;
  provider: string;
  windowLabel: string;
  fiveLeft: number | null;
  reset: string;
  weekLeft: number | null;
  heat: "hot" | "warm" | "";
  meter: number;
  line: string;
};

/** Preview's "5-hour" / "Week" from status-data's "This 5-hour window" / "This week". */
export function shortWindow(name: string): string {
  const hours = /(\d+)-hour/i.exec(name);
  if (hours) return `${hours[1]}-hour`;
  if (/week/i.test(name)) return "Week";
  return name.replace(/^This\s+/i, "").replace(/\s+window$/i, "") || name;
}

/** One Accounts row per connection, using status-data's left-percent windows. */
export function towerAccounts(limits: Limits | null): TowerAccount[] {
  return (limits?.rows ?? []).map((row) => {
    const primary = row.windows.find((window) => /5-hour/i.test(window.name)) ?? row.windows[0];
    const week = row.windows.find((window) => /week/i.test(window.name));
    const fiveLeft = primary ? primary.left : null;
    return {
      id: row.id,
      email: row.email || row.name,
      name: row.name,
      plan: row.plan || "",
      provider: row.provider || "",
      windowLabel: primary ? shortWindow(primary.name) : "",
      fiveLeft,
      reset: primary?.reset ?? "",
      weekLeft: week ? week.left : null,
      heat: fiveLeft !== null && fiveLeft <= NEARLY ? "hot" : fiveLeft !== null && fiveLeft <= WARM_LEFT ? "warm" : "",
      meter: fiveLeft !== null ? Math.max(fiveLeft, 1) : 0,
      line: row.line,
    };
  });
}

export function checkedLine(updatedAt: number, now = Date.now()): string {
  return `checked ${ageWords(updatedAt, now)}`;
}

export type TowerComing = { id: string; name: string; when: string; trunkId: string };

/** Next 3 enabled automations, soonest first (towerHtmlT5 Coming up). */
export function towerComingUp(jobs: unknown[], now = Date.now()): TowerComing[] {
  return jobs
    .map(rec)
    .filter((job) => job.enabled !== false && num(rec(job.state).nextRunAtMs) > 0)
    .sort((a, b) => num(rec(a.state).nextRunAtMs) - num(rec(b.state).nextRunAtMs))
    .slice(0, 3)
    .map((job) => {
      const schedule = rec(job.schedule);
      return {
        id: str(job.id) || str(job.name),
        name: str(job.displayName) || str(job.name) || str(job.id),
        when: str(schedule.kind) ? scheduleWords(schedule) : dueFallback(num(rec(job.state).nextRunAtMs), now),
        trunkId: str(job.agentId),
      };
    });
}

function dueFallback(at: number, now: number): string {
  if (!at) return "";
  const min = Math.round((at - now) / 60_000);
  if (min <= 0) return "due";
  if (min < 60) return `in ${min} min`;
  const hours = Math.round(min / 60);
  return hours < 24 ? `in ${hours} h` : `in ${Math.round(hours / 24)} days`;
}

/** Percent a working job reports in its headline, or null when the engine has not said. */
export function jobProgress(...texts: (string | undefined)[]): number | null {
  for (const text of texts) {
    const match = /(\d{1,3})\s*%/.exec(text ?? "");
    if (!match) continue;
    const n = Number(match[1]);
    if (n <= 100) return n;
  }
  return null;
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

export type TowerFinished = { key: string; title: string; agentId?: string; duration: string; when: string };

/** Session keys that left Working now: that conversation's run just ended. */
export function justEndedKeys(wasWorking: readonly string[], rows: Conversation[]): string[] {
  const working = new Set(rows.filter((row) => row.working && !row.archived && !row.helper && !row.system).map((row) => row.key));
  return wasWorking.filter((key) => !working.has(key));
}

function visibleFinished(row: Conversation | undefined): row is Conversation {
  return Boolean(row && !row.archived && !row.helper && !row.system);
}

/** Last four finished runs, newest first, one per conversation (preview history / Overview recentActivity). */
export function towerFinished(rows: Conversation[], audit: unknown, now = Date.now(), endedKeys: readonly string[] = []): TowerFinished[] {
  const runList = runs(audit);
  const finishedRuns = [...runList].filter((run) => run.finishedAt !== undefined).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  const seen = new Set<string>();
  const out: TowerFinished[] = [];
  const take = (row: Conversation, run?: (typeof runList)[number], at?: number) => {
    if (!visibleFinished(row) || seen.has(row.key)) return;
    seen.add(row.key);
    const ms = run ? runMs(run) : undefined;
    out.push({
      key: row.key,
      title: row.title,
      agentId: row.agentId,
      duration: ms !== undefined ? runLength(ms) : "",
      when: towerClock(at ?? run?.finishedAt ?? row.updatedAt, now),
    });
  };
  for (const key of endedKeys) {
    const row = rows.find((item) => item.key === key);
    if (!row) continue;
    take(row, finishedRuns.find((run) => run.sessionKey === key), row.updatedAt);
    if (out.length >= 4) return out;
  }
  for (const run of finishedRuns) {
    const row = rows.find((item) => item.key === run.sessionKey);
    if (!row) continue;
    take(row, run, run.finishedAt);
    if (out.length >= 4) return out;
  }
  return out;
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

export type TowerChatter = { key: string; text: string };

/** Group-chat previews only. sessions.list has no last-message sender, so A → B is never invented. */
export function towerChatter(rows: Conversation[]): TowerChatter[] {
  return rows
    .filter((row) => row.groupChat && !row.archived && row.preview)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4)
    .map((row) => ({ key: row.key, text: row.preview }));
}

export function readLocked(result: unknown): boolean {
  return rec(rec(rec(result).config).security).lockdown === true;
}

export function readCronJobs(result: unknown): unknown[] {
  const jobs = rec(result).jobs;
  return Array.isArray(jobs) ? jobs : [];
}

export function readUsage(result: unknown, now = Date.now()): Limits {
  return readLimits(result, now);
}

export function trunkList(result: unknown): { defaultId: string; list: { id: string; name: string }[] } {
  const read = agents(result);
  return { defaultId: read.defaultId, list: read.list.map((row) => ({ id: row.id, name: row.name })) };
}

export function openTowerPlace(place: string, tab?: string): void {
  window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place, ...(tab ? { tab } : {}) } }));
}

export function openTowerSettings(page: string): void {
  window.dispatchEvent(new CustomEvent("branch:navigate-settings", { detail: { page } }));
}
