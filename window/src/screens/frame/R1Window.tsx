import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SaplingSession } from "../../connect/session";
import { useConversations, useMachine, usePendingApprovals } from "../../shell/engine-data";
import { Frame } from "./Frame";
import { DEFAULT_TOOLS } from "./Header";
import { useTalkBeside } from "../talk/TalkBesideHost";
import { ChatView } from "../chat/ChatView";
import { useWorkMode } from "../chat/chat-logic";
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
import { useProblemBannerRows } from "../approvals/ProblemBanners";
import { Coming } from "../../glass/coming";
import { useFirstRun } from "../../setup/use-first-run";
import { Onboarding } from "../onboarding";
import { recordOnboarding } from "../onboarding/finish";
import { useMarkRead } from "./use-mark-read";
import { FindAnything } from "../find/FindAnything";
import { ShortcutsDialog } from "../../shell/ShortcutsDialog";
import { ConversationMenu } from "./ConversationMenu";
import { R1Stage, R1StagePip } from "../stage/R1Stage";
import { useR1Room } from "./use-r1-room";
import { QuickAskHost } from "../quickask/QuickAskHost";
import type { PipTarget, StageMode } from "../../stage/ComputerStage";
import { R1Tower, readTowerOn, saveTowerOn, useTowerNarrow } from "../tower/R1Tower";
import { useNeedsCount } from "../../places/inbox";
import { CHANGES_NEED, R1Changes } from "../changes/R1Changes";
import { R1Character, useR1CharacterShown } from "../character/R1Character";

const FIND_ANYTHING_NAMES_ONLY = "Message search needs a newer Branch engine. Find anything lists names only.";

/** Places R1 Settings search can open (its Go to group). */
const SETTINGS_PLACES = PLACES.map(place => ({ id: place.id, label: place.name }));

/** Header and window title for a place. Seedbank has no sidebar row, so it has no PLACES name. */
const placeTitle = (place: PlaceId) => place === "seedbank" ? "Seedbank" : place;

/**
 * Pages that keep the Classic page although R1 has a slot for them, because the R1 port still lacks working Classic
 * features. None is left: Appearance, Chat apps and Accounts each draw every working Classic control in R1
 * (settings/pages/appearance-live.tsx, screens/chatapps, settings/pages/accounts-live.tsx; #976).
 */
const KEEP_CLASSIC: ReadonlySet<string> = new Set<string>();

/**
 * R1 Settings draws a page only once it has rows or its own slot and nothing working is left behind in Classic. Every
 * other page keeps the Classic page, which still works, until its port lands (R1 README rule 6).
 */
export function r1SettingsPage(page: string, pages: PageSlots = R1_PAGES, rows: readonly Row[] = mergeRows(ROWS, pages)): boolean {
  if (KEEP_CLASSIC.has(page)) return false;
  return Boolean((pages as Record<string, { component?: unknown } | undefined>)[page]?.component) || rows.some(row => row.page === page);
}

/**
 * R1 is the only window (R1-12). `?classic` and the hidden `branch.classic` flag keep the old window only until
 * the R1 Settings pages land (R1-14, #976); the escape goes with the Classic window itself.
 */
export function r1Window(search = location.search): boolean {
  if (new URLSearchParams(search).has("classic")) return false;
  try {
    return localStorage.getItem("branch.classic") !== "1";
  } catch {
    return true;
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
  const machine = useMachine(session, ready);
  // The re-hosted Classic character panel (parity row 19), shown beside the conversation unless hidden.
  const [characterShown, setCharacterShown] = useR1CharacterShown(engine);
  const [route, setRoute] = useState<Route>(loadRoute);
  // The re-hosted Classic computer stage (parity row 1): which side is open, and the small window it shrinks to.
  const [stage, setStage] = useState<StageMode | null>(null);
  const [pip, setPip] = useState<PipTarget | null>(null);
  // The re-hosted Classic control tower (parity row 5): beside the conversation, or in its place on a narrow window.
  const [tower, setTower] = useState(readTowerOn);
  const towerNarrow = useTowerNarrow();
  const needsCount = useNeedsCount(engine, ready);
  const toggleTower = useCallback(() => setTower(on => { saveTowerOn(!on); return !on; }), []);
  useEffect(() => { if (towerNarrow) setTower(false); }, [towerNarrow]);
  useEffect(() => {
    // Ctrl/Cmd+Shift+T shows or hides the tower, as in Classic.
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "t") return;
      event.preventDefault(); toggleTower();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [toggleTower]);
  // The header button that opened the stage; closing the stage hands focus back to it.
  const stageOpener = useRef<string | null>(null);
  const toggleStage = (mode: StageMode) => { setPip(null); setChanges(false); stageOpener.current = mode; setStage(open => open === mode ? null : mode); };
  // The re-hosted Classic Changes view and pull request box (parity row 4), opened from •••; it takes the stage's place.
  const [changes, setChanges] = useState(false);
  const closeChanges = useCallback(() => setChanges(false), []);
  const closeStage = useCallback(() => setStage(null), []);
  const [history, setHistory] = useState({ index: 0, count: 1 });
  const entries = useRef<Route[]>([route]);
  const search = useRef<HTMLInputElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const [agentOpen, setAgentOpen] = useState(false), [identity, setIdentity] = useState<{ name?: string; emoji?: string } | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [finding, setFinding] = useState(false), [shortcuts, setShortcuts] = useState(false);
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
  // A clear card or dialog over the whole window: the window behind it steps aside (README item 48).
  const behind = onboarding || finding;
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
  // Re-hosted Classic Settings pages open a place with branch:navigate-place (Classic WindowShell's event): R1 opens it here.
  const navigateTo = useRef(navigate);
  useEffect(() => { navigateTo.current = navigate; });
  useEffect(() => {
    const openPlace = (event: Event) => {
      const place = PLACES.find(p => p.id === (event as CustomEvent<{ place?: string }>).detail?.place);
      if (place) navigateTo.current({ kind: "place", place: place.id });
    };
    window.addEventListener("branch:navigate-place", openPlace);
    return () => window.removeEventListener("branch:navigate-place", openPlace);
  }, []);
  // Escape closes the stage unless a menu, dialog, picker or popover is open: those take Escape first.
  const stageShown = Boolean(stage) && route.kind === "chat";
  useEffect(() => {
    if (!stageShown) {
      const opener = stageOpener.current; stageOpener.current = null;
      if (opener) document.querySelector<HTMLElement>(`.r1-header-right [aria-label="${opener}"]`)?.focus();
      return;
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"], [aria-haspopup][aria-expanded="true"]')) return;
      closeStage();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [stageShown, closeStage]);
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
  // Settings › Learn more › Ask a Trunk (#977): the default Trunk's conversation opens and the question is sent there.
  const askTrunk = (text: string) => {
    const key = session.getSnapshot().mainKey;
    if (!key) { setNotice("Couldn’t find your default Trunk."); return; }
    void (async () => {
      try { await session.open(key); navigate({ kind: "chat", key }); await session.send(text); }
      catch (e) { setNotice(`Couldn’t ask your Trunk: ${e instanceof Error ? e.message : String(e)}`); }
    })();
  };
  const rows = conversations.rows.filter(row => !row.system && !row.archived && !row.helper);
  const current = conversations.rows.find(row => row.key === snapshot.sessionKey);
  // A room (group chat, or Trunks and people writing here): the Classic room hook, re-hosted (rooms/useShellRoom).
  const room = useR1Room(session, ready, snapshot.sessionKey, current ?? null, snapshot.name, snapshot.history);
  const topics = current?.isMain ? conversations.rows.filter(row => row.agentId === current.agentId && row.key !== current.key && !row.isMain && !row.system && !row.archived && !row.helper).map(row => ({ key: row.key, title: row.title })) : [];
  // Opening a conversation clears its unread flag once per unread episode (Classic read-on-open, connect/unread-guard.ts).
  const markRequest = useCallback((method: string, params?: unknown) => session.request(method, params), [session]);
  const refreshList = useCallback(() => { void list.refresh(); }, [list]);
  useMarkRead(markRequest, current ?? null, ready && route.kind === "chat", refreshList);
  const running = conversations.rows.filter(row => row.working).map(row => ({ key: row.key, title: row.title, line: row.preview, needsYou: row.needsYou }));
  // The roaming pet's tip names the first Trunk waiting on a yes, as in Classic.
  const waitingRow = conversations.rows.find(row => (waiting.get(row.key) ?? 0) > 0);
  const petWaiting = waitingRow ? conversations.rows.find(row => row.isMain && row.agentId === waitingRow.agentId)?.title || waitingRow.title : null;
  const sidebar = <Sidebar session={session} ready={ready} list={list} sessions={conversations.rows} mainKey={snapshot.mainKey}
    currentKey={route.kind === "chat" ? snapshot.sessionKey : null} waiting={waiting} searchRef={search} onOpen={openConversation}
    onSettings={page => navigate({ kind: "settings", page })} onPlace={place => navigate({ kind: "place", place })} error={conversations.error} />;
  const trunkName = (id?: string) => conversations.rows.find(row => row.isMain && row.agentId === id)?.title || snapshot.name || "Sapling";
  const showTower = route.kind === "chat" && ready && tower && !stage && !onboarding;
  const towerView = showTower ? <R1Tower engine={engine} rows={conversations.rows} needsCount={needsCount} trunkName={trunkName} inMain={towerNarrow}
    onOpen={key => { if (towerNarrow) setTower(false); openConversation(key); }} onPlace={place => navigate({ kind: "place", place })} onSettings={page => navigate({ kind: "settings", page })}
    onClose={() => { setTower(false); saveTowerOn(false); }} /> : null;
  const main = towerView && towerNarrow ? towerView : route.kind === "settings" && !r1SettingsPage(route.page) ? <ClassicSettingsFrame page={route.page} backName={snapshot.name || "Conversation"} engine={engine} onPage={page => navigate({ kind: "settings", page })} onBack={() => navigate({ kind: "chat", key: snapshot.sessionKey })} /> : route.kind === "settings" ? <SettingsFrame engine={engine} page={route.page} pages={R1_PAGES} places={SETTINGS_PLACES} onAsk={ready ? askTrunk : undefined} onPage={page => navigate({ kind: "settings", page })} onOpenPlace={id => { const place = PLACES.find(p => p.id === id); if (place) navigate({ kind: "place", place: place.id }); }} /> : route.kind === "place" ? <PlaceView place={route.place} engine={engine} facts={{ running: conversations.rows.filter(row => row.working).length, waiting: waiting.size }} openConversation={openConversation} openPlace={place => navigate({ kind: "place", place })} openSettings={page => navigate({ kind: "settings", page })} /> : changes ? <R1Changes key={snapshot.sessionKey ?? "none"} engine={engine} name={snapshot.name} onClose={closeChanges} /> : stage ? <R1Stage key={snapshot.sessionKey ?? "none"} engine={engine} gatewayUrl={session.gatewayUrl} name={snapshot.name} mode={stage} blocks={[...snapshot.history, ...snapshot.live]} running={Boolean(snapshot.liveRunId)}
    onMode={setStage} onClose={closeStage} onChooseComputer={() => navigate({ kind: "settings", page: "computer" })} onPip={small => { setPip(small); setStage(null); }} /> : <ChatView
    name={snapshot.name} history={snapshot.history} historyReady={snapshot.historyReady} live={snapshot.live} pendingUser={snapshot.pendingUser} queued={snapshot.queued} steered={snapshot.steered} running={Boolean(snapshot.liveRunId)} ended={snapshot.ended}
    engine={engine} sessionKey={snapshot.sessionKey} onAnswer={(id, answer) => void session.answer(id, answer)} onReload={() => void session.reload()} onOpenSession={openConversation} onToast={setNotice}
    onStart={ready ? (text) => void session.send(text) : undefined} onReply={setReplyTo} room={room.thread}
  />;
  // Problem and news banners (the Classic hooks), drawn in the approvals banner stack.
  const problems = useProblemBannerRows({ session, shownKey: route.kind === "chat" ? snapshot.sessionKey : null, machineName: machine?.name ?? "",
    defaultName: conversations.rows.find(row => row.key === snapshot.mainKey)?.title || "your Trunk", onOpen: openConversation,
    titleOf: key => conversations.rows.find(row => row.key === key)?.title || "A conversation",
    trunkOf: key => { const row = conversations.rows.find(r => r.key === key); return conversations.rows.find(r => r.isMain && r.agentId === row?.agentId)?.title || row?.title || "Your Trunk"; },
    onOpenConnection: () => navigate({ kind: "settings", page: "devices" }),
    onAsk: text => { const key = snapshot.mainKey; if (!key) return; openConversation(key); void session.open(key).then(() => session.send(text)); } });
  // Talk beside (parity row 20): the default Trunk beside a place, as in Classic.
  const talk = useTalkBeside({ shown: route.kind === "place", request: (method, params) => session.request(method, params), onEvent: listener => session.onGatewayEvent(listener), mainKey: snapshot.mainKey,
    name: conversations.rows.find(row => row.key === snapshot.mainKey)?.title || "your Trunk", page: route.kind === "place" ? PLACES.find(p => p.id === route.place)?.name ?? placeTitle(route.place) : "", onFull: openConversation });
  // The agent details popover's second line: the error, the agent's emoji, or the loading line (none when there's no emoji).
  const agentLine = identityError ?? (identity ? identity.emoji ?? "" : "Loading agent details…");
  return <>
    {onboarding && <Onboarding engine={engine} startAt={firstRun.step ?? 0}
      onLater={state => { firstRun.close(); void recordOnboarding(engine, state).catch((e: unknown) => setNotice(`Couldn’t save that setup is done: ${e instanceof Error ? e.message : String(e)}`)); }}
      onDone={({ sessionKey }) => { firstRun.close(); navigate({ kind: "chat", key: sessionKey }); }}
      onTalk={sessionKey => { firstRun.close(); navigate({ kind: "chat", key: sessionKey }); }} />}
    {/* While the card is open, the window it covers steps aside: hidden and out of the Tab order (README item 48). */}
    <div className="r1-ob-behind" inert={behind} aria-hidden={behind || undefined} style={{ display: "contents", visibility: behind ? "hidden" : undefined }}>
    <Frame sidebar={sidebar} main={main} aside={towerNarrow ? undefined : towerView} beside={talk.beside} navigationKey={JSON.stringify(route)} notice={ready ? snapshot.error ?? notice : "Reconnecting…"} header={{
      title: route.kind === "chat" ? snapshot.name || "Conversation" : route.kind === "settings" ? "Settings" : placeTitle(route.place),
      face: room.header && route.kind === "chat" ? room.header.faces(24) : <Face size={24} label={snapshot.name} />, pillRef: pill, engine, onOpen: ready && route.kind === "chat" ? () => setAgentOpen(open => !open) : undefined,
      right: route.kind === "chat" ? [
        { label: "Control tower", icon: <Icon name="board" />, onClick: ready ? () => { if (stage) { setStage(null); setTower(true); saveTowerOn(true); } else toggleTower(); } : undefined },
        { label: "Computer", icon: <Icon name="monitor" />, need: "computer.status", coming: "This engine can’t show a computer.", pressed: stageShown && stage === "Computer", onClick: ready ? () => toggleStage("Computer") : undefined },
        { label: "Browser", icon: <Icon name="globe" />, need: "browser.request", coming: "This engine can’t show a browser.", pressed: stageShown && stage === "Browser", onClick: ready ? () => toggleStage("Browser") : undefined },
        // ••• opens this window's conversation menu; each of its rows declares its own call.
        { label: "More", icon: <Icon name="more" />, onClick: ready ? () => { convAnchor.current = document.querySelector<HTMLElement>('.r1-header-right [aria-label="More"]'); setConvMenu(!convMenu); } : undefined },
      ] : talk.item ? [talk.item, ...DEFAULT_TOOLS] : undefined,
      canBack: history.index > 0, canForward: history.index < history.count - 1, onBack: () => { if (history.index > 0) window.history.back(); }, onForward: () => { if (history.index < history.count - 1) window.history.forward(); },
    }} composer={route.kind === "chat" ? <Composer name={snapshot.name} placeholder={room.placeholder} replyTo={replyTo} onClearReply={() => setReplyTo(null)} engine={engine} working={Boolean(snapshot.liveRunId)} offline={!ready} limits={limits} row={current} topics={topics} running={running} mainKey={snapshot.mainKey?.split(":").slice(2).join(":") || "main"}
      petWaiting={petWaiting} lockdown={lockdown.on} onToggleLockdown={lockdown.supported ? () => void lockdown.toggle() : undefined}
      onSend={(text, extras, id) => { setReplyTo(null); void session.send(text, extras, id); }} onStop={() => void session.stopRun()} onToast={setNotice} onOpenConversation={openConversation} onOpen={target => {
      if (target === "settings/accounts/add") { sessionStorage.setItem("branch.openAddAccount", "1"); navigate({ kind: "settings", page: "accounts" }); }
      else if (target.startsWith("settings/")) navigate({ kind: "settings", page: target.slice("settings/".length) });
      else if (target === "customize/tools") navigate({ kind: "place", place: "customize" });
      else if (target === "local-model-setup") navigate({ kind: "settings", page: "local" });
    }} /> : undefined} onShortcut={action => {
      if (action === "settings") navigate({ kind: "settings", page: "appearance" });
      else if (action === "nextConversation" && rows.length) { const index = rows.findIndex(row => row.key === snapshot.sessionKey); openConversation(rows[(index + 1) % rows.length].key); }
      // Ctrl K focuses the sidebar search; a second Ctrl K, from the search, opens Find anything (CHANGELOG-PASS17 line 156).
      else if (action === "palette" && document.activeElement === search.current) setFinding(true);
      else { search.current?.focus(); }
    }} />
    {route.kind === "chat" && !stage && characterShown ? <R1Character name={current ? conversations.rows.find(row => row.isMain && row.agentId === current.agentId)?.title || snapshot.name : snapshot.name} snapshot={snapshot} waiting={snapshot.sessionKey ? waiting.get(snapshot.sessionKey) ?? 0 : 0}
      onHide={() => setCharacterShown(false)} onShow={() => setCharacterShown(true)} onChangePet={() => navigate({ kind: "settings", page: "appearance" })}
      onOpenTrunk={() => { navigate({ kind: "place", place: "people" }); window.dispatchEvent(new CustomEvent("branch:open-trunk", { detail: { agentId: current?.agentId ?? engine.agentId, view: "profile" } })); }} /> : null}
    </div>
    {/* Find anything is a shortcut, not a control: it registers hidden with the call its message rows need. */}
    <Coming engine={engine} need="sessions.search" hidden reason={FIND_ANYTHING_NAMES_ONLY} where="Find anything"><span /></Coming>
    {finding && <FindAnything session={session} ready={ready} list={list} conversations={conversations.rows.filter(row => !row.system && !row.archived && !row.helper)} current={current}
      lockdownOn={lockdown.on} onToggleLockdown={lockdown.supported ? () => void lockdown.toggle() : undefined} onOpenConversation={openConversation}
      onPlace={place => navigate({ kind: "place", place })} onSettings={page => navigate({ kind: "settings", page })} onSetup={() => firstRun.open(0)}
      onShortcuts={() => setShortcuts(true)} onClose={() => setFinding(false)} />}
    {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    {lockdown.confirmation}
    <QuickAskHost session={session} ready={ready} list={list} onOpen={openConversation} onNotice={setNotice} />
    {pip && route.kind === "chat" && !stage ? <R1StagePip key={snapshot.sessionKey ?? "none"} engine={engine} gatewayUrl={session.gatewayUrl} name={snapshot.name} computer={pip} blocks={[...snapshot.history, ...snapshot.live]} onOpen={() => { setStage(pip.kind === "browser" ? "Browser" : "Computer"); setPip(null); }} onClose={() => setPip(null)} /> : null}
    <Toasts />
    <ApprovalsLayer engine={engine} ready={ready} more={problems} sessionKey={route.kind === "chat" ? snapshot.sessionKey : null} view={route.kind === "chat" ? "chat" : "other"} onOpen={openConversation} />
    {/* The approved ••• menu (Pin, Rename, Snooze, Archive, Send to the board, Export, View, Start over, Delete) and its dialogs. */}
    {route.kind === "chat" ? <ConversationMenu session={session} open={convMenu} anchor={convAnchor} onClose={() => setConvMenu(false)} sessionKey={snapshot.sessionKey}
      row={current ?? null} isDefault={Boolean(snapshot.sessionKey && snapshot.sessionKey === snapshot.mainKey)} list={list} name={snapshot.name || "Conversation"} history={snapshot.history}
      work={work} onOpen={openConversation} mainKey={snapshot.mainKey} onPlace={place => navigate({ kind: "place", place })} room={room.menu}
      changesNeed={CHANGES_NEED} onChanges={() => { setStage(null); setPip(null); setChanges(true); setConvMenu(false); }} /> : null}
    {agentOpen && <Popover anchor={pill} label="Agent details" onClose={closeAgent}><div className="r1-agent-details g-clear">
      <strong className="g-label">{identity?.name ?? snapshot.name}</strong>{agentLine ? <p className="g-label">{agentLine}</p> : null}
      {room.header ? <p className="g-label" data-testid="room-members">{room.header.line}</p> : null}
      {route.kind === "chat" ? <button type="button" data-local="" onClick={() => { setCharacterShown(!characterShown); closeAgent(); }}>{characterShown ? "Hide the character" : "Show the character"}</button> : null}
      <button type="button" data-local="" onClick={closeAgent}>Close</button>
    </div></Popover>}
  </>;
}
