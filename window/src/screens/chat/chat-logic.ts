// Pure rules of the R1 conversation (HANDOFF R1-03): when a time divider shows, how a reply streams in as words,
// what the steps summary says, and which "Show agents' work as" mode applies. Kept out of the components so tests
// read them directly.
import { useCallback, useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { stepsSummary } from "../../thread/format";
import type { Item } from "../../thread/layout";
import type { Block } from "../../thread/model";

type Step = Extract<Block, { kind: "step" }>;
type Thought = Extract<Block, { kind: "thinking" }>;

/** A centred time divider shows when 15 minutes have passed or the day changed (HANDOFF R1-03 "Time dividers"). */
export const DIVIDER_GAP_MS = 15 * 60_000;

/** When the engine recorded the block, if it did. */
export function blockTime(block: Block): number | undefined {
  const at = block.kind === "user" || block.kind === "text" || block.kind === "steer" ? block.meta?.timestamp
    : block.kind === "notice" || block.kind === "step" ? block.at : undefined;
  return typeof at === "number" && Number.isFinite(at) && at > 0 ? at : undefined;
}

/** The positions (indexes into "times") that get a divider before them. A divider never follows another divider:
 *  "after" marks positions that already open with a centred line of their own (a topic or exchange line). */
export function dividerPositions(times: readonly (number | undefined)[], opensWithLine: ReadonlySet<number> = new Set()): Set<number> {
  const out = new Set<number>();
  let last: number | undefined;
  times.forEach((at, i) => {
    if (at === undefined) return;
    const fresh = last === undefined || at - last >= DIVIDER_GAP_MS || new Date(at).toDateString() !== new Date(last).toDateString();
    if (fresh && !opensWithLine.has(i)) out.add(i);
    last = at;
  });
  return out;
}

/** "Today 4:37 PM", "Yesterday 9:02 AM", else "Thu, Oct 8 4:37 PM" (and the year when it isn't this year). */
export function dividerLabel(at: number, now = Date.now()): string {
  const d = new Date(at), today = new Date(now);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return "Today " + time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday " + time;
  const date = d.toLocaleDateString([], d.getFullYear() === today.getFullYear()
    ? { weekday: "short", month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return date + " " + time;
}

/** A streaming reply as word tokens (each keeps its trailing space), so words already shown keep their element and
 *  only new words fade in. Paragraph breaks are their own tokens. */
export function streamTokens(text: string): string[] {
  return text.match(/\n+|[^\s]+[^\S\n]*|[^\S\n]+/g) ?? [];
}

/** The steps' one plain line: what runs now ("Opened Outlook on the web…" · "3 so far"), or what was done.
 *  "failed" counts the steps that failed; "took" is the run's length when the turn finished. */
export function stepsLine(steps: readonly Step[]): { text: string; meta: string; failed: number; live: boolean } {
  const running = steps.find((s) => s.status === "running");
  const failed = steps.filter((s) => s.status === "failed").length;
  if (running) return { text: stepsSummary([running]) + "…", meta: steps.length + " so far", failed, live: true };
  const text = stepsSummary(steps).replace(/ · .*$/, "");
  // A finished run shows its step count only; the elapsed clock belongs to a step that is still running.
  const count = steps.length === 1 ? "1 step" : steps.length + " steps";
  return { text, meta: count, failed, live: false };
}

/** Regular's one quiet link on the steps: the count alone ("6 steps", "3 steps so far"), never the step words. */
export function stepCount(n: number, live: boolean): string {
  const words = n === 1 ? "1 step" : n + " steps";
  return live ? words + " so far" : words;
}

/** "Show agents' work as" (owner item 26): Normal hides thoughts, Thinking adds them as quiet rows inside the steps,
 *  Verbose opens every fold. Settings keeps the default; a conversation can differ. */
export type WorkMode = "normal" | "thinking" | "verbose";
export const WORK_MODES: readonly { id: WorkMode; label: string }[] = [
  { id: "normal", label: "Normal" }, { id: "thinking", label: "Thinking" }, { id: "verbose", label: "Verbose" },
];
/** users.prefs keys: the Settings default, and the per-conversation choices keyed by session key. */
export const WORK_KEY = "conversation.showWork";
export const WORK_PER_KEY = "conversation.showWorkPer";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asMode = (v: unknown): WorkMode | null => (v === "normal" || v === "thinking" || v === "verbose" ? v : null);

export function readWorkMode(entries: Record<string, unknown>, sessionKey: string | null | undefined): { mode: WorkMode; global: WorkMode; override: WorkMode | null } {
  const global = asMode(entries[WORK_KEY]) ?? "normal";
  const override = sessionKey ? asMode(rec(entries[WORK_PER_KEY])[sessionKey]) : null;
  return { mode: override ?? global, global, override };
}

/** The mode for one conversation, kept current from users.prefs.changed; setOverride writes users.prefs.set. */
export function useWorkMode(engine: WindowEngine | undefined, sessionKey: string | null | undefined) {
  const [entries, setEntries] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (!engine) return;
    let on = true;
    const load = () => engine.request("users.prefs.get", { keys: [WORK_KEY, WORK_PER_KEY] }).then(
      (r) => { if (on && rec(r).status === "ok") setEntries(rec(rec(r).entries)); },
      () => undefined, // The default (Normal) stands until the engine answers.
    );
    void load();
    const off = engine.onEvent((e) => { if (e.event === "users.prefs.changed") void load(); });
    return () => { on = false; off(); };
  }, [engine]);
  const setOverride = useCallback(async (mode: WorkMode | null) => {
    if (!engine || !sessionKey) return;
    const per = { ...rec(entries[WORK_PER_KEY]) };
    if (mode) per[sessionKey] = mode; else delete per[sessionKey];
    setEntries((old) => ({ ...old, [WORK_PER_KEY]: per }));
    await engine.request("users.prefs.set", { entries: { [WORK_PER_KEY]: per } });
  }, [engine, sessionKey, entries]);
  return { ...readWorkMode(entries, sessionKey), setOverride };
}

/** Plain words from Markdown: no marks, links as their text. */
export function plainText(markdown: string): string {
  return markdown.replace(/```[\w-]*\n?/g, "").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|\*|_|~~|`)/g, "").trim();
}

/** One drawn entry: a laid-out item, or a steps fold that carries the thoughts around it. */
export type Entry =
  | { type: "item"; item: Extract<Item, { type: "block" }> }
  | { type: "steps"; key: string; steps: Step[]; thoughts: Thought[]; face: boolean; run?: { title: string; durationMs?: number } }
  | { type: "thought"; key: string; thought: Thought };

/** Thoughts become quiet rows inside the steps they sit beside (owner item 26), never blocks of their own. */
export function entriesOf(items: readonly Item[]): Entry[] {
  const out: Entry[] = [];
  let waiting: Thought[] = [];
  let open: Extract<Entry, { type: "steps" }> | null = null;
  for (const item of items) {
    if (item.type === "steps") {
      open = { type: "steps", key: item.key, steps: item.steps, thoughts: waiting, face: item.face, run: item.run };
      waiting = [];
      out.push(open);
    } else if (item.block.kind === "thinking") {
      if (open) open.thoughts = [...open.thoughts, item.block];
      else waiting.push(item.block);
    } else {
      open = null;
      out.push(...waiting.map((thought): Entry => ({ type: "thought", key: thought.key, thought })));
      waiting = [];
      out.push({ type: "item", item });
    }
  }
  out.push(...waiting.map((thought): Entry => ({ type: "thought", key: thought.key, thought })));
  return out;
}
