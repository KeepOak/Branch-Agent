import type { Block } from "../thread/model";
import { historyToBlocks } from "../thread/history";
import { emojisForTopics } from "./topic-emoji-logic";
import { shortTopicTitle } from "./TopicRail";

export type TopicTranscript = { key: string; title: string; updatedAt: number; preview: string; blocks: Block[] };
const at = (block: Block, fallback: number, index: number) => ("meta" in block ? block.meta?.timestamp : undefined) || ("at" in block ? block.at : undefined) || fallback + index;

/** The preview's All view: one time-ordered stream, with a source label each time the thread changes. */
export function mergeTopicTranscripts(transcripts: readonly TopicTranscript[], picks: Record<string, string> = {}): Block[] {
  const icons = emojisForTopics(transcripts.slice(1).map(({ key, title, preview }) => ({ key, title: shortTopicTitle(title), body: `${title} ${preview}` })), picks);
  const events = transcripts.flatMap((transcript, group) => transcript.blocks.map((block, index) => ({ group, source: transcript, block, at: at(block, transcript.updatedAt, index), index })));
  events.sort((a, b) => a.at - b.at || a.group - b.group || a.index - b.index);
  let previous = -1;
  const merged: Block[] = [];
  for (const event of events) {
    if (event.group !== previous) {
      merged.push({ kind: "notice", key: `topic-label:${event.source.key}:${merged.length}`, text: `${event.group === 0 ? "💬" : icons[event.source.key] || "💬"} ${event.group === 0 ? "General" : shortTopicTitle(event.source.title)}`, at: event.at });
      previous = event.group;
    }
    merged.push({ ...event.block, key: `${event.source.key}:${event.block.key}` });
  }
  return merged;
}

export async function loadAllTopicTranscripts(
  request: (method: string, params: unknown) => Promise<unknown>,
  main: { key: string; title: string; updatedAt: number; preview: string },
  topics: readonly { key: string; title: string; updatedAt: number; preview: string }[],
): Promise<Block[]> {
  const sources = [main, ...topics];
  const transcripts = await Promise.all(sources.map(async (source) => {
    const result = await request("chat.history", { sessionKey: source.key }) as { messages?: unknown[] };
    return { ...source, blocks: historyToBlocks(Array.isArray(result.messages) ? result.messages : [], [], source.key, null) };
  }));
  return mergeTopicTranscripts(transcripts);
}
