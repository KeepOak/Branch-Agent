// What the side pane's Activity and Timeline tabs show, read from the conversation's blocks (chat.history and the
// live run). Nothing here is invented: a value the engine didn't record is left out.
import type { Block } from "../../thread/model";
import { recordedAt } from "../../thread/model";

/** Last observation in transcript/event order; never the renderer's mount time. */
export function activityRecordedAt(blocks: readonly Block[]): number | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const value = block.kind === "step" ? block.at : block.kind === "text" || block.kind === "user" ? block.meta?.timestamp : undefined;
    const at = recordedAt(value).at;
    if (at !== undefined) return at;
  }
  return undefined;
}

export type TimelineKind = "model" | "tool" | "ok" | "help" | "you";
export type TimelineItem = {
  key: string;
  kind: TimelineKind;
  title: string;
  /** Who did it and what it was about, one line. */
  line: string;
  /** The tool or model id, shown at Technical. */
  tech?: string;
  cost?: number;
  tokensIn?: number;
  tokensOut?: number;
  had?: string;
  happened?: string;
  status?: string;
  at?: number;
};

const firstLine = (text: string, max = 160) => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** Each step, answer, approval and message in order, as the Timeline lists them. */
export function timelineItems(blocks: Block[], name: string): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const b of blocks) {
    if (b.kind === "user") out.push({ key: b.key, kind: "you", title: "You wrote", line: firstLine(b.text), at: b.meta?.timestamp });
    else if (b.kind === "text" && !b.streaming && b.text.trim())
      out.push({
        key: b.key,
        kind: "model",
        title: "Wrote a reply",
        line: [name, b.meta?.model].filter(Boolean).join(" · "),
        tech: b.meta?.provider && b.meta.model ? `${b.meta.provider}/${b.meta.model}` : b.meta?.model,
        cost: b.meta?.usage?.cost,
        tokensIn: b.meta?.usage?.input,
        tokensOut: b.meta?.usage?.output,
        happened: firstLine(b.text, 240),
        at: b.meta?.timestamp,
      });
    else if (b.kind === "step")
      out.push({
        key: b.key,
        kind: /spawn|subagent|sessions_spawn/i.test(b.tool) ? "help" : "tool",
        title: b.title,
        line: [name, firstLine(b.detail)].filter(Boolean).join(" · "),
        tech: b.tool,
        had: firstLine(b.detail, 240) || undefined,
        happened: b.output ? firstLine(b.output, 240) : undefined,
        status: b.status,
        ...recordedAt(b.at),
      });
    else if (b.kind === "approval")
      out.push({
        key: b.key,
        kind: "ok",
        title: b.approval.command,
        line: [name, b.approval.state === "allowed" ? "Allowed" : b.approval.state === "denied" ? "You said no" : "Waiting for you"].join(" · "),
        status: b.approval.state,
      });
  }
  return out;
}

export type Summary = { steps: number; ms?: number; cost?: number };

/** "11 steps · 1m 56s so far · $0.37": the duration from the first to the last timestamp (or now while working). */
export function timelineSummary(items: TimelineItem[], running: boolean, now = Date.now()): Summary {
  const times = items.map((i) => i.at).filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  const costs = items.map((i) => i.cost).filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  const start = times.length ? Math.min(...times) : undefined;
  const end = running ? now : times.length ? Math.max(...times) : undefined;
  return {
    steps: items.length,
    ...(start !== undefined && end !== undefined && end >= start ? { ms: end - start } : {}),
    ...(costs.length ? { cost: costs.reduce((a, b) => a + b, 0) } : {}),
  };
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const money = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`;

export function summaryLine(s: Summary, running: boolean): string {
  return [`${s.steps} step${s.steps === 1 ? "" : "s"}`, s.ms !== undefined ? `${duration(s.ms)}${running ? " so far" : ""}` : "", s.cost !== undefined ? money(s.cost) : ""].filter(Boolean).join(" · ");
}

export type ActivityState = { tone: "work" | "wait" | "idle"; text: string };

/** The Activity tab's first line: what the Trunk is doing right now. */
export function activityState(running: boolean, waiting: number): ActivityState {
  if (waiting > 0) return { tone: "wait", text: "Waiting on you" };
  if (running) return { tone: "work", text: "Working" };
  return { tone: "idle", text: "Not working" };
}
