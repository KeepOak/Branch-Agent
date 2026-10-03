// The profile's reads: the Trunk's row and config entry, its automations (cron.list) and its recent conversations.
import type { WindowEngine } from "../../connect/engine";
import { parseFacts } from "../library/memory-data";
import { loadTrunkData, type TrunkData } from "./data";
import { entryOf, rec, str, strs } from "./model";

export type Automation = { id: string; name: string; when: string; enabled: boolean };
/** `facts`: the bullets in its MEMORY.md (agents.files.get), as Library › Memory counts them; null when unread. */
/** `working`: what one of its conversations is doing now ("" when it says nothing), or null when none is running. */
export type ProfileData = TrunkData & { automations: Automation[] | null; week: number | null; facts: number | null; working: string | null; notes: string[] };

const DAY = 86_400_000;
/** sessions.list is paged; a full page could hide more, so the count shows only when the page wasn't full. */
const WEEK_LIMIT = 500;
const pad = (n: number) => String(n).padStart(2, "0");

/** A cron schedule in words: "Every day at 08:00", "Every 30 min", "Once on …", else the expression. */
export function scheduleText(schedule: unknown): string {
  const s = rec(schedule), kind = str(s.kind);
  if (kind === "every" && typeof s.everyMs === "number") {
    const min = Math.round(s.everyMs / 60000);
    return min % 60 ? `Every ${min} min` : `Every ${min / 60 === 1 ? "hour" : `${min / 60} hours`}`;
  }
  if (kind === "at") return `Once on ${new Date(str(s.at) || Number(s.atMs)).toLocaleString()}`;
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(str(s.expr));
  if (daily) return `Every day at ${pad(+daily[2])}:${pad(+daily[1])}`;
  return str(s.expr) || "On a schedule";
}

export function readAutomations(result: unknown, agentId: string): Automation[] {
  const jobs = Array.isArray(rec(result).jobs) ? (rec(result).jobs as unknown[]).map(rec) : [];
  return jobs.filter((j) => str(j.agentId) === agentId).map((j) => ({ id: str(j.id), name: str(j.displayName) || str(j.name), when: scheduleText(j.schedule), enabled: j.enabled === true }));
}

/** Whether a conversation with this Trunk is running now, with what its run says it is doing (sessions.list). */
export function readWorking(result: unknown, agentId: string): string | null {
  const rows = Array.isArray(rec(result).sessions) ? (rec(result).sessions as unknown[]).map(rec) : [];
  const run = rows.find((r) => (str(r.agentId) || str(r.key).split(":")[1]) === agentId && r.hasActiveRun === true);
  return run ? str(rec(run.observerDigest).headline) : null;
}

/** Conversations with this Trunk that changed in the last 7 days (sessions.list keys are agent:<id>:…). */
export function readWeek(result: unknown, agentId: string, now: number): number | null {
  const rows = Array.isArray(rec(result).sessions) ? (rec(result).sessions as unknown[]).map(rec) : [];
  if (rows.length >= WEEK_LIMIT) return null;
  return rows.filter((r) => (str(r.agentId) || str(r.key).split(":")[1]) === agentId && typeof r.updatedAt === "number" && now - r.updatedAt <= 7 * DAY).length;
}

export async function loadProfile(engine: WindowEngine, agentId: string): Promise<ProfileData> {
  const [base, cron, sessions, memory] = await Promise.all([
    loadTrunkData(engine),
    engine.request("cron.list", { agentId, includeDisabled: true }).then((r) => ({ r }), (e: unknown) => ({ e })),
    engine.request("sessions.list", { activeMinutes: 7 * 24 * 60, excludeSubagents: true, excludeCron: true, limit: WEEK_LIMIT }).then((r) => ({ r }), (e: unknown) => ({ e })),
    engine.request("agents.files.get", { agentId, name: "MEMORY.md" }).then((r) => ({ r }), (e: unknown) => ({ e })),
  ]);
  const notes = [...base.partial];
  if ("e" in cron) notes.push(`Automations: ${String(cron.e instanceof Error ? cron.e.message : cron.e)}`);
  if ("e" in sessions) notes.push(`Conversations: ${String(sessions.e instanceof Error ? sessions.e.message : sessions.e)}`);
  return {
    ...base,
    automations: "r" in cron ? readAutomations(cron.r, agentId) : null,
    week: "r" in sessions ? readWeek(sessions.r, agentId, Date.now()) : null,
    facts: "r" in memory ? readFacts(memory.r, agentId) : null,
    working: "r" in sessions ? readWorking(sessions.r, agentId) : null,
    notes,
  };
}

/** How many things a Trunk remembers: MEMORY.md's top-level bullets; a missing file is none. */
export function readFacts(result: unknown, agentId: string): number | null {
  const file = rec(rec(result).file);
  if (!Object.keys(file).length) return null;
  return file.missing === true ? 0 : parseFacts(str(file.content), agentId, "").length;
}

/** "All" or "<n> chosen": the Trunk's own skill list in its config entry. */
export function skillsLine(data: TrunkData, agentId: string): string {
  const skills = entryOf(data.snap, agentId).skills;
  return Array.isArray(skills) ? `${strs(skills).length} chosen` : "All";
}
