import type { Block } from "../thread/model";
import { historyToBlocks } from "../thread/history";
import { emojisForTopics } from "./topic-emoji-logic";
import { shortTopicTitle } from "./TopicRail";
import { distinctNames, readableTitle } from "./topic-name";

export type TopicTranscript = { key: string; title: string; labelled?: boolean; updatedAt: number; preview: string; blocks: Block[] };
const at = (block: Block, fallback: number, index: number) => ("meta" in block ? block.meta?.timestamp : undefined) || ("at" in block ? block.at : undefined) || fallback + index;

/** The preview's All view: one time-ordered stream, with a source label each time the thread changes. */
export function mergeTopicTranscripts(transcripts: readonly TopicTranscript[], picks: Record<string, string> = {}): Block[] {
  const icons = emojisForTopics(transcripts.slice(1).map(({ key, title, labelled, preview }) => ({ key, title: labelled ? readableTitle(title) : shortTopicTitle(title), body: `${title} ${preview}` })), picks);
  const names = distinctNames(transcripts.slice(1).map((t) => ({ key: t.key, name: t.labelled ? readableTitle(t.title) : shortTopicTitle(t.title) })));
  const events = transcripts.flatMap((transcript, group) => transcript.blocks.map((block, index) => ({ group, source: transcript, block, at: at(block, transcript.updatedAt, index), index })));
  events.sort((a, b) => a.at - b.at || a.group - b.group || a.index - b.index);
  let previous = -1;
  const merged: Block[] = [];
  for (const event of events) {
    if (event.group !== previous) {
      merged.push({ kind: "notice", key: `topic-label:${event.source.key}:${merged.length}`, topicKey: event.source.key, text: `${event.group === 0 ? "💬" : icons[event.source.key] || "💬"} ${event.group === 0 ? "General" : names.get(event.source.key) ?? event.source.title}`, at: event.at });
      previous = event.group;
    }
    merged.push({ ...event.block, key: `${event.source.key}:${event.block.key}` });
  }
  return merged;
}

/** Blocks read for one thread, valid while its row still shows the same activity (updatedAt and preview). */
export type TopicTranscriptCache = Map<string, { signature: string; blocks: Block[] }>;

/**
 * Reads each thread's transcript for the All view. A thread whose row has not changed since its last read
 * reuses those blocks, so a live update reads only the threads that moved, not every thread again.
 */
export async function loadAllTopicTranscripts(
  request: (method: string, params: unknown) => Promise<unknown>,
  main: { key: string; title: string; updatedAt: number; preview: string },
  topics: readonly { key: string; title: string; labelled?: boolean; updatedAt: number; preview: string }[],
  picks: Record<string, string> = {},
  cache: TopicTranscriptCache = new Map(),
): Promise<Block[]> {
  const sources = [main, ...topics];
  const transcripts = await Promise.all(sources.map(async (source) => {
    const signature = `${source.updatedAt}\u0000${source.preview}`;
    const cached = cache.get(source.key);
    if (cached?.signature === signature) return { ...source, blocks: cached.blocks };
    const result = await request("chat.history", { sessionKey: source.key }) as { messages?: unknown[] };
    const blocks = historyToBlocks(Array.isArray(result.messages) ? result.messages : [], [], source.key, null);
    cache.set(source.key, { signature, blocks });
    return { ...source, blocks };
  }));
  return mergeTopicTranscripts(transcripts, picks);
}

/**
 * Runs `run` at most once at a time. Triggers that arrive while a run is in flight collapse into one
 * follow-up run after it settles, so a burst of live events cannot start overlapping loads.
 */
export function createSerialReloader(run: () => Promise<void>): { trigger(): void; cancel(): void } {
  let inFlight = false;
  let queued = false;
  let cancelled = false;
  const pump = (): void => {
    if (cancelled) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    void run().catch(() => undefined).finally(() => {
      inFlight = false;
      if (queued && !cancelled) {
        queued = false;
        pump();
      }
    });
  };
  return { trigger: pump, cancel: () => { cancelled = true; } };
}
