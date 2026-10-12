import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SaplingSession } from "../../connect/session";
import { useConversations, usePendingApprovals } from "../../shell/engine-data";
import { Frame } from "./Frame";
import { Thread } from "../../thread/Thread";
import { Composer } from "../../composer/Composer";
import { Face } from "../../face/Face";
import { SettingsFrame } from "../../places-nav/SettingsFrame";
import { PlaceView } from "../../places-nav/PlaceView";
import { loadRoute, parseRoute, saveRoute, windowTitle, type Route } from "../../places-nav/routes";
import { lookStore } from "../../places/settings/set1/appearance-store";
import { Popover } from "../../glass/Popover";
import { Sidebar } from "../sidebar/Sidebar";
import { Toasts } from "../../shell/Toasts";

/**
 * The R1 frame is opt-in until the ship card (R1-11) flips the default; every install opens Classic.
 * Opt in with `?r1` or the hidden `branch.r1` flag; `?classic` and `branch.classic` always win.
 */
export function r1Window(search = location.search): boolean {
  const params = new URLSearchParams(search);
  if (params.has("classic")) return false;
  try {
    if (localStorage.getItem("branch.classic") === "1") return false;
    return params.has("r1") || localStorage.getItem("branch.r1") === "1";
  } catch {
    return params.has("r1");
  }
}

/** Live connection adapter. Screen ports replace these slots without changing Frame. */
export function R1Window({ session }: { session: SaplingSession }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const ready = snapshot.status.phase === "connected", engine = session.engine;
  const [conversations, list] = useConversations(session, ready, snapshot.mainKey);
  const waiting = usePendingApprovals(session, ready);
  const [route, setRoute] = useState<Route>(loadRoute);
  const [history, setHistory] = useState({ index: 0, count: 1 });
  const entries = useRef<Route[]>([route]);
  const search = useRef<HTMLInputElement>(null);
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
  const rows = conversations.rows.filter(row => !row.system && !row.archived && !row.helper);
  const sidebar = <Sidebar session={session} ready={ready} list={list} sessions={conversations.rows} mainKey={snapshot.mainKey}
    currentKey={route.kind === "chat" ? snapshot.sessionKey : null} waiting={waiting} searchRef={search} onOpen={openConversation}
    onSettings={page => navigate({ kind: "settings", page })} onPlace={place => navigate({ kind: "place", place })} />;
  const main = route.kind === "settings" ? <SettingsFrame page={route.page} backName={snapshot.name || "Conversation"} engine={engine} onPage={page => navigate({ kind: "settings", page })} onBack={() => navigate({ kind: "chat", key: snapshot.sessionKey })} /> : route.kind === "place" ? <PlaceView place={route.place} engine={engine} facts={{ running: conversations.rows.filter(row => row.working).length, waiting: waiting.size }} openConversation={openConversation} openPlace={place => navigate({ kind: "place", place })} openSettings={page => navigate({ kind: "settings", page })} /> : <Thread
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
    <Toasts />
    {agentOpen && <Popover anchor={pill} label="Agent details" onClose={closeAgent}><div className="r1-agent-details">
      <strong>{identity?.name ?? snapshot.name}</strong><p>{identityError ?? (identity ? identity.emoji ?? "" : "Loading agent details…")}</p>
      <button type="button" onClick={closeAgent}>Close</button>
    </div></Popover>}
  </>;
}
