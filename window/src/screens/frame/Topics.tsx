// The R1 topics (owner items 5, 43, 46 and 47): the Classic thread rail (shell/TopicRail.tsx), re-hosted for R1. R1 offers
// "Tabs above the chat" (the default) only for now; a saved removed layout reads as Tabs. The tabs carry the round + (New topic)
// and each topic's right-click menu. All shows every thread's messages in one stream (shell/topic-all.ts).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Topic } from "@branch/gateway-protocol";
import type { Conversation, ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { listContactTopics } from "../../shell/contacts-model";
import { loadAllTopicTranscripts } from "../../shell/topic-all";
import { r1TopicLayoutFor, setR1TopicLayout, TOPIC_LAYOUT_KEY, type R1TopicLayout } from "../../shell/topic-layout";
import { createTopicSession } from "../../shell/topic-create";
import { resetFree } from "./free-widths";
import { patchTopicSession } from "../../shell/topic-session";
import { TopicRail } from "../../shell/TopicRail";
import type { Block } from "../../thread/model";
import { coalesce } from "../../shell/coalesce";

/** The Trunk whose threads show: the open conversation's own Trunk, from its main conversation or a thread of it. */
export type TopicContact = { id: string; key: string; name: string };

const EMOJI_KEY = "branch-topic-emoji-t5";
const NARROW = "(max-width: 900px)";

/** A Trunk's own conversation is agent:<id>:<main key>; its threads name it as their parent. */
export function topicContactFor(rows: readonly Conversation[], currentKey: string | null, mainSuffix = "main", trunkName?: string): TopicContact | null {
  const current = rows.find((row) => row.key === currentKey);
  if (!current?.agentId) return null;
  const key = `agent:${current.agentId}:${mainSuffix}`;
  if (current.key !== key && current.parentKey !== key) return null;
  const main = rows.find((row) => row.key === key);
  // The Trunk's own name (Juniper), never its id (juniper): the window passes the name it shows in the title.
  return { id: `trunk:${current.agentId}`, key, name: trunkName || main?.title || current.agentId };
}

function useTopics(session: SaplingSession, ready: boolean, contactId: string | null) {
  const [state, setState] = useState<{ id: string | null; topics: Topic[]; tick: number }>({ id: null, topics: [], tick: 0 });
  useEffect(() => {
    if (!ready || !contactId) return;
    let live = true, generation = 0;
    const load = async () => {
      const current = ++generation;
      try {
        const topics = await listContactTopics(contactId, (method, params) => session.request(method, params));
        if (live && current === generation) setState((old) => ({ ...old, id: contactId, topics }));
      } catch (error) { if (live) console.warn("contacts.topics failed", error); }
    };
    void load();
    const loadSoon = coalesce(() => void load(), 3_000);
    const off = session.onGatewayEvent((event) => { if (event === "contacts.changed") loadSoon(); });
    return () => { live = false; off(); loadSoon.cancel(); };
  }, [session, ready, contactId, state.tick]);
  const topics = ready && contactId && state.id === contactId ? state.topics : [];
  return { topics, reload: () => setState((old) => ({ ...old, tick: old.tick + 1 })) };
}

function useLayout(contactId: string | null): R1TopicLayout {
  const [layout, setLayout] = useState<R1TopicLayout>(() => r1TopicLayoutFor(contactId ?? ""));
  useEffect(() => {
    const sync = () => setLayout(r1TopicLayoutFor(contactId ?? ""));
    sync();
    const storage = (event: StorageEvent) => { if (event.key === TOPIC_LAYOUT_KEY) sync(); };
    window.addEventListener("branch:topic-layout-changed", sync);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener("branch:topic-layout-changed", sync); window.removeEventListener("storage", storage); };
  }, [contactId]);
  return layout;
}

function useNarrow(): boolean {
  const media = typeof matchMedia === "function" ? matchMedia(NARROW) : null;
  const [narrow, setNarrow] = useState(() => media?.matches ?? false);
  useEffect(() => {
    const query = typeof matchMedia === "function" ? matchMedia(NARROW) : null;
    if (!query) return;
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

export type R1TopicsProps = {
  session: SaplingSession;
  ready: boolean;
  rows: readonly Conversation[];
  list: ConversationList;
  /** The open conversation, when the main column shows one. */
  currentKey: string | null;
  /** The main key after agent:<id>: (the window's main key names it). */
  mainSuffix: string;
  /** The open Trunk's display name, as the window title shows it. */
  trunkName?: string;
  onOpen: (key: string) => void;
};

/** What the window draws: the rail in the topics column or above the chat, and the All stream while it shows. */
export function useR1Topics(p: R1TopicsProps): { column: ReactNode; above: ReactNode; history: Block[] | null; layout: R1TopicLayout; contact: { id: string; name: string } | null } {
  const contact = topicContactFor(p.rows, p.currentKey, p.mainSuffix, p.trunkName);
  const contactId = contact?.id ?? null;
  const { topics, reload } = useTopics(p.session, p.ready, contactId);
  const layout = useLayout(contactId);
  const narrow = useNarrow();
  const [all, setAll] = useState<{ contactId: string; history: Block[] | null } | null>(null);
  const [foldOpen, setFoldOpen] = useState(false);
  useEffect(() => { setFoldOpen(false); }, [p.currentKey]);
  const showingAll = Boolean(all && contact && all.contactId === contact.id && p.currentKey === contact.key);
  const items = useMemo(() => topics.map((topic) => {
    const row = p.rows.find((candidate) => candidate.key === topic.key);
    return { topic, updatedAt: row?.updatedAt ?? topic.anchor?.at ?? 0, preview: row?.preview ?? "" };
  }), [topics, p.rows]);
  useEffect(() => {
    if (!all || !contact || !showingAll || all.history) return;
    const general = p.rows.find((row) => row.key === contact.key);
    let picks: Record<string, string> = {};
    try { picks = JSON.parse(localStorage.getItem(EMOJI_KEY) || "{}") as Record<string, string>; } catch { /* A damaged local choice keeps the suggested emoji. */ }
    let live = true;
    void loadAllTopicTranscripts((method, params) => p.session.request(method, params),
      { key: contact.key, title: "General", updatedAt: general?.updatedAt ?? 0, preview: general?.preview ?? "" },
      items.map(({ topic, updatedAt, preview }) => ({ key: topic.key, title: topic.title, labelled: topic.labelled, updatedAt, preview })), picks,
    ).then((history) => { if (live) setAll((value) => value && value.contactId === contact.id ? { ...value, history } : value); },
      (error: unknown) => { if (live) { console.warn("All threads failed to load", error); setAll(null); } });
    return () => { live = false; };
  }, [all, contact, showingAll, items, p.rows, p.session]);
  if (!contact || !topics.length) return { column: null, above: null, history: null, layout, contact: null };
  const who = { id: contact.id, name: contact.name };
  const general = p.rows.find((row) => row.key === contact.key);
  const agentId = contact.id.replace(/^trunk:/, "");
  const request = (method: string, params: unknown) => p.session.request(method, params);
  const rail = <div className="r1-topic-host g-clear"><TopicRail clear phoneList={narrow} contactId={contact.id} contactName={contact.name} contactKey={contact.key}
    r1={{ layout, onLayout: (next) => setR1TopicLayout(next, contact.id), onReset: resetFree,
      onCreate: async (draft) => { const key = await createTopicSession(request, { agentId, parentKey: contact.key }, draft); await p.list.refresh(); reload(); setAll(null); p.onOpen(key); },
      onDelete: async (topic) => { await request("sessions.delete", { key: topic.key, agentId, deleteTranscript: true }); await p.list.refresh(); reload(); if (p.currentKey === topic.key) { setAll(null); p.onOpen(contact.key); } } }}
    generalPreview={general?.preview ?? ""} generalUpdatedAt={general?.updatedAt ?? 0} currentKey={p.currentKey} allSelected={showingAll} items={items}
    onOpen={(key) => { setAll(null); p.onOpen(key); }}
    onAll={() => { setAll({ contactId: contact.id, history: null }); p.onOpen(contact.key); }}
    onPatch={async (topic, change) => {
      await patchTopicSession((method, params) => p.session.request(method, params), topic, p.rows.find((row) => row.key === topic.key)?.sessionId, change);
      await p.list.refresh();
      reload();
    }} /></div>;
  const history = showingAll ? all?.history ?? [] : null;
  if (layout === "tabs") return { column: null, above: rail, history, layout, contact: who };
  if (!narrow) return { column: rail, above: null, history, layout, contact: who };
  const count = topics.length + 1;
  return { column: null, history, layout, contact: who, above: <div className="r1-topic-fold">
    <button type="button" className="g-frost" data-local="" aria-expanded={foldOpen} onClick={() => setFoldOpen((open) => !open)}>Threads · {count}</button>
    {foldOpen ? rail : null}
  </div> };
}
