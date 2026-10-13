import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SaplingSession } from "../../connect/session";
import { useConversations, usePendingApprovals } from "../../shell/engine-data";
import { Frame } from "./Frame";
import { ChatView } from "../chat/ChatView";
import { WORK_MODES, useWorkMode } from "../chat/chat-logic";
import type { ReplyTarget } from "../../thread/useMessageActions";
import { Composer } from "../composer/Composer";
import { useLimits } from "../../shell/use-status";
import { useLockdown } from "../../shell/use-lockdown";
import { Face } from "../../face/Face";
import { Icon } from "../../shell/icons";
import { PlaceView } from "../../places-nav/PlaceView";
import { PLACES, loadRoute, parseRoute, saveRoute, windowTitle, type PlaceId, type Route } from "../../places-nav/routes";
import { SettingsFrame as ClassicSettingsFrame } from "../../places-nav/SettingsFrame";
import { SettingsFrame } from "../settings";
import { R1_PAGES } from "../settings/pages/plugged";
import { ROWS } from "../settings/rows";
import { mergeRows, type PageSlots } from "../settings/slots";
import type { Row } from "../settings/rows";
import { lookStore } from "../../places/settings/set1/appearance-store";
import { Popover } from "../../glass/Popover";
import { Sidebar } from "../sidebar/Sidebar";
import { Toasts } from "../../shell/Toasts";
import { ApprovalsLayer } from "../approvals";
import { Coming } from "../../glass/coming";
import { useFirstRun } from "../../setup/use-first-run";
import { Onboarding } from "../onboarding";
import { recordOnboarding } from "../onboarding/finish";

/** Places R1 Settings search can open (its Go to group). */
const SETTINGS_PLACES = PLACES.map(place => ({ id: place.id, label: place.name }));

/** Header and window title for a place. Seedbank has no sidebar row, so it has no PLACES name. */
const placeTitle = (place: PlaceId) => place === "seedbank" ? "Seedbank" : place;

/**
 * Pages that keep the Classic page although R1 has a slot for them, because the R1 port still lacks working Classic
 * features. Chat apps: Manage has no add another account, groups by ID, Check now, Reload or allowlist editing yet.
 */
const KEEP_CLASSIC: ReadonlySet<string> = new Set(["chatapps", "accounts", "appearance"]);

/**
 * R1 Settings draws a page only once it has rows or its own slot and nothing working is left behind in Classic. Every
 * other page keeps the Classic page, which still works, until its port lands (R1 README rule 6).
 */
export function r1SettingsPage(page: string, pages: PageSlots = R1_PAGES, rows: readonly Row[] = mergeRows(ROWS, pages)): boolean {
  if (KEEP_CLASSIC.has(page)) return false;
  return Boolean((pages as Record<string, { component?: unknown } | undefined>)[page]?.component) || rows.some(row => row.page === page);
}

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
  const limits = useLimits(session, ready);
  const lockdown = useLockdown(engine, ready, session, true);
  const [route, setRoute] = useState<Route>(loadRoute);
  const [history, setHistory] = useState({ index: 0, count: 1 });
  const entries = useRef<Route[]>([route]);
  const search = useRef<HTMLInputElement>(null);
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
  // R1-07: the onboarding card opens by itself on first run (no wizard.lastRunAt), as Classic setup does.
  const setupReads = useMemo(() => ({ request: <T,>(method: string, params?: unknown) => Promise.resolve(engine.request<T>(method, params)) }), [engine]);
  const firstRun = useFirstRun(setupReads as Pick<SaplingSession, "request">, ready, () => document.querySelector(".r1-ob, [role=dialog][aria-modal=true]") !== null);
  const onboarding = ready && firstRun.step !== null;
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
    document.title = windowTitle(route.kind === "chat" ? snapshot.name : route.kind === "settings" ? "Settings" : placeTitle(route.place), waiting.size, !ready);
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
  const current = conversations.rows.find(row => row.key === snapshot.sessionKey);
  const topics = current?.isMain ? conversations.rows.filter(row => row.agentId === current.agentId && row.key !== current.key && !row.isMain && !row.system && !row.archived && !row.helper).map(row => ({ key: row.key, title: row.title })) : [];
  const running = conversations.rows.filter(row => row.working).map(row => ({ key: row.key, title: row.title, line: row.preview, needsYou: row.needsYou }));
  const sidebar = <Sidebar session={session} ready={ready} list={list} sessions={conversations.rows} mainKey={snapshot.mainKey}
    currentKey={route.kind === "chat" ? snapshot.sessionKey : null} waiting={waiting} searchRef={search} onOpen={openConversation}
    onSettings={page => navigate({ kind: "settings", page })} onPlace={place => navigate({ kind: "place", place })} error={conversations.error} />;
  const main = route.kind === "settings" && !r1SettingsPage(route.page) ? <ClassicSettingsFrame page={route.page} backName={snapshot.name || "Conversation"} engine={engine} onPage={page => navigate({ kind: "settings", page })} onBack={() => navigate({ kind: "chat", key: snapshot.sessionKey })} /> : route.kind === "settings" ? <SettingsFrame engine={engine} page={route.page} pages={R1_PAGES} places={SETTINGS_PLACES} onPage={page => navigate({ kind: "settings", page })} onOpenPlace={id => { const place = PLACES.find(p => p.id === id); if (place) navigate({ kind: "place", place: place.id }); }} /> : route.kind === "place" ? <PlaceView place={route.place} engine={engine} facts={{ running: conversations.rows.filter(row => row.working).length, waiting: waiting.size }} openConversation={openConversation} openPlace={place => navigate({ kind: "place", place })} openSettings={page => navigate({ kind: "settings", page })} /> : <ChatView
    name={snapshot.name} history={snapshot.history} historyReady={snapshot.historyReady} live={snapshot.live} pendingUser={snapshot.pendingUser} queued={snapshot.queued} steered={snapshot.steered} running={Boolean(snapshot.liveRunId)} ended={snapshot.ended}
    engine={engine} sessionKey={snapshot.sessionKey} onAnswer={(id, answer) => void session.answer(id, answer)} onReload={() => void session.reload()} onOpenSession={openConversation} onToast={setNotice}
    onStart={ready ? (text) => void session.send(text) : undefined} onReply={setReplyTo}
  />;
  // The agent details popover's second line: the error, the agent's emoji, or the loading line (none when there's no emoji).
  const agentLine = identityError ?? (identity ? identity.emoji ?? "" : "Loading agent details…");
  return <>
    {onboarding && <Onboarding engine={engine} startAt={firstRun.step ?? 0}
      onLater={state => { firstRun.close(); void recordOnboarding(engine, state).catch((e: unknown) => setNotice(`Couldn’t save that setup is done: ${e instanceof Error ? e.message : String(e)}`)); }}
      onDone={({ sessionKey }) => { firstRun.close(); navigate({ kind: "chat", key: sessionKey }); }} />}
    {/* While the card is open, the window it covers steps aside: hidden and out of the Tab order (README item 48). */}
    <div className="r1-ob-behind" inert={onboarding} aria-hidden={onboarding || undefined} style={{ display: "contents", visibility: onboarding ? "hidden" : undefined }}>
    <Frame sidebar={sidebar} main={main} navigationKey={JSON.stringify(route)} notice={ready ? snapshot.error ?? notice : "Reconnecting…"} header={{
      title: route.kind === "chat" ? snapshot.name || "Conversation" : route.kind === "settings" ? "Settings" : placeTitle(route.place),
      face: <Face size={24} label={snapshot.name} />, pillRef: pill, onOpen: ready && route.kind === "chat" ? () => setAgentOpen(open => !open) : undefined,
      right: route.kind === "chat" ? [
        { label: "Computer", icon: <Icon name="monitor" />, coming: "Computer controls are not connected yet." },
        { label: "Browser", icon: <Icon name="globe" />, coming: "Browser controls are not connected yet." },
        { label: "More", icon: <Icon name="more" />, onClick: ready ? () => { convAnchor.current = document.querySelector<HTMLElement>('.r1-header-right [aria-label="More"]'); setConvMenu(!convMenu); } : undefined },
      ] : undefined,
      canBack: history.index > 0, canForward: history.index < history.count - 1, onBack: () => { if (history.index > 0) window.history.back(); }, onForward: () => { if (history.index < history.count - 1) window.history.forward(); },
    }} composer={route.kind === "chat" ? <Composer name={snapshot.name} replyTo={replyTo} onClearReply={() => setReplyTo(null)} engine={engine} working={Boolean(snapshot.liveRunId)} offline={!ready} limits={limits} row={current} topics={topics} running={running} mainKey={snapshot.mainKey?.split(":").slice(2).join(":") || "main"}
      lockdown={lockdown.on} onToggleLockdown={lockdown.supported ? () => void lockdown.toggle() : undefined}
      onSend={(text, extras, id) => { setReplyTo(null); void session.send(text, extras, id); }} onStop={() => void session.stopRun()} onToast={setNotice} onOpenConversation={openConversation} onOpen={target => {
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
    </div>
    {lockdown.confirmation}
    <Toasts />
    <ApprovalsLayer engine={engine} ready={ready} sessionKey={route.kind === "chat" ? snapshot.sessionKey : null} view={route.kind === "chat" ? "chat" : "other"} onOpen={openConversation} />
    {convMenu && <Popover anchor={convAnchor} label="Conversation" align="end" width={260} onClose={() => setConvMenu(false)}><div className="r1c-menu" role="menu" aria-label="Show agents’ work as">
      <div className="r1c-menu-meta">Show agents’ work as</div>
      {[{ id: null, label: `Like Settings (${WORK_MODES.find(m => m.id === work.global)?.label})` }, ...WORK_MODES].map(m => <Coming key={m.id ?? "default"} engine={engine} need="users.prefs.set" reason="This engine can’t save how agents’ work shows here." where={m.label}><button type="button" role="menuitemradio" className="r1c-mi" aria-checked={work.override === m.id}
        onClick={() => { void work.setOverride(m.id).catch((e: unknown) => setNotice(e instanceof Error ? e.message : String(e))); setConvMenu(false); }}><span className="r1c-mi-t">{m.label}</span>{work.override === m.id ? <Icon name="check" size={15} /> : null}</button></Coming>)}
    </div></Popover>}
    {agentOpen && <Popover anchor={pill} label="Agent details" onClose={closeAgent}><div className="r1-agent-details g-clear">
      <strong className="g-label">{identity?.name ?? snapshot.name}</strong>{agentLine ? <p className="g-label">{agentLine}</p> : null}
      <button type="button" onClick={closeAgent}>Close</button>
    </div></Popover>}
  </>;
}
