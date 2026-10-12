import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SaplingSession } from "../../connect/session";
import { useConversations, usePendingApprovals } from "../../shell/engine-data";
import { Frame } from "./Frame";
import { Thread } from "../../thread/Thread";
import { Composer } from "../../composer/Composer";
import { Face } from "../../face/Face";
import { Icon } from "../../shell/icons";
import { PlaceView } from "../../places-nav/PlaceView";
import { PLACES, loadRoute, parseRoute, saveRoute, windowTitle, type Route } from "../../places-nav/routes";
import { SettingsFrame } from "../settings";
import { R1_PAGES } from "../settings/pages/plugged";
import { lookStore } from "../../places/settings/set1/appearance-store";
import { Popover } from "../../glass/Popover";

/** Places R1 Settings search can open (its Go to group). */
const SETTINGS_PLACES = PLACES.map(place => ({ id: place.id, label: place.name }));

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
  const main = route.kind === "settings" ? <SettingsFrame engine={engine} page={route.page} pages={R1_PAGES} places={SETTINGS_PLACES} onPage={page => navigate({ kind: "settings", page })} onOpenPlace={id => { const place = PLACES.find(p => p.id === id); if (place) navigate({ kind: "place", place: place.id }); }} /> : route.kind === "place" ? <PlaceView place={route.place} engine={engine} facts={{ running: conversations.rows.filter(row => row.working).length, waiting: waiting.size }} openConversation={openConversation} openPlace={place => navigate({ kind: "place", place })} openSettings={page => navigate({ kind: "settings", page })} /> : <Thread
    name={snapshot.name} history={snapshot.history} historyReady={snapshot.historyReady} live={snapshot.live} pendingUser={snapshot.pendingUser} queued={snapshot.queued} running={Boolean(snapshot.liveRunId)} liveStartedAt={snapshot.liveStartedAt}
    engine={engine} sessionKey={snapshot.sessionKey} onAnswer={(id, answer) => void session.answer(id, answer)} onReload={() => void session.reload()} onOpenSession={openConversation} onToast={setNotice}
  />;
  return <>
    <Frame sidebar={sidebar} main={main} navigationKey={JSON.stringify(route)} notice={ready ? snapshot.error ?? notice : "Reconnecting…"} header={{
      title: route.kind === "chat" ? snapshot.name || "Conversation" : route.kind === "settings" ? "Settings" : route.place,
      face: <Face size={24} label={snapshot.name} />, pillRef: pill, onOpen: ready && route.kind === "chat" ? () => setAgentOpen(open => !open) : undefined,
      canBack: history.index > 0, canForward: history.index < history.count - 1, onBack: () => { if (history.index > 0) window.history.back(); }, onForward: () => { if (history.index < history.count - 1) window.history.forward(); },
    }} composer={route.kind === "chat" ? <Composer name={snapshot.name} engine={engine} sessionKey={snapshot.sessionKey} working={Boolean(snapshot.liveRunId)} disabled={!ready} offline={!ready} onSend={(text, extras, id) => { void session.send(text, extras, id); }} onStop={() => void session.stopRun()} onReload={() => void session.reload()} onToast={setNotice} onOpenConversation={openConversation} onOpen={target => {
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
    {agentOpen && <Popover anchor={pill} label="Agent details" onClose={closeAgent}><div className="r1-agent-details">
      <strong>{identity?.name ?? snapshot.name}</strong><p>{identityError ?? (identity ? identity.emoji ?? "" : "Loading agent details…")}</p>
      <button type="button" onClick={closeAgent}>Close</button>
    </div></Popover>}
  </>;
}
