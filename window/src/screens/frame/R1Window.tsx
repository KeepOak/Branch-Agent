import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SaplingSession } from "../../connect/session";
import { useConversations, usePendingApprovals } from "../../shell/engine-data";
import { Frame } from "./Frame";
import { ChatView } from "../chat/ChatView";
import { WORK_MODES, useWorkMode } from "../chat/chat-logic";
import type { ReplyTarget } from "../../thread/useMessageActions";
import { Composer } from "../../composer/Composer";
import { Face } from "../../face/Face";
import { Icon } from "../../shell/icons";
import { SettingsFrame } from "../../places-nav/SettingsFrame";
import { PlaceView } from "../../places-nav/PlaceView";
import { loadRoute, parseRoute, saveRoute, windowTitle, type Route } from "../../places-nav/routes";
import { lookStore } from "../../places/settings/set1/appearance-store";
import { Popover } from "../../glass/Popover";
import { Coming } from "../../glass/coming";

/** Support-only escape hatch, retained for one release. */
export function classicWindow(search = location.search): boolean {
  if (new URLSearchParams(search).has("classic")) return true;
  try { return localStorage.getItem("branch.classic") === "1"; } catch { return false; }
}

/** Live connection adapter. Screen ports replace these slots without changing Frame. */
export function R1Window({ session }: { session: SaplingSession }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const ready = snapshot.status.phase === "connected", engine = session.engine;
  const [conversations] = useConversations(session, ready, snapshot.mainKey);
  const waiting = usePendingApprovals(session, ready);
  const [route, setRoute] = useState<Route>(loadRoute);
  const [history, setHistory] = useState({ index: 0, count: 1 });
  const entries = useRef<Route[]>([route]);
  const [query, setQuery] = useState(""), search = useRef<HTMLInputElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const [agentOpen, setAgentOpen] = useState(false), [identity, setIdentity] = useState<{ name?: string; emoji?: string } | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Both belong to the open conversation: opening another one drops them without an effect.
  const [reply, setReply] = useState<{ key: string | null; target: ReplyTarget } | null>(null);
  const replyTo = reply && reply.key === snapshot.sessionKey ? reply.target : null;
  const setReplyTo = (target: ReplyTarget | null) => setReply(target ? { key: snapshot.sessionKey, target } : null);
  const [menuFor, setMenuFor] = useState<string | null | undefined>(undefined), convAnchor = useRef<HTMLElement | null>(null);
  const convMenu = menuFor === snapshot.sessionKey;
  const setConvMenu = (open: boolean) => setMenuFor(open ? snapshot.sessionKey : undefined);
  const work = useWorkMode(ready ? engine : undefined, snapshot.sessionKey);
  const closeAgent = useCallback(() => setAgentOpen(false), []);
  const applyRoute = useCallback((next: Route) => {
    saveRoute(next); setRoute(next); setAgentOpen(false);
    if (next.kind === "chat") { const key = next.key ?? session.getSnapshot().mainKey; if (key && key !== session.getSnapshot().sessionKey) void session.open(key); }
  }, [session]);
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, r1Index: 0, r1Route: entries.current[0] }, "");
    const pop = (event: PopStateEvent) => {
      const index = event.state?.r1Index;
      const next = parseRoute(JSON.stringify(event.state?.r1Route));
      if (typeof index !== "number" || index < 0 || index >= entries.current.length || !next) return;
      setHistory({ index, count: entries.current.length }); applyRoute(next);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
    // This window owns only entries created during this mount; it never navigates outside them.
  }, [applyRoute]);
  const navigate = (next: Route) => {
    if (JSON.stringify(next) === JSON.stringify(route)) return;
    const index = history.index + 1;
    entries.current = [...entries.current.slice(0, index), next];
    window.history.pushState({ ...window.history.state, r1Index: index, r1Route: next }, "");
    setHistory({ index, count: entries.current.length }); applyRoute(next);
  };
  useEffect(() => { if (ready) void lookStore(engine).load(); }, [ready, engine]);
  useEffect(() => {
    document.title = windowTitle(route.kind === "chat" ? snapshot.name : route.kind === "settings" ? "Settings" : route.place, waiting.size, !ready);
  }, [route, snapshot.name, waiting.size, ready]);
  useEffect(() => {
    if (!agentOpen || !ready) return;
    let active = true;
    setIdentity(null); setIdentityError(null);
    void engine.request<{ name?: string; emoji?: string }>("agent.identity.get", { agentId: engine.agentId }).then(
      value => { if (active) setIdentity(value); },
      () => { if (active) setIdentityError("Agent details couldn’t be loaded."); },
    );
    return () => { active = false; };
  }, [agentOpen, ready, engine]);
  const openConversation = (key: string) => navigate({ kind: "chat", key });
  const rows = conversations.rows.filter(row => !row.system && !row.archived && !row.helper && row.title.toLowerCase().includes(query.toLowerCase()));
  const sidebar = <>
    <input className="r1-sidebar-search" ref={search} aria-label="Search conversations" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} />
    <nav className="r1-sidebar-list" aria-label="Conversations">
      {rows.map(row => <button type="button" key={row.key} aria-current={row.key === snapshot.sessionKey && route.kind === "chat"} title={row.title} onClick={() => openConversation(row.key)}><Face size={24} label={row.title} /><span className="r1-sidebar-label">{row.title}</span></button>)}
      {conversations.loaded && !rows.length && <p className="r1-sidebar-label r1-notice">{query ? "No matching conversations" : "No conversations yet"}</p>}
      {conversations.error && <p className="r1-notice" role="alert">{conversations.error}</p>}
    </nav>
    <div className="r1-sidebar-footer"><button type="button" className="g-ctl" aria-label="Settings" onClick={() => navigate({ kind: "settings", page: "appearance" })}><Icon name="gear" /></button></div>
  </>;
  const main = route.kind === "settings" ? <SettingsFrame page={route.page} backName={snapshot.name || "Conversation"} engine={engine} onPage={page => navigate({ kind: "settings", page })} onBack={() => navigate({ kind: "chat", key: snapshot.sessionKey })} /> : route.kind === "place" ? <PlaceView place={route.place} engine={engine} facts={{ running: conversations.rows.filter(row => row.working).length, waiting: waiting.size }} openConversation={openConversation} openPlace={place => navigate({ kind: "place", place })} openSettings={page => navigate({ kind: "settings", page })} /> : <ChatView
    name={snapshot.name} history={snapshot.history} historyReady={snapshot.historyReady} live={snapshot.live} pendingUser={snapshot.pendingUser} queued={snapshot.queued} steered={snapshot.steered} running={Boolean(snapshot.liveRunId)} ended={snapshot.ended}
    engine={engine} sessionKey={snapshot.sessionKey} onAnswer={(id, answer) => void session.answer(id, answer)} onReload={() => void session.reload()} onOpenSession={openConversation} onToast={setNotice}
    onStart={ready ? (text) => void session.send(text) : undefined} onReply={setReplyTo}
  />;
  return <>
    <Frame sidebar={sidebar} main={main} navigationKey={JSON.stringify(route)} notice={ready ? snapshot.error ?? notice : "Reconnecting…"} header={{
      title: route.kind === "chat" ? snapshot.name || "Conversation" : route.kind === "settings" ? "Settings" : route.place,
      face: <Face size={24} label={snapshot.name} />, pillRef: pill, onOpen: ready && route.kind === "chat" ? () => setAgentOpen(open => !open) : undefined,
      right: route.kind === "chat" ? [
        { label: "Computer", icon: <Icon name="monitor" />, coming: "Computer controls are not connected yet." },
        { label: "Browser", icon: <Icon name="globe" />, coming: "Browser controls are not connected yet." },
        { label: "More", icon: <Icon name="more" />, onClick: ready ? () => { convAnchor.current = document.querySelector<HTMLElement>('.r1-header-right [aria-label="More"]'); setConvMenu(!convMenu); } : undefined },
      ] : undefined,
      canBack: history.index > 0, canForward: history.index < history.count - 1, onBack: () => { if (history.index > 0) window.history.back(); }, onForward: () => { if (history.index < history.count - 1) window.history.forward(); },
    }} composer={route.kind === "chat" ? <Composer name={snapshot.name} replyTo={replyTo} onClearReply={() => setReplyTo(null)} engine={engine} sessionKey={snapshot.sessionKey} working={Boolean(snapshot.liveRunId)} disabled={!ready} offline={!ready} onSend={(text, extras, id) => { setReplyTo(null); void session.send(text, extras, id); }} onStop={() => void session.stopRun()} onReload={() => void session.reload()} onToast={setNotice} onOpenConversation={openConversation} onOpen={target => {
      if (target === "settings/accounts/add") { sessionStorage.setItem("branch.openAddAccount", "1"); navigate({ kind: "settings", page: "accounts" }); }
      else if (target.startsWith("settings/")) navigate({ kind: "settings", page: target.slice("settings/".length) });
      else if (target === "customize/tools") navigate({ kind: "place", place: "customize" });
      else if (target === "local-model-setup") navigate({ kind: "settings", page: "local" });
    }} /> : undefined} onShortcut={action => {
      if (action === "settings") navigate({ kind: "settings", page: "appearance" });
      else if (action === "nextConversation" && rows.length) { const index = rows.findIndex(row => row.key === snapshot.sessionKey); openConversation(rows[(index + 1) % rows.length].key); }
      else if (document.activeElement === search.current) setNotice("Coming · Find anything is not connected yet.");
      else { search.current?.focus(); }
    }} />
    {convMenu && <Popover anchor={convAnchor} label="Conversation" align="end" width={260} onClose={() => setConvMenu(false)}><div className="r1c-menu" role="menu" aria-label="Show agents’ work as">
      <div className="r1c-menu-meta">Show agents’ work as</div>
      {[{ id: null, label: `Like Settings (${WORK_MODES.find(m => m.id === work.global)?.label})` }, ...WORK_MODES].map(m => <Coming key={m.id ?? "default"} engine={engine} need="users.prefs.set" reason="This engine can’t save how agents’ work shows here." where={m.label}><button type="button" role="menuitemradio" className="r1c-mi" aria-checked={work.override === m.id}
        onClick={() => { void work.setOverride(m.id).catch((e: unknown) => setNotice(e instanceof Error ? e.message : String(e))); setConvMenu(false); }}><span className="r1c-mi-t">{m.label}</span>{work.override === m.id ? <Icon name="check" size={15} /> : null}</button></Coming>)}
    </div></Popover>}
    {agentOpen && <Popover anchor={pill} label="Agent details" onClose={closeAgent}><div className="r1-agent-details">
      <strong>{identity?.name ?? snapshot.name}</strong><p>{identityError ?? (identity ? identity.emoji ?? "" : "Loading agent details…")}</p>
      <button type="button" onClick={closeAgent}>Close</button>
    </div></Popover>}
  </>;
}
