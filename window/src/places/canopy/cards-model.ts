// Canopy › Cards (§4.6.7 parity adds): Canopy's own nine statuses, card state lines, badges and filters,
// read from canopy.cards.list cards (engine/packages/canopy-contract CanopyCard) and the live conversations.
import type { BoardScope } from "../automations/board-route";
import { rec, rows, str, type Row } from "../automations/runtime";
import { cardBoard, isArchived, waitsFor } from "./data";

export const STATUSES: [string, string][] = [["triage", "Triage"], ["backlog", "Backlog"], ["todo", "To do"], ["scheduled", "Scheduled"], ["ready", "Ready"], ["running", "Running"], ["review", "Review"], ["blocked", "Blocked"], ["done", "Done"]];
export const statusName = (k: string) => STATUSES.find(s => s[0] === k)?.[1] ?? k;
export const PRIOS: [string, string][] = [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]];
export const prioName = (k: unknown) => PRIOS.find(p => p[0] === k)?.[1] ?? "Normal";
export const TINTS: [string, string][] = [["Default", ""], ["Slate", "#6B7A86"], ["Blue", "#4F6FA8"], ["Teal", "#2F8C86"], ["Moss", "#5E7D4A"], ["Amber", "#B7791F"], ["Rose", "#C0467A"], ["Plum", "#8A5AA8"], ["Sand", "#9C8467"]];
/** New card suggestions: the engine's templates (CANOPY_TEMPLATE_IDS) with the preview's words. */
export const SUGGESTIONS: [string, string, string, string][] = [
  ["Bug fix", "bugfix", "Fix: ", "Symptom:\nCause:\nDone when:\nProof:"], ["Docs", "docs", "Docs: ", "What to explain:\nWho reads it:\nDone when:"],
  ["Release", "release", "Release: ", "What ships:\nChecks:\nDone when:"], ["Pull request review", "pr_review", "Review: ", "Pull request:\nWhat to look at:\nDone when:"],
  ["Plugin", "plugin", "Plugin: ", "What it adds:\nWho uses it:\nDone when:"],
];

export const meta = (c: Row) => rec(c.metadata);
const attempts = (c: Row) => rows(meta(c).attempts);
export const ago = (ms: number) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };

/** The card's conversation state line and its tooltip, from its linked conversation (§4.6.7 "Card's conversation state"). */
export function convState(c: Row, sessions: Row[], now: number): [string, string] {
  const last = attempts(c).at(-1), stale = rec(meta(c).stale);
  if (!str(c.sessionKey)) return c.status === "running" && attempts(c).length ? ["Link unclear", "Edit the card to pick the exact conversation"] : ["No conversation", "Start or link one"];
  if (Number(stale.detectedAt) > 0) { const age = ago(now - (Number(stale.lastSessionUpdatedAt) || Number(stale.detectedAt))); return [`Stale · ${age}`, `No activity for ${age}`]; }
  const row = sessions.find(s => str(s.key) === str(c.sessionKey));
  if (!row) return ["Not available", ""];
  if (c.status === "done" || c.status === "review") return ["Done", ""];
  if (last?.status === "stopped") return ["Stopped", ""];
  if (/timed? ?out/i.test(str(last?.error))) return ["Timed out", ""];
  if (last?.status === "failed" || (c.status === "blocked" && Number(meta(c).failureCount) > 0)) return ["Failed", "Open the conversation to see why"];
  if (c.status === "running" || row.hasActiveRun === true) return ["Running", ""];
  return ["State unknown", ""];
}

/** Statuses a Trunk is on now or is about to be: they show in Today whatever their last change was. */
export const ACTIVE_STATUSES = ["ready", "running", "review", "blocked"];
/** Whether a card belongs in a Board scope: Today, Running (a Trunk is on it now) or All. */
export function inScope(c: Row, scope: BoardScope, now: number): boolean {
  if (scope === "running") return str(c.status) === "running";
  return scope === "all" || isToday(c, now);
}

/** Today: a card a Trunk is on now, or one that started, finished or changed since local midnight. */
export function isToday(c: Row, now: number): boolean {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const touched = Math.max(Number(c.updatedAt) || 0, Number(c.startedAt) || 0, Number(c.completedAt) || 0);
  return ACTIVE_STATUSES.includes(str(c.status)) || touched >= midnight.getTime();
}

/** Cards that wait on this one and aren't done ("<n> blocked"). */
export const blocksCount = (c: Row, cards: Row[]) => cards.filter(x => !isArchived(x) && x.status !== "done" && waitsFor(x).includes(str(c.id))).length;

export function badges(c: Row, cards: Row[]): string[] {
  const m = meta(c), labels = Array.isArray(c.labels) ? c.labels.length : 0;
  const list: [number, string][] = [
    [attempts(c).length, "attempts"], [attempts(c).filter(a => a.status === "failed").length, "failed"], [rows(m.comments).length, "notes"],
    [rows(m.links).filter(l => l.type === "relates_to").length, "links"], [rows(m.proof).length, "proof"], [rows(m.artifacts).length, "made"],
    [rows(m.attachments).length, "attachments"], [Math.max(0, labels - 2), "more labels"], [rows(m.diagnostics).length, "warnings"], [blocksCount(c, cards), "blocked"],
  ];
  return list.filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`);
}

export type CardFilters = { q: string; needs: boolean; quiet: boolean; noproof: boolean; done: "all" | "week"; prio: string[]; status: string[]; arch: boolean };
export const NO_CARD_FILTERS: CardFilters = { q: "", needs: false, quiet: false, noproof: false, done: "all", prio: [], status: [], arch: false };

/** The cards a board view shows (§4.6.7 "More filters for cards"), after Canopy's own Trunk / Computer filters. */
export function visibleCards(cards: Row[], board: string, sessionsBoards: Set<string>, F: CardFilters, trunks: string[], now: number): Row[] {
  const q = F.q.trim().toLowerCase(), week = now - 7 * 864e5;
  return cards.filter(c => (board === "all" ? !sessionsBoards.has(cardBoard(c)) : cardBoard(c) === board)
    && (F.arch || !isArchived(c)) && (!trunks.length || trunks.includes(str(c.agentId)))
    && (!q || [str(c.title), str(c.notes), ...(Array.isArray(c.labels) ? c.labels.map(String) : [])].some(x => x.toLowerCase().includes(q)))
    && (!F.needs || c.status === "blocked" || c.status === "review" || rows(meta(c).diagnostics).length > 0)
    && (!F.quiet || Number(rec(meta(c).stale).detectedAt) > 0)
    && (!F.noproof || (c.status === "done" && !rows(meta(c).proof).length && !rows(meta(c).artifacts).length && !rows(meta(c).attachments).length))
    && (F.done === "all" || c.status !== "done" || (Number(c.completedAt) || Number(c.updatedAt)) >= week)
    && (!F.prio.length || F.prio.includes(str(c.priority) || "normal")) && (!F.status.length || F.status.includes(str(c.status))));
}

/** "Start Trunks" result words, from canopy.cards.dispatch's own counts. */
export function dispatchLine(result: Row): string {
  const n = (k: string) => Array.isArray(result[k]) ? (result[k] as unknown[]).length : 0;
  const parts = [n("started"), n("promoted"), n("blocked"), n("reclaimed"), n("orchestrated"), n("startFailures")];
  if (parts.every(x => x === 0)) return "No cards were started.";
  return `Started ${parts[0]}. Made ready ${parts[1]}, blocked ${parts[2]}, released ${parts[3]}, organised ${parts[4]}. Couldn’t start ${parts[5]}.`;
}

/** A board id the engine accepts (CANOPY_BOARD_ID_PATTERN), unique among the boards. */
export function boardIdFor(name: string, boards: Row[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "").slice(0, 70) || "board";
  let id = base, i = 2;
  while (boards.some(b => str(b.id) === id)) id = `${base}-${i++}`;
  return id;
}

export const boardName = (b: Row | undefined) => !b ? "" : str(b.name) || (str(b.id) === "default" ? "Default board" : str(b.id));
