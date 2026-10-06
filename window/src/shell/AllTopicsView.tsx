import { useEffect, useMemo, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { loadCompleteTranscript } from "../transcript-export/load";
import type { TopicListItem } from "./contact-topics";

type Row = { key: string; topicKey: string; title: string; emoji: string; at: number; from: string; text: string };

/** Telegram-style All: a read-only interleaving of the contact thread and each topic's stored messages. */
export function AllTopicsView({ engine, generalKey, contactName, topics, onOpen }: { engine: WindowEngine; generalKey: string; contactName: string; topics: TopicListItem[]; onOpen: (key: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const sources = useMemo(() => [{ key: generalKey, title: "General", emoji: "💬" }, ...topics.map(({ topic }) => ({ key: topic.key, title: topic.title, emoji: topic.emoji ?? "💬" }))], [generalKey, topics]);
  const sourceKey = sources.map((source) => `${source.key}:${source.title}:${source.emoji}`).join("\0");
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError("");
    Promise.all(sources.map(async (source) => {
      const blocks = await loadCompleteTranscript(engine, source.key, abort.signal);
      return blocks.flatMap((block, index): Row[] => {
        if ((block.kind !== "user" && block.kind !== "text") || !block.text.trim()) return [];
        return [{ key: `${source.key}:${block.key}:${index}`, topicKey: source.key, title: source.title, emoji: source.emoji,
          at: block.meta?.timestamp ?? 0, from: block.kind === "user" ? "You" : contactName, text: block.text }];
      });
    })).then((groups) => { if (!abort.signal.aborted) { setRows(groups.flat().sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))); setLoading(false); } },
      (cause: unknown) => { if (!abort.signal.aborted) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); } });
    return () => abort.abort();
    // The key changes only when the contact's topics change. Opening All deliberately reads fresh history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, generalKey, sourceKey]);
  return <section className="topic-all-view" aria-label={`All threads with ${contactName}`}>
    <h2>All</h2>
    {loading ? <p>Loading threads…</p> : error ? <p role="alert">Couldn’t load every thread: {error}</p> : !rows.length ? <p>No messages in these threads yet.</p> : rows.map((row) => <article key={row.key}>
      <button type="button" className="topic-all-label" onClick={() => onOpen(row.topicKey)}>{row.emoji} {row.title}</button>
      <p><b>{row.from}:</b> {row.text}</p>
    </article>)}
  </section>;
}
