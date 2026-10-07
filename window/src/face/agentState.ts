// Which state a Trunk's face shows (DESIGN-SPEC §6.2), read from the engine's run, never guessed from words.
import type { Block } from "../thread/model";

export type AgentState = "idle" | "think" | "work" | "search" | "read" | "talk" | "wait" | "yay" | "oops" | "sleep";

/** The words for each state (state line, agent window). */
export const STATE_LABEL: Record<AgentState, string> = {
  idle: "Here",
  think: "Thinking it over",
  work: "Working on it",
  search: "Searching",
  read: "Reading",
  talk: "Explaining",
  wait: "Waiting for you",
  yay: "Done",
  oops: "Hit a snag",
  sleep: "Resting",
};

/** States that play while the action runs; arrivals play one pass; the rest are stills (§6.2). */
export const ACTION_STATES: readonly AgentState[] = ["think", "work", "search", "read", "talk"];
export const ARRIVAL_STATES: readonly AgentState[] = ["yay", "oops", "wait"];

export const DONE_MS = 7000;
export const TALK_MS = 4500;
export const IDLE_SLEEP_MS = 120_000;

/** A tool's kind of work: search or browse tools search, read tools read, any other tool works. */
export function toolState(tool: string): "search" | "read" | "work" {
  const name = tool.toLowerCase();
  if (/search|browse|browser|web_|find|grep|glob|history|lookup/.test(name)) {
    return "search";
  }
  if (/^read|_read|fetch|get$|_get|memory|open|view|cat$/.test(name)) {
    return "read";
  }
  return "work";
}

export type StateInput = {
  /** The live run's blocks, or empty when no run is going. */
  live: readonly Block[];
  running: boolean;
  /** The finished runs, newest last (the history). */
  history: readonly Block[];
  /** When the last run ended (ms), or null. */
  endedAt: number | null;
  now: number;
  paused?: boolean;
  onCall?: boolean;
  lastActivityAt?: number | null;
};

function lastRun(history: readonly Block[]): Block[] {
  const at = history.map((b) => b.kind).lastIndexOf("user");
  return history.slice(at + 1) as Block[];
}

function runningState(live: readonly Block[]): AgentState {
  for (let i = live.length - 1; i >= 0; i -= 1) {
    const b = live[i];
    if (b.kind === "step" && b.status === "running") {
      return toolState(b.tool);
    }
    if (b.kind === "text" || b.kind === "thinking" || b.kind === "status" || b.kind === "step") {
      return "think";
    }
  }
  return "think";
}

/** The first match wins, in §6.2's order of precedence. */
export function agentState(s: StateInput): AgentState {
  const since = s.endedAt === null ? Infinity : s.now - s.endedAt;
  const run = lastRun(s.history);
  const failed = !s.running && run.findLast((b) => b.kind === "error" || b.kind === "text")?.kind === "error";
  const usedTools = run.some((b) => b.kind === "step");
  const stopped = run.some((b) => b.kind === "done" && b.stopped);
  if (!s.running && !failed && !stopped && usedTools && since < DONE_MS) return "yay";
  if (failed) return "oops";
  if (s.live.some((b) => b.kind === "approval" && b.approval.state === "pending")) return "wait";
  if (s.paused) return "sleep";
  if (s.onCall) return "talk";
  if (s.running) return runningState(s.live);
  if (!usedTools && run.some((b) => b.kind === "text") && since < TALK_MS) return "talk";
  if (s.lastActivityAt && s.now - s.lastActivityAt > IDLE_SLEEP_MS && since > IDLE_SLEEP_MS) return "sleep";
  return "idle";
}
