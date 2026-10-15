import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SaplingSession } from "../../connect/session";
import { useContacts, useConversations, useMachine, usePendingApprovals, useTrunks } from "../../shell/engine-data";
import { listContactTopics } from "../../shell/contacts-model";
import { Frame } from "./Frame";
import { DEFAULT_TOOLS } from "./Header";
import { useTalkBeside } from "../talk/TalkBesideHost";
import { ChatView } from "../chat/ChatView";
import { useWorkMode } from "../chat/chat-logic";
import type { ReplyTarget } from "../../thread/useMessageActions";
import { Composer } from "../composer/Composer";
import { COMPOSE_EVENT } from "../../composer/Composer";
import { safeStorage, saveDraft } from "../../composer/drafts";
import { requestCustomize, type PromptHandoff } from "../../places/customize/r1-request";
import { NewTrunkCard, type NewTrunk } from "../../shell/NewTrunkFlow";
import { conversationActions } from "../../shell/conversation-actions";
import { makeRandomTrunk } from "../../places/trunk/new-trunk-r1";
import { useLimits } from "../../shell/use-status";
import { useLockdown } from "../../shell/use-lockdown";
import { Face } from "../../face/Face";
import { Icon } from "../../shell/icons";
import { PlaceView } from "../../places-nav/PlaceView";
import { placeRequest } from "../../places-nav/place-request";
import { PLACES, loadRoute, parseRoute, placeTitle, saveRoute, windowTitle, type PlaceId, type Route } from "../../places-nav/routes";
import { SettingsFrame as ClassicSettingsFrame } from "../../places-nav/SettingsFrame";
import { PAGES as R1_PAGE_SPECS, r1PageFor } from "../settings/nav";
import { SettingsFrame } from "../settings";
import { R1_PAGES } from "../settings/pages/plugged";
import { placePages } from "../settings/pages/places-live";
import { useSettingsSearch } from "./settings-search";
import { ROWS } from "../settings/rows";
import { mergeRows, type PageSlots } from "../settings/slots";
import type { Row } from "../settings/rows";
import { lookStore } from "../../places/settings/set1/appearance-store";
import { Sidebar } from "../sidebar/Sidebar";
import { Toasts } from "../../shell/Toasts";
import { R1ExtraDialogs } from "./R1ExtraDialogs";
import { ApprovalsLayer, useAsks } from "../approvals";
import { useProblemBannerRows } from "../approvals/ProblemBanners";
import { Coming } from "../../glass/coming";
import { useFirstRun } from "../../setup/use-first-run";
import { displayTrunkTitle } from "../../connect/trunk-name";
import { Onboarding } from "../onboarding";
import { recordOnboarding } from "../onboarding/finish";
import { helloOk } from "../onboarding/model";
import { DEFAULT_TRUNK_WHY, TEMPLATE_TRUNK_WHY } from "../chat/examples-greeting";
import { ThreadExtras } from "./ThreadExtras";
import { WhatsNewHost } from "../updates/WhatsNewHost";
import { R1Tour, type R1TourKind } from "../onboarding/R1Tour";
import { useR1Topics } from "./Topics";
import { useMarkRead } from "./use-mark-read";
import { FindAnything } from "../find/FindAnything";
import { FIND_ANYTHING_EVENT } from "../find/find-event";
import { ShortcutsDialog } from "../../shell/ShortcutsDialog";
import { ConversationMenu } from "./ConversationMenu";
import { R1Stage, R1StagePip } from "../stage/R1Stage";
import { useR1Room } from "./use-r1-room";
import { QuickAskHost } from "../quickask/QuickAskHost";
import type { PipTarget, StageMode } from "../../stage/ComputerStage";
import { R1HelpersPanel } from "../helpers/R1HelpersPanel";
import { R1SidePane, PANE_TAB_NEEDS } from "../pane/R1SidePane";
import { DEFAULT_PANE_TAB, type PaneTab } from "../../stage/SidePane";
import { paneKeyFor, shortcutFor } from "../../shell/use-shortcuts";
import { currentKeys, keyActions, readCustomKeys } from "../../shell/keymap";
import { availability } from "../../connect/capabilities";
import { CHANGES_NEED, R1Changes } from "../changes/R1Changes";
import { R1Character, useR1CharacterShown } from "../character/R1Character";
import { graftedContactOf, isGraftedContactKey, newestGraftedTopic, openConversationName } from "./open-name";
import { GraftedEmpty, GraftedFace } from "./GraftedEmpty";
import { agentIdOf, roomIdOf } from "../../connect/session";
import { R1DetailsPanel } from "../details/R1DetailsPanel";

const FIND_ANYTHING_NAMES_ONLY = "Message search needs a newer Branch engine. Find anything lists names only.";

/** Places R1 Settings search can open (its Go to group). */
const SETTINGS_PLACES = PLACES.map(place => ({ id: place.id, label: place.name }));

/** Header and window title for a place. Seedbank has no sidebar row, so it has no PLACES name. */
/** The header title of a place that has no sidebar row (preview: the Grove button reads "Grove"). */

/**
 * Pages that keep the Classic page although R1 has a slot for them, because the R1 port still lacks working Classic
 * features. None is left: Appearance, Chat apps and Accounts each draw every working Classic control in R1
 * (settings/pages/appearance-live.tsx, screens/chatapps, settings/pages/accounts-live.tsx; #976).
 */
const KEEP_CLASSIC: ReadonlySet<string> = new Set<string>();

/**
 * R1 Settings page ids the Classic frame knows by another name, for a page R1 still hands to Classic: each goes to the
 * Classic page whose sections it has, so it never falls back to Classic General. A row goes when its R1 page lands.
 */
export const CLASSIC_PAGE: Readonly<Record<string, string>> = {
  card: "people", // Your card: the person's own card on Classic People
  trunks: "advanced", // Trunks, Trunks' model and Trunks and other agents
  browser: "computer", // Computer & browser: the screen and the browser
  coding: "computer", // Computer & browser: code and commits, repositories
};

/**
 * Settings pages that are a place: Automations and Memory & documents open the place that has their controls
 * (Memory & documents opens Library on its Memory tab). Customize is an R1 Settings page of its own.
 */
export const SETTINGS_PLACE: Readonly<Record<string, { place: PlaceId; tab?: string }>> = {
  autos: { place: "automations" },
  memory: { place: "library", tab: "memory" },
};

/** The route a link, a saved route or a nav item really opens: a Settings page that is a place (by its id or an old id
 *  for it) opens that place. An old id for Customize opens the R1 Customize page. Every other route is itself. */
export function resolveRoute(route: Route): Route {
  if (route.kind !== "settings") return route;
  const page = r1PageFor(route.page);
  const target = SETTINGS_PLACE[page];
  if (target) return { kind: "place", place: target.place };
  if (page === "customize" && route.page !== "customize") return { kind: "settings", page: "customize" };
  return route;
}

/** Seedbank is Customize's Community now: the Seedbank pill and a saved seedbank route both open Customize in Community. */
export function r1Route(route: Route): Route {
  const resolved = resolveRoute(route);
  if (resolved.kind !== "place" || resolved.place !== "seedbank") return resolved;
  requestCustomize({ mode: "community" });
  return { kind: "place", place: "customize" };
}

/** The tab a Settings page that is a place opens on, told to the place after it shows (as WindowShell does). */
function openPlaceTab(route: Route): void {
  const target = route.kind === "settings" ? SETTINGS_PLACE[r1PageFor(route.page)] : undefined;
  if (target?.tab) setTimeout(() => window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: target.place, tab: target.tab } })), 0);
}

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
/** A Trunk's name for its main conversation, as a person reads it (the default Trunk reads as Sapling, not "main"); "" when none. */
function mainTitle(rows: ReadonlyArray<{ title: string; isMain: boolean; agentId?: string }>, agentId: string | undefined): string {
  if (!agentId) return "";
  const main = rows.find(row => row.isMain && row.agentId === agentId);
  return main ? displayTrunkTitle(main.title, agentId) : "";
}

export function R1Window({ session }: { session: SaplingSession }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const ready = snapshot.status.phase === "connected", engine = session.engine;
  const [conversations, list] = useConversations(session, ready, snapshot.mainKey);
  const waiting = usePendingApprovals(session, ready);
  const limits = useLimits(session, ready);
  const lockdown = useLockdown(engine, ready, session, true);
  // One list of what waits for a yes, shared by the conversation cards and the banners and drop (approvals/ApprovalsLayer).
  const approvals = useAsks(ready ? engine : null, lockdown.on);
  const machine = useMachine(session, ready);
  // The re-hosted Classic character panel (parity row 19), shown beside the conversation unless hidden.
  const [characterShown, setCharacterShown] = useR1CharacterShown(engine);
  const [route, setRoute] = useState<Route>(() => r1Route(loadRoute()));
  const trunks = useTrunks(session, ready);
  const contactsState = useContacts(session, ready);
  const graftedNames = useMemo(() => new Map(contactsState[0].filter(contact => contact.kind === "outside").map(contact => [contact.id, contact.name])), [contactsState]);
  // A grafted agent's row names its contact (a2a:<peer>), not a conversation: the window finds that agent's own conversation.
  const graftedKey = route.kind === "chat" && isGraftedContactKey(route.key) ? route.key : null;
  const [graftedNone, setGraftedNone] = useState<{ key: string; error: boolean } | null>(null);
  const current = graftedKey ? undefined : conversations.rows.find(row => row.key === snapshot.sessionKey);
  // The main column shows the open conversation (not a grafted agent's empty state), so its tools act on it.
  const chat = route.kind === "chat" && !graftedKey, tools = ready && chat;
  // The open conversation's name (its Trunk, group or grafted agent): the session's own name is the default Trunk's.
  const nameInput = { trunks: trunks.list, grafted: graftedNames, defaultAgentId: snapshot.mainKey ? agentIdOf(snapshot.mainKey) : undefined, fallback: snapshot.name };
  const name = openConversationName({ ...nameInput, key: graftedKey ?? snapshot.sessionKey, row: current });
  // In a conversation with a grafted agent, its Trunk answers what you type there, so the thread and the composer name that Trunk.
  const graftedTrunk = !graftedKey && graftedContactOf(snapshot.sessionKey) ? agentIdOf(snapshot.sessionKey ?? "") : undefined;
  const speaker = graftedTrunk ? openConversationName({ ...nameInput, key: `agent:${graftedTrunk}:main` }) : name;
  // The re-hosted Classic computer stage (parity row 1): which side is open, and the small window it shrinks to.
  const [stage, setStage] = useState<StageMode | null>(null);
  const [pip, setPip] = useState<PipTarget | null>(null);
  // The re-hosted Classic helpers view (parity row 3): open for one conversation; each chip press scrolls to its helpers.
  const [helpersView, setHelpersView] = useState<{ key: string | null; focus: number } | null>(null);
  const helpersOpen = helpersView !== null && helpersView.key === snapshot.sessionKey;
  // The re-hosted Classic side panel (parity row 2): its open tab, or null while it is closed.
  const [pane, setPane] = useState<PaneTab | null>(null);
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
  const [agentOpen, setAgentOpen] = useState(false);
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
  // Parity row 14: the 3-card walkthrough after setup's first conversation, and Guide › Take the full tour.
  const [tour, setTour] = useState<R1TourKind | null>(null);
  // A conversation started with "Try it with examples" shows its introduction until a message is sent (examples-greeting.ts).
  const [examples, setExamples] = useState<{ key: string; why: string } | null>(null);
  // A clear card or dialog over the whole window: the window behind it steps aside (README item 48).
  const behind = onboarding || finding;
  // The details panel the pill docks (GOD queue item 3): closing it hands focus back to the pill.
  const closeAgent = useCallback(() => { setAgentOpen(false); pill.current?.focus(); }, []);
  const applyRoute = useCallback((raw: Route) => {
    const next = r1Route(raw);
    saveRoute(next); setRoute(next); setAgentOpen(false);
    if (next.kind === "chat") { const key = next.key ?? session.getSnapshot().mainKey; if (key && !isGraftedContactKey(key) && key !== session.getSnapshot().sessionKey) void session.open(key); }
  }, [session]);
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, r1Index: 0, r1Route: entries.current[0] }, "");
    const pop = (event: PopStateEvent) => {
      const index = event.state?.r1Index;
      const saved = parseRoute(JSON.stringify(event.state?.r1Route));
      const next = saved && r1Route(saved);
      if (typeof index !== "number" || index < 0 || index >= entries.current.length || !next) return;
      setHistory({ index, count: entries.current.length }); applyRoute(next);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
    // This window owns only entries created during this mount; it never navigates outside them.
  }, [applyRoute]);
  const navigate = (asked: Route) => {
    const next = r1Route(asked);
    openPlaceTab(asked);
    if (JSON.stringify(next) === JSON.stringify(route)) return;
    const index = history.index + 1;
    entries.current = [...entries.current.slice(0, index), next];
    window.history.pushState({ ...window.history.state, r1Index: index, r1Route: next }, "");
    setHistory({ index, count: entries.current.length }); applyRoute(next);
  };
  // Swaps the current entry for another, as a grafted agent's row does once its conversation is found.
  const replace = (next: Route) => {
    entries.current[history.index] = next;
    window.history.replaceState({ ...window.history.state, r1Index: history.index, r1Route: next }, "");
    applyRoute(next);
  };
  const replaceTo = useRef(replace);
  useEffect(() => { replaceTo.current = replace; });
  useEffect(() => {
    if (!graftedKey || !ready) return;
    let live = true;
    const look = () => void listContactTopics(graftedKey, (method, params) => session.request(method, params)).then(
      topics => {
        if (!live) return;
        const key = newestGraftedTopic(topics);
        if (key) replaceTo.current({ kind: "chat", key }); else setGraftedNone({ key: graftedKey, error: false });
      },
      () => { if (live) setGraftedNone({ key: graftedKey, error: true }); },
    );
    look();
    // Its first conversation opens here as soon as it starts.
    const off = session.onGatewayEvent(event => { if (event === "contacts.changed") look(); });
    return () => { live = false; off(); };
  }, [graftedKey, ready, session]);
  useEffect(() => { if (ready) void lookStore(engine).load(); }, [ready, engine]);
  // Re-hosted Classic Settings pages open a place with branch:navigate-place (Classic WindowShell's event): R1 opens it here.
  const navigateTo = useRef(navigate);
  useEffect(() => { navigateTo.current = navigate; });
  // Settings' "Find anything" row opens the same palette as Ctrl K.
  useEffect(() => {
    const open = () => setFinding(true);
    window.addEventListener(FIND_ANYTHING_EVENT, open);
    return () => window.removeEventListener(FIND_ANYTHING_EVENT, open);
  }, []);
  useEffect(() => {
    // Ctrl/Cmd+Shift+T opens the Inbox, as in the preview (preview.html:40670, 42502).
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "t") return;
      event.preventDefault(); navigateTo.current({ kind: "place", place: "inbox" });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    const openPlace = (event: Event) => {
      const request = placeRequest((event as CustomEvent).detail, PLACES.map(p => p.id));
      if (!request) return;
      navigateTo.current({ kind: "place", place: request.place });
      // A tab named with the request is told to the place once it shows, as openPlaceTab does for Settings pages.
      if (request.tab) {
        const tab = request.tab;
        setTimeout(() => window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: request.place, tab } })), 0);
      }
    };
    window.addEventListener("branch:navigate-place", openPlace);
    return () => window.removeEventListener("branch:navigate-place", openPlace);
  }, []);
  // Settings › Updates & about › Show the welcome tour.
  useEffect(() => {
    const openTour = () => setTour("full");
    window.addEventListener("branch:welcome-tour", openTour);
    return () => window.removeEventListener("branch:welcome-tour", openTour);
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
    // Classic's keys, under the person's own: Ctrl Shift K shows or hides the side panel, the pane keys open a tab
    // (Ctrl ` Terminal, Ctrl Shift B Files, Side chat) or the computer stage. A key this engine can't serve does nothing.
    if (!ready || route.kind !== "chat") return;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const keys = currentKeys(keyActions(""), readCustomKeys());
      if (shortcutFor(event, mac, keys) === "sidePanel") {
        if (availability(engine, PANE_TAB_NEEDS[DEFAULT_PANE_TAB][0]!) === "no") return;
        event.preventDefault(); setPane(open => open ? null : DEFAULT_PANE_TAB); return;
      }
      const tab = paneKeyFor(event, mac, keys);
      if (tab === "Browser" || tab === "Computer") {
        if (availability(engine, tab === "Browser" ? "browser.request" : "computer.status") === "no") return;
        event.preventDefault(); setPip(null); setStage(open => open === tab ? null : tab);
      } else if (tab) { event.preventDefault(); setPane(open => open === tab ? null : tab); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ready, route.kind, engine]);
  useEffect(() => {
    document.title = windowTitle(route.kind === "chat" ? name : route.kind === "settings" ? "Settings" : placeTitle(route.place), waiting.size, !ready);
  }, [route, name, waiting.size, ready]);
  const openConversation = (key: string) => {
    // A grafted agent's row while its conversation is already open stays where it is.
    if (isGraftedContactKey(key) && route.kind === "chat" && !graftedKey && graftedContactOf(snapshot.sessionKey) === key) return;
    navigate({ kind: "chat", key });
  };
  // + › New Trunk and the Grove's Trunk button: a random Trunk, its conversation, then the two questions above the box.
  const [newTrunkFlow, setNewTrunkFlow] = useState<NewTrunk | null>(null);
  const trunkActions = useMemo(() => conversationActions((method, params) => session.request(method, params), list, () => session.getSnapshot().mainKey), [session, list]);
  const newTrunk = async () => {
    try {
      const flow = await makeRandomTrunk(engine, agentId => trunkActions.create(agentId));
      if (!flow) return;
      setNewTrunkFlow(flow);
      openConversation(flow.sessionKey);
    } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
  };
  // Customize's Use: the command goes into the default Trunk's composer as a draft, and the conversation opens.
  const promptKey = session.getSnapshot().mainKey;
  const usePromptText: PromptHandoff = {
    ready: Boolean(promptKey),
    use: (text: string) => {
      const key = session.getSnapshot().mainKey;
      if (!key) return;
      saveDraft(safeStorage(), key, text);
      window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: { sessionKey: key, text } }));
      openConversation(key);
    },
  };
  // Settings › Learn more › Ask a Trunk (#977): the default Trunk's conversation opens and the question is sent there.
  const askTrunk = (text: string) => {
    const key = session.getSnapshot().mainKey;
    if (!key) { setNotice("Couldn’t find your default Trunk."); return; }
    void (async () => {
      try { await session.open(key); navigate({ kind: "chat", key }); await session.send(text); }
      catch (e) { setNotice(`Couldn’t ask your Trunk: ${e instanceof Error ? e.message : String(e)}`); }
    })();
  };
  // Go to, Seedbank and All features draw R1 screens in the Settings frame and go through the latest navigate.
  const goRef = useRef(navigate);
  goRef.current = navigate;
  const settingsPages = useMemo<PageSlots>(() => ({ ...R1_PAGES, ...placePages(next => goRef.current(next)) }), []);
  // Settings search also finds Trunks (open, Make default, New Trunk) and features (HANDOFF R1-06, #1049).
  const settingsSearch = useSettingsSearch({ session, engine, ready, list, open: route.kind === "settings", navigate: next => goRef.current(next), onNotice: setNotice,
    mainKey: id => conversations.rows.find(row => row.isMain && row.agentId === id)?.key });
  const rows = conversations.rows.filter(row => !row.system && !row.archived && !row.helper);
  // A room (group chat, or Trunks and people writing here): the Classic room hook, re-hosted (rooms/useShellRoom).
  const room = useR1Room(session, ready, snapshot.sessionKey, current ?? null, name, snapshot.history, trunks);
  const topics = current?.isMain ? conversations.rows.filter(row => row.agentId === current.agentId && row.key !== current.key && !row.isMain && !row.system && !row.archived && !row.helper).map(row => ({ key: row.key, title: row.title })) : [];
  // The open Trunk's threads (Classic TopicRail): in the topics column, or above the chat for Tabs and narrow windows.
  const threads = useR1Topics({ session, ready, rows: conversations.rows, list, currentKey: route.kind === "chat" ? snapshot.sessionKey : null,
    mainSuffix: snapshot.mainKey?.split(":").slice(2).join(":") || "main", trunkName: speaker, onOpen: openConversation });
  // Opening a conversation clears its unread flag once per unread episode (Classic read-on-open, connect/unread-guard.ts).
  const markRequest = useCallback((method: string, params?: unknown) => session.request(method, params), [session]);
  const refreshList = useCallback(() => { void list.refresh(); }, [list]);
  useMarkRead(markRequest, current ?? null, ready && route.kind === "chat", refreshList);
  const workingKeys = useMemo(() => conversations.rows.filter(row => row.working).map(row => row.key), [conversations.rows]);
  const running = conversations.rows.filter(row => row.working).map(row => ({ key: row.key, title: row.isMain && row.agentId ? displayTrunkTitle(row.title, row.agentId) : row.title, line: row.preview, needsYou: row.needsYou }));
  // The roaming pet's tip names the first Trunk waiting on a yes, as in Classic.
  const waitingRow = conversations.rows.find(row => (waiting.get(row.key) ?? 0) > 0);
  const petWaiting = waitingRow ? mainTitle(conversations.rows, waitingRow.agentId) || waitingRow.title : null;
  const sidebar = <Sidebar onNewTrunk={() => void newTrunk()} session={session} ready={ready} list={list} sessions={conversations.rows} mainKey={snapshot.mainKey}
    currentKey={route.kind === "chat" ? graftedKey ?? graftedContactOf(snapshot.sessionKey) ?? snapshot.sessionKey : null} waiting={waiting} contacts={contactsState} searchRef={search} onOpen={openConversation}
    onSettings={page => navigate({ kind: "settings", page })} onPlace={place => navigate({ kind: "place", place })} onTour={() => setTour("full")} error={conversations.error} />;
  const main = route.kind === "settings" && !r1SettingsPage(route.page, settingsPages) ? <ClassicSettingsFrame keepLevel page={CLASSIC_PAGE[route.page] ?? route.page} heading={(R1_PAGE_SPECS as Record<string, { title: string } | undefined>)[r1PageFor(route.page)]?.title} backName={name || "Conversation"} engine={engine} onPage={page => navigate({ kind: "settings", page })} onBack={() => navigate({ kind: "chat", key: snapshot.sessionKey })} /> : route.kind === "settings" ? <SettingsFrame engine={engine} page={route.page} pages={settingsPages} places={SETTINGS_PLACES} {...settingsSearch} onAsk={ready ? askTrunk : undefined} onPage={page => navigate({ kind: "settings", page })} onOpenPlace={id => { const place = PLACES.find(p => p.id === id); if (place) navigate({ kind: "place", place: place.id }); }} /> : graftedKey ? <GraftedEmpty name={name} state={graftedNone?.key === graftedKey ? (graftedNone.error ? "error" : "none") : "looking"} /> : route.kind === "place" ? <PlaceView place={route.place} r1 usePrompt={usePromptText} engine={engine} createTrunk={() => void newTrunk()} facts={{ running: conversations.rows.filter(row => row.working).length, waiting: waiting.size }} openConversation={openConversation} openPlace={place => navigate({ kind: "place", place })} openSettings={page => navigate({ kind: "settings", page })} /> : changes ? <R1Changes key={snapshot.sessionKey ?? "none"} engine={engine} name={name} onClose={closeChanges} /> : stage ? <R1Stage key={snapshot.sessionKey ?? "none"} engine={engine} gatewayUrl={session.gatewayUrl} name={name} mode={stage} blocks={[...snapshot.history, ...snapshot.live]} running={Boolean(snapshot.liveRunId)}
    onMode={setStage} onClose={closeStage} onChooseComputer={() => navigate({ kind: "settings", page: "devices" })} onPip={small => { setPip(small); setStage(null); }} /> : <>{threads.above}<ChatView
    name={speaker} history={threads.history ?? snapshot.history} historyReady={snapshot.historyReady} live={snapshot.live} pendingUser={snapshot.pendingUser} queued={snapshot.queued} steered={snapshot.steered} running={Boolean(snapshot.liveRunId)} ended={snapshot.ended}
    engine={engine} sessionKey={snapshot.sessionKey} examplesWhy={examples?.key === snapshot.sessionKey ? examples.why : undefined} onAnswer={(id, answer) => void session.answer(id, answer)} asks={approvals.asks} onAsk={(id, reply) => void approvals.answer(id, reply)} lockdown={lockdown.on} onReload={() => void session.reload()} onOpenSession={openConversation} onToast={setNotice}
    onStart={ready ? (text) => void session.send(text) : undefined} onReply={setReplyTo} onOpenHelpers={() => setHelpersView(open => ({ key: snapshot.sessionKey, focus: (open?.focus ?? 0) + 1 }))} room={room.thread}
  /></>;
  const shown = chat && !stage && helpersOpen ? <div className="r1-with-helpers">{main}<R1HelpersPanel key={snapshot.sessionKey ?? "none"} engine={engine} name={name} blocks={[...snapshot.history, ...snapshot.live]} running={Boolean(snapshot.liveRunId)}
    focus={helpersView.focus} onClose={() => setHelpersView(null)} onToast={setNotice} /></div> : main;
  // Problem and news banners (the Classic hooks), drawn in the approvals banner stack.
  const problems = useProblemBannerRows({ session, shownKey: route.kind === "chat" ? snapshot.sessionKey : null, machineName: machine?.name ?? "",
    defaultName: mainTitle(conversations.rows, conversations.rows.find(row => row.key === snapshot.mainKey)?.agentId) || "your Trunk", onOpen: openConversation,
    titleOf: key => conversations.rows.find(row => row.key === key)?.title || "A conversation",
    trunkOf: key => { const row = conversations.rows.find(r => r.key === key); return mainTitle(conversations.rows, row?.agentId) || row?.title || "Your Trunk"; },
    onOpenConnection: () => navigate({ kind: "settings", page: "devices" }),
    onAsk: text => { const key = snapshot.mainKey; if (!key) return; openConversation(key); void session.open(key).then(() => session.send(text)); } });
  // Talk beside (parity row 20): the default Trunk beside a place, as in Classic.
  const talk = useTalkBeside({ shown: route.kind === "place", request: (method, params) => session.request(method, params), onEvent: listener => session.onGatewayEvent(listener), mainKey: snapshot.mainKey,
    name: conversations.rows.find(row => row.key === snapshot.mainKey)?.title || "your Trunk", page: route.kind === "place" ? PLACES.find(p => p.id === route.place)?.name ?? placeTitle(route.place) : "", onFull: openConversation });
  // The agent details popover's second line: the open Trunk's emoji, from the Trunks list the window already has (none without one).
  const openAgent = graftedKey || graftedContactOf(snapshot.sessionKey) ? undefined : agentIdOf(snapshot.sessionKey ?? "");
  const agentLine = openAgent ? trunks.list.find(trunk => trunk.id === openAgent)?.emoji ?? "" : "";
  // The Trunk behind this conversation (none for a grafted agent): its row's agent, or the agent named in its session key.
  const agentTrunkId = graftedKey || graftedContactOf(snapshot.sessionKey) ? undefined : current?.agentId ?? openAgent;
  const openAgentTrunk = (view: "edit" | "profile") => {
    closeAgent();
    navigate({ kind: "place", place: "people" });
    window.dispatchEvent(new CustomEvent("branch:open-trunk", { detail: { agentId: agentTrunkId, view } }));
  };
  // The pill docks the details panel: a Trunk's Details, Library and Computer, or a group's Members (GOD queue item 3).
  // A grafted agent's contact (a2a:<peer>) opens it too: the pill names that agent, as the Agent details popover did.
  const group = Boolean(room.header && chat);
  const details = agentOpen && route.kind === "chat" ? <R1DetailsPanel key={graftedKey ?? snapshot.sessionKey ?? "none"} session={session} engine={engine} ready={ready} kind={group ? "group" : graftedKey ? "grafted" : "trunk"} name={name}
    face={group ? room.header!.faces(84) : graftedKey || graftedContactOf(snapshot.sessionKey) ? <GraftedFace name={name} size={84} /> : <Face size={84} label={name} />}
    line={group ? room.header!.line : agentLine} agentId={group ? undefined : agentTrunkId} roomId={group ? roomIdOf(snapshot.sessionKey ?? "") || null : undefined} memberNames={room.members}
    trunks={trunks.list.map(trunk => ({ id: trunk.id, name: trunk.name }))} gatewayUrl={session.gatewayUrl} blocks={[...snapshot.history, ...snapshot.live]} running={Boolean(snapshot.liveRunId)}
    onClose={closeAgent} onOpenStage={mode => { setAgentOpen(false); toggleStage(mode); }} onPip={small => { setAgentOpen(false); setPip(small); }} onChooseComputer={() => navigate({ kind: "settings", page: "devices" })} openConversation={openConversation}
    actions={<>
      {/* Clicking a Trunk's name is where people look to change it (owner, 2026-10-15): Customize opens its editor and Profile
          its page, through People's TrunkHost like the ⋯ menu and the character do. */}
      {agentTrunkId ? <>
        <button type="button" data-local="" onClick={() => openAgentTrunk("edit")}>Customize</button>
        <button type="button" data-local="" onClick={() => openAgentTrunk("profile")}>Profile</button>
      </> : null}
      <button type="button" data-local="" onClick={() => { setCharacterShown(!characterShown); closeAgent(); }}>{characterShown ? "Hide the character" : "Show the character"}</button>
    </>} /> : null;
  return <>
    {onboarding && <Onboarding engine={engine} startAt={firstRun.step ?? 0}
      onLater={state => { firstRun.close(); void recordOnboarding(engine, state).catch((e: unknown) => setNotice(`Couldn’t save that setup is done: ${e instanceof Error ? e.message : String(e)}`)); }}
      onDone={({ sessionKey, made, state }) => {
        firstRun.close();
        if (state.examples && !helloOk(state.hello)) setExamples({ key: sessionKey, why: made.length ? TEMPLATE_TRUNK_WHY : DEFAULT_TRUNK_WHY });
        navigate({ kind: "chat", key: sessionKey }); setTour("intro");
      }}
      onTalk={sessionKey => { firstRun.close(); navigate({ kind: "chat", key: sessionKey }); }} />}
    {tour ? <R1Tour kind={tour} defaultName={conversations.rows.find(row => row.key === snapshot.mainKey)?.title || "your Trunk"} onClose={() => setTour(null)} /> : null}
    {/* While the card is open, the window it covers steps aside: hidden and out of the Tab order (README item 48). */}
    <div className="r1-ob-behind" inert={behind} aria-hidden={behind || undefined} style={{ display: "contents", visibility: behind ? "hidden" : undefined }}>
    <Frame sidebar={sidebar} main={shown} freeLayout={threads.layout === "free"} topics={chat ? threads.column ?? undefined : undefined} beside={talk.beside} pane={details ?? (pane && ready && chat ? <R1SidePane key={snapshot.sessionKey ?? "none"} engine={engine} name={name} title={name || "Conversation"}
      blocks={[...snapshot.history, ...snapshot.live]} running={Boolean(snapshot.liveRunId)} tab={pane} onTab={setPane} onClose={() => setPane(null)} toast={setNotice} onReload={() => void session.reload()} /> : undefined)} navigationKey={JSON.stringify(route)} notice={ready ? snapshot.error ?? notice : "Reconnecting…"} header={{
      title: route.kind === "chat" ? name || "Conversation" : route.kind === "settings" ? "Settings" : placeTitle(route.place),
      face: room.header && chat ? room.header.faces(24) : graftedKey || graftedContactOf(snapshot.sessionKey) ? <GraftedFace name={name} size={24} /> : <Face size={24} label={name} />, pillRef: pill, engine, onOpen: ready && route.kind === "chat" ? () => { setPane(null); setAgentOpen(open => !open); } : undefined,
      right: route.kind === "chat" ? [
        { label: "Computer", icon: <Icon name="monitor" />, need: "computer.status", coming: "This engine can’t show a computer.", pressed: stageShown && stage === "Computer", onClick: tools ? () => toggleStage("Computer") : undefined },
        { label: "Browser", icon: <Icon name="globe" />, need: "browser.request", coming: "This engine can’t show a browser.", pressed: stageShown && stage === "Browser", onClick: tools ? () => toggleStage("Browser") : undefined },
        { label: "Side panel", icon: <Icon name="panel" />, need: PANE_TAB_NEEDS[DEFAULT_PANE_TAB], coming: "This engine can’t show the side panel.", onClick: tools ? () => { setAgentOpen(false); setPane(open => open ? null : DEFAULT_PANE_TAB); } : undefined },
        // ••• opens this window's conversation menu; each of its rows declares its own call.
        { label: "More", icon: <Icon name="more" />, onClick: tools ? () => { convAnchor.current = document.querySelector<HTMLElement>('.r1-header-right [aria-label="More"]'); setConvMenu(!convMenu); } : undefined },
      ] : talk.item ? [talk.item, ...DEFAULT_TOOLS] : undefined,
      canBack: history.index > 0, canForward: history.index < history.count - 1, onBack: () => { if (history.index > 0) window.history.back(); }, onForward: () => { if (history.index < history.count - 1) window.history.forward(); },
    }} composer={chat ? <><ThreadExtras session={session} ready={ready} name={speaker} row={current ?? null} history={snapshot.history} ended={snapshot.ended}
      empty={snapshot.historyReady !== false && !snapshot.history.length && !snapshot.pendingUser && !snapshot.liveRunId} onOpen={openConversation} />{newTrunkFlow && newTrunkFlow.sessionKey === snapshot.sessionKey ? <NewTrunkCard engine={engine} flow={newTrunkFlow} onDone={() => setNewTrunkFlow(null)} onChangeLook={() => { navigate({ kind: "place", place: "people" }); window.dispatchEvent(new CustomEvent("branch:open-trunk", { detail: { agentId: newTrunkFlow.agentId, view: "edit" } })); }} /> : null}<Composer name={speaker} placeholder={room.placeholder} replyTo={replyTo} onClearReply={() => setReplyTo(null)} engine={engine} working={Boolean(snapshot.liveRunId)} offline={!ready} limits={limits} row={current} topics={topics} running={running} mainKey={snapshot.mainKey?.split(":").slice(2).join(":") || "main"}
      petWaiting={petWaiting} lockdown={lockdown.on} onToggleLockdown={lockdown.supported ? () => void lockdown.toggle() : undefined}
      onSend={(text, extras, id) => { setReplyTo(null); void session.send(text, extras, id); }} onStop={() => void session.stopRun()} onToast={setNotice} onOpenConversation={openConversation} onOpen={target => {
      if (target === "settings/accounts/add") { sessionStorage.setItem("branch.openAddAccount", "1"); navigate({ kind: "settings", page: "accounts" }); }
      else if (target.startsWith("settings/")) navigate({ kind: "settings", page: target.slice("settings/".length) });
      else if (target === "customize/tools") navigate({ kind: "place", place: "customize" });
      else if (target === "local-model-setup") navigate({ kind: "settings", page: "local" });
    }} /></> : undefined} onShortcut={action => {
      if (action === "settings") navigate({ kind: "settings", page: "appearance" });
      else if (action === "nextConversation" && rows.length) { const index = rows.findIndex(row => row.key === snapshot.sessionKey); openConversation(rows[(index + 1) % rows.length].key); }
      // Ctrl K focuses the sidebar search; a second Ctrl K, from the search, opens Find anything (CHANGELOG-PASS17 line 156).
      else if (action === "palette" && document.activeElement === search.current) setFinding(true);
      else { search.current?.focus(); }
    }} />
    {chat && !stage && characterShown ? <R1Character name={current ? mainTitle(conversations.rows, current.agentId) || name : name} snapshot={snapshot} waiting={snapshot.sessionKey ? waiting.get(snapshot.sessionKey) ?? 0 : 0}
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
    <WhatsNewHost session={session} ready={ready} onSettings={page => navigate({ kind: "settings", page })} onSearch={() => search.current?.focus()} onSetup={() => firstRun.open(0)} onNotice={setNotice} />
    <QuickAskHost session={session} ready={ready} list={list} onOpen={openConversation} onNotice={setNotice} />
    {pip && chat && !stage ? <R1StagePip key={snapshot.sessionKey ?? "none"} engine={engine} gatewayUrl={session.gatewayUrl} name={name} computer={pip} blocks={[...snapshot.history, ...snapshot.live]} onOpen={() => { setStage(pip.kind === "browser" ? "Browser" : "Computer"); setPip(null); }} onClose={() => setPip(null)} /> : null}
    <Toasts />
    <R1ExtraDialogs engine={engine} ready={ready} limits={limits} working={workingKeys} />
    <ApprovalsLayer engine={engine} ready={ready} approvals={approvals} more={problems} sessionKey={route.kind === "chat" ? snapshot.sessionKey : null} view={route.kind === "chat" ? "chat" : "other"} onOpen={openConversation} />
    {/* The approved ••• menu (Pin, Rename, Snooze, Archive, Send to the board, Export, View, Start over, Delete) and its dialogs. */}
    {chat ? <ConversationMenu session={session} open={convMenu} anchor={convAnchor} onClose={() => setConvMenu(false)} sessionKey={snapshot.sessionKey}
      row={current ?? null} isDefault={Boolean(snapshot.sessionKey && snapshot.sessionKey === snapshot.mainKey)} list={list} name={name || "Conversation"} history={snapshot.history}
      work={work} onOpen={openConversation} mainKey={snapshot.mainKey} onPlace={place => navigate({ kind: "place", place })} onSettings={page => navigate({ kind: "settings", page })} room={room.menu}
      changesNeed={CHANGES_NEED} onChanges={() => { setStage(null); setPip(null); setChanges(true); setConvMenu(false); }} /> : null}
  </>;
}
