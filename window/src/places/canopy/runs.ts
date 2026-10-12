// Canopy › Now's one list of runs (§4.6.7): each run's column comes from its engine state, never from a drag.
import { rec, str, type Row } from "../automations/runtime";
import {
  cardBoard, computerOf, goalOf, helpersOf, isArchived, isHelper, isRunning, meterOf, modelOf, personOf,
  sessionsBoardIds, sessionTitle, stepOf, whyOf, type CanopyData, type Run, type Why,
} from "./data";

const who = (row: Row) => personOf(row)?.id ?? "";
const titleOf = (req: Row) => str(req.title) || str(req.commandPreview) || str(req.command) || str(req.description);

function sessionRuns(d: CanopyData): Run[] {
  const out: Run[] = [], asks = new Set(d.pending.map(p => str(rec(p.request).sessionKey)));
  for (const row of d.sessions) {
    if (isHelper(row) || row.archived === true) continue;
    const key = str(row.key), goal = goalOf(row);
    const base = { agentId: str(row.agentId), who: who(row), task: sessionTitle(row), step: stepOf(row), comp: computerOf(row, d.nodes), model: modelOf(row), sessionKey: key, goal: goal ?? undefined };
    const board = d.cards.find(c => str(c.sessionKey) === key && !isArchived(c) && ["running", "review"].includes(str(c.status)));
    if (goal?.status === "paused") out.push({ ...base, key: "p:" + key, kind: "paused", col: "next", step: "Paused · nothing new starts" });
    else if (isRunning(row) && !asks.has(key)) out.push({ ...base, key: "c:" + key, kind: "chat", col: "working", since: Number(row.startedAt) || Number(row.updatedAt) || undefined, pct: meterOf(row), helpers: helpersOf(row, d.sessions, d.pending), board });
    else if (goal && ["blocked", "usage_limited", "budget_limited"].includes(str(goal.status))) {
      const why: Why = goal.status === "blocked" ? "you" : "room";
      out.push({ ...base, key: "g:" + key, kind: "goal", col: "stuck", why, detail: str(goal.lastStatusNote), step: str(goal.lastStatusNote) || base.step });
    }
  }
  return out;
}

function askRuns(d: CanopyData): Run[] {
  return d.pending.map(item => {
    const req = rec(item.request), key = str(req.sessionKey), row = d.sessions.find(s => str(s.key) === key);
    const parent = row && isHelper(row) ? d.sessions.find(s => str(s.key) === (str(row.parentSessionKey) || str(row.spawnedBy))) : row;
    return {
      key: "a:" + str(item.id), kind: "ask", col: "waiting", ask: item, agentId: str(req.agentId) || str(parent?.agentId), who: parent ? who(parent) : "",
      task: parent ? sessionTitle(parent) : titleOf(req) || "A Trunk needs your answer", step: `Waiting for you: ${titleOf(req) || "an answer"}`,
      comp: parent ? computerOf(parent, d.nodes) : "this", model: parent ? modelOf(parent) : "", sessionKey: str(parent?.key) || key || undefined,
      since: Number(item.createdAtMs) || undefined,
    } satisfies Run;
  });
}

export function inWords(ms: number, now: number): string {
  const m = Math.round((ms - now) / 60000);
  if (m < 1) return "Now";
  if (m < 60) return `In ${m} min`;
  const at = new Date(ms), same = at.toDateString() === new Date(now).toDateString();
  const hm = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return same ? `Today at ${hm}` : `${at.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} at ${hm}`;
}

function nextRuns(d: CanopyData, now: number): Run[] {
  const sched: Run[] = d.jobs.filter(j => j.enabled === true && Number(rec(j.state).nextRunAtMs) > 0 && !rec(j.state).runningAtMs).map(j => {
    const at = Number(rec(j.state).nextRunAtMs);
    return { key: "s:" + str(j.id), kind: "sched", col: "next", job: j, agentId: str(j.agentId) || d.defaultTrunk, who: "", task: str(j.displayName) || str(j.name) || "Automation", step: str(j.description), when: inWords(at, now), at, comp: "this", model: "" };
  });
  const skip = sessionsBoardIds(d.boards);
  const ready: Run[] = d.cards.filter(c => c.status === "ready" && !isArchived(c) && !skip.has(cardBoard(c))).map(c => ({
    key: "k:" + str(c.id), kind: "card", col: "next", card: c, agentId: str(c.agentId) || d.defaultTrunk, who: "", task: str(c.title), step: "Ready on the board", when: "When Start Trunks runs", comp: "this", model: "",
  }));
  return [...sched.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)), ...ready];
}

function stuckCards(d: CanopyData): Run[] {
  const skip = sessionsBoardIds(d.boards);
  return d.cards.filter(c => c.status === "blocked" && !isArchived(c) && !skip.has(cardBoard(c))).map(c => {
    const { why, detail } = whyOf(c, d.cards);
    return { key: "k:" + str(c.id), kind: "card", col: "stuck", card: c, agentId: str(c.agentId), who: "", task: str(c.title), step: detail || "Blocked", why, detail, comp: "this", model: "" };
  });
}

function doneRuns(d: CanopyData): Run[] {
  return d.runs.filter(r => r.status === "ok").map((r, i) => {
    const job = d.jobs.find(j => str(j.id) === str(r.jobId)), secs = Math.round(Number(r.durationMs) / 1000);
    const took = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
    return { key: `d:${str(r.jobId)}:${Number(r.ts)}:${i}`, kind: "sched", col: "done", job, agentId: str(job?.agentId) || d.defaultTrunk, who: "", task: str(job?.displayName) || str(job?.name) || str(r.summary) || "Automation", step: Number(r.durationMs) > 0 ? `Done in ${took}` : "Done", at: Number(r.ts), comp: "this", model: str(r.model), sessionKey: str(r.sessionKey) || undefined } satisfies Run;
  });
}

/** Conversations whose run finished today (not helpers, not ones a schedule's run already lists). */
function doneSessions(d: CanopyData, now: number, listed: Run[]): Run[] {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  return d.sessions.filter(s => s.status === "done" && Number(s.endedAt) >= midnight.getTime() && !isHelper(s) && s.archived !== true && !isRunning(s) && !listed.some(r => r.sessionKey === str(s.key))).map(s => {
    const ms = Number(s.runtimeMs), secs = Math.round(ms / 1000);
    const took = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
    return { key: "e:" + str(s.key), kind: "chat", col: "done", agentId: str(s.agentId), who: who(s), task: sessionTitle(s), step: ms > 0 ? `Done in ${took}` : "Done", at: Number(s.endedAt), comp: computerOf(s, d.nodes), model: modelOf(s), sessionKey: str(s.key) } satisfies Run;
  });
}

/** Every run Canopy shows, in column order (§4.6.7). */
export function buildRuns(d: CanopyData, now: number): Run[] {
  const done = doneRuns(d);
  const finished = [...done, ...doneSessions(d, now, done)].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return [...sessionRuns(d), ...askRuns(d), ...nextRuns(d, now), ...stuckCards(d), ...finished];
}

export type Filters = { trunk: string[]; person: string[]; comp: string[] };
export const NO_FILTERS: Filters = { trunk: [], person: [], comp: [] };
export function filterRuns(list: Run[], f: Filters): Run[] {
  return list.filter(r => (!f.trunk.length || f.trunk.includes(r.agentId)) && (!f.person.length || f.person.includes(r.who)) && (!f.comp.length || f.comp.includes(r.comp)));
}
