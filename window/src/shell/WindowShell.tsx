import { recordPlace } from "../diagnostics/ui-log";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import type { Conversation } from "../connect/conversations";
import type { Topic } from "@branch/gateway-protocol";
import type { TopicUpdate } from "../thread/TopicCard";
import type { SendExtras } from "../connect/engine";
import { firstSendEcho } from "../composer/sending";
import { roomIdOf, type SaplingSession } from "../connect/session";
import { withOwner } from "../connect/agent-owner";
import { isPreparationPending, isPreparationStalled, PreparationRetry, preparationTimeoutLabel } from "../connect/preparation-status";
import { Composer, VOICE_OFF } from "../composer/Composer";
import { hasUnsavedDraftFiles } from "../composer/drafts";
import { componentDesktop } from "../connect/desktop-component-updates";
import { useBranchVersion } from "../connect/branch-version";
import { LOCAL_ADDRESS, readTargetName, saveTargetName } from "../setup/pre-connect-state";
import { Thread } from "../thread/Thread";
import { PlaceView } from "../places-nav/PlaceView";
import { handleOfficeNavigation } from "../places/office/navigation";
import { SettingsFrame } from "../places-nav/SettingsFrame";
import { lookStore } from "../places/settings/set1/appearance-store";
import { loadRoute, parseRoute, saveRoute, windowTitle, PLACES, type PlaceId, type Route } from "../places-nav/routes";
import { pageName } from "../places-nav/settings-nav";
import { effectiveDark, readThemeChoice, setThemeChoice, toggleTheme, type ThemeChoice } from "../theme/theme";
import { BannerView, raiseBanner } from "./Banner";
import { bannerFor } from "./banner-news";
import { useProblemBanners } from "./problem-banners";
import { askBeforeDelete, ConfirmCatalogDelete, ConfirmDelete } from "./ConfirmDelete";
import { conversationActions } from "./conversation-actions";
import { SessionUnreadPatchGuard } from "../connect/unread-guard";
import { useContacts, useConversations, useListPeople, useMachine, usePendingApprovals, useTrunks } from "./engine-data";
import { FilterButton, FilterSortPopover, readPrefs, savePrefs } from "./FilterSort";
import { Icon } from "./icons";
import { keyLabel } from "./key-label";
import { clearFilters, emptyLineFor, filterRows, filterSummary, hasFolders, homeRow, owners, roomUsed, type ListPrefs } from "./list-model";
import { buildContactSections, contactRow, contactRowsFor, listContactTopics, markContactRead, missingConversation, openContactRow, pinContact, projectContact, type Contact } from "./contacts-model";
import { GroupDropPopover, groupHint, groupPlan, mergeRoomNotices, moveContactToProject, roomContact, useGroupRooms, useRoomNotices, type GroupDrop } from "./group-drop";
import { AppSections, ReadOnlyThread, useCatalogs, type CatalogThread } from "./AppSections";
import { batchMenuItems } from "./batch-menu";
import { colourHue, iconColourItem } from "./row-look";
import { RowCard } from "./RowCard";
import { MIN_PANE, NO_ROOM, PaneDivider, SplitPanes, TOO_NARROW, type Pane } from "./SplitPanes";
import { useRowCard, useRowExtras, useSelection } from "./sidebar-state";
import { machineMenuItems, MachineSwitcher } from "./MachineMenu";
import { BranchLinkDialog } from "./BranchLinkDialog";
import { Menu, type MenuAnchor, type MenuItem } from "./Menu";
import { createTopic, newMenuItems } from "./new-menu";
import type { TopicListItem } from "./contact-topics";
import { TopicRail } from "./TopicRail";
import { historyToBlocks } from "../thread/history";
import { lastSpeakerWho, topicSpeakerKeys } from "./topic-who";
import { topicLayoutFor, readTopicSettings, setContactTopicLayout, type TopicLayout } from "./topic-layout";
import { patchTopicSession } from "./topic-session";
import { loadAllTopicTranscripts } from "./topic-all";
import { useContactSegments } from "./useContactSegments";
import { contactAlert, contactAlertTarget, noticesHereOn, notify, readMutedContacts, saveMutedContacts } from "./notify";
import { headerFace, stopRoaming } from "./pet-roam";
import { SaveProgressOffer, useCkptOn } from "./SaveProgress";
import { SidebarPet } from "./SidebarPet";
import { GetAppsDialog } from "./GetApps";
import { CanDoDialog } from "./CanDo";
import { Face } from "../face/Face";
import { TalkSetup, type TalkHandle } from "../setup/TalkSetup";
import { NewTrunkCard, type NewTrunk } from "./NewTrunkFlow";
import { createReadyTrunk } from "../places/trunk/api";
import { RemoveTrunkDialog, TRUNK_REMOVED_EVENT } from "../places/trunk/RemoveTrunk";
import { NewTrunkPreview, type TrunkChoice } from "../places/trunk/NewTrunkPreview";
import type { Roster } from "../places/trunk/model";
import { creationProblem, readRoster } from "../places/trunk/model";
import { COMPOSE_EVENT } from "../composer/Composer";
import { PairDialog } from "../places/customize/pairing";
import { guideLinkItems } from "./guide-links";
import { Palette } from "./Palette";
import { paletteRows } from "./palette-rows";
import { PersonMenu, usePersonName } from "./PersonMenu";
import { SideResizer } from "./Resizer";
import { rowMenuItems, threadMenuItems } from "./row-menu";
import { SearchBox, SearchResultsView, useSearch } from "./Search";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { QuickAsk } from "./QuickAsk";
import { NewProjectDialog, useProjects } from "./Projects";
import { Sidebar, type TalkEntry } from "./Sidebar";
import { TalkBeside, useTalkLayout } from "./TalkBeside";
import { StatusBar, type StatusItem } from "./StatusBar";
import { KeepLastDialog, remindedToday, StatusPopover, statusAnchor, tidy } from "./StatusLayer";
import { copyMarkdown, copyText } from "./row-actions";
import { readLevel } from "../places-nav/SettingsFrame";
import type { Above } from "./Popover";
import { ringReading } from "./status-data";
import { desktopControls } from "../connect/desktop-controls";
import { useGatewayFacts, useLimits, useUpdate } from "./use-status";
import { useLockdown } from "./use-lockdown";
import { LockdownBanner } from "./LockdownBanner";
import { stageWindowUpdate } from "../connect/desktop-component-updates";
import { Toasts } from "./Toasts";
import { conversationNeedsYou } from "./conversation-more";
import { ConversationMoreButton, HeaderRow, PlaceHead, TopBar } from "./TopBar";
import { toggleListLayout, useLayout } from "./use-layout";
import { usePinOrder } from "./use-pin-order";
import { hideMenuItems, hideTarget, HIDEABLE, usePetLook, useShown } from "./shown";
import { StatusGfx, StatusLeftExtras } from "./StatusExtras";
import { paneKeyFor, useShortcuts } from "./use-shortcuts";
import { currentKeys, keyActions, readCustomKeys } from "./keymap";
import { ComputerActivityCard } from "../thread/ComputerActivityCard";
import { PlanCard, usePlanDismiss, usePlanRefresh, useProgressCard } from "../thread/PlanCard";
import { ComputerStage, type PipTarget, type StageMode } from "../stage/ComputerStage";
import { StageConversation } from "../stage/StageConversation";
import { SidePane, type PaneTab } from "../stage/SidePane";
import { shouldShowThreadColumn, ThreadColumn } from "./ThreadColumn";
import { ControlTower } from "./ControlTower";
import { StagePip } from "../stage/StagePip";
import { AddComputer } from "../stage/AddComputer";
import { computersChanged } from "../stage/computers";
import { TrunkAppearances, TrunkPebbleLooks, TrunkEmojiFaces, trunkAppearance, type Appearance } from "../face/appearance";
import { CharacterPanel } from "../face/CharacterPanel";
import { useShellRoom } from "../rooms/useShellRoom";
import { NewGroupChatHost } from "../rooms/NewGroupChat";
import { agentState, DONE_MS, TALK_MS, type AgentState } from "../face/agentState";
import { conversationLink, useConversationMenu } from "./ConversationMenu";
import { changeConversationInOwnWindow, openConversationWindow, ownWindowUnavailable, retrySavedConversationWindows } from "./own-window";
import { TALK_EVENT, useVoiceCatalog } from "../composer/VoiceParts";
import { DockQuestion } from "../thread/QuestionCard";
import { CHECK_STATUS_EVENT } from "../thread/blocks";
import { WhereChips } from "../thread/WhereChips";
import { FIND_EVENT } from "../thread/FindBar";
import { useQuestions } from "../thread/questions";
import { Walkthrough } from "./Walkthrough";
import { installedRows, WhatsNew } from "./WhatsNew";
import { SetupFlow } from "../setup/SetupFlow";
import { useFirstRun } from "../setup/use-first-run";
import { useNeedsCount } from "../places/inbox";
import { TrunkStudio } from "../places/trunk";
import "./preview.css";

/** The clock for row times; it also ticks just after a "Done" so the header goes back to ready (§4.2.5). */
function useNow(doneAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setNow(Date.now());
    if (!doneAt) {
      return;
    }
    const timers = [TALK_MS, DONE_MS].map(delay => setTimeout(() => setNow(Date.now()), Math.max(0, doneAt + delay - Date.now()) + 50));
    return () => timers.forEach(clearTimeout);
  }, [doneAt]);
  return now;
}

type Overlay =
  | { kind: "menu"; id: string; at: MenuAnchor; items: MenuItem[]; label: string; upward?: boolean }
  | { kind: "filter"; at: MenuAnchor }
  | { kind: "person"; at: MenuAnchor; from: Above }
  | { kind: "palette" }
  | { kind: "shortcuts" }
  | { kind: "apps" }
  | { kind: "cando" }
  | { kind: "pair" }
  | { kind: "status"; item: StatusItem; above: Above }
  | { kind: "ask" }
  | { kind: "studio" }
  | null;

const below = (e: MouseEvent<HTMLElement>): MenuAnchor => {
  if (e.type === "contextmenu") {
    return { x: e.clientX, y: e.clientY };
  }
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 4 };
};
const above = (e: MouseEvent<HTMLElement>): MenuAnchor => {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left, y: r.top - 8 - 320 };
};


/** Banners for news about a conversation that is not on screen (§4.10.1): a Trunk needs a yes, or finished. */
function useBannerNews(session: SaplingSession, shownKey: string | null, rowName: (k: string) => string, trunkOf: (k: string) => string) {
  const latest = { shownKey, rowName, trunkOf };
  const ref = useRef(latest);
  ref.current = latest;
  useEffect(
    () =>
      session.onGatewayEvent((event, payload) => {
        const { shownKey: open, rowName: title, trunkOf: trunk } = ref.current;
        const news = bannerFor(event, payload, open, { title, trunk });
        if (news) {
          raiseBanner(news);
        }
      }),
    [session, ref],
  );
}

/** Opening a conversation clears its unread flag (§4.1.1 Interactions), once per unread episode, the way OpenClaw's
 *  chat pane does (ui/src/pages/chat/chat-pane-session.ts markSessionRead, with its SessionUnreadPatchGuard). */
function useMarkRead(request: <T>(m: string, p?: unknown) => Promise<T>, row: Conversation | null, shown: boolean, refresh: () => void) {
  const guard = useMemo(() => new SessionUnreadPatchGuard(), []);
  const key = shown && row ? row.key : "";
  const unread = row?.unread === true;
  const marker = row?.markedUnreadAt;
  useEffect(() => {
    if (!key || !row) {
      return;
    }
    if (!guard.shouldPatch(key, unread, marker)) {
      return;
    }
    const agentId = row.agentId;
    request("sessions.patch", { key, unread: false, ...(agentId ? { agentId } : {}), expectedMarkedUnreadAt: marker ?? null }).then(
      () => refresh(),
      (error: unknown) => guard.patchFailed(key, error),
    );
  }, [guard, key, unread, marker, row, request, refresh]);
}

/** Whether the window is 760 px or narrower (§3.4). */
function useNarrow(): boolean {
  const query = "(max-width: 760px)";
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** Follows the computer's light/dark setting and theme changes made elsewhere in the window (Settings > Appearance). */
function useThemeSync(setTheme: (t: ThemeChoice) => void): boolean {
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const changed = (event: Event) => {
      const choice = (event as CustomEvent).detail;
      setTheme(choice === "dark" || choice === "light" || choice === "system" ? choice : readThemeChoice());
    };
    const media = matchMedia("(prefers-color-scheme: dark)");
    const systemChanged = () => setSystemDark(media.matches);
    window.addEventListener("branch:theme-change", changed);
    window.addEventListener("storage", changed);
    media.addEventListener("change", systemChanged);
    return () => {
      window.removeEventListener("branch:theme-change", changed);
      window.removeEventListener("storage", changed);
      media.removeEventListener("change", systemChanged);
    };
  }, [setTheme]);
  return systemDark;
}

/** Whether the character panel is shown; remembered across windows. */
function useCharacterShown() {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem("branch.characterShown") !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("branch.characterShown", shown ? "1" : "0");
    } catch {
      // storage blocked: the choice lasts for this window only
    }
  }, [shown]);
  useEffect(() => {
    // Settings › Appearance changes the switch too ("branch:look-change"): follow it without a reload.
    const reread = () => {
      try {
        setShown(localStorage.getItem("branch.characterShown") !== "0");
      } catch {
        // storage blocked: keep what this window shows
      }
    };
    window.addEventListener("branch:look-change", reread);
    return () => window.removeEventListener("branch:look-change", reread);
  }, []);
  return [shown, setShown] as const;
}

/** The header and character panel receive the same Trunk state. */
function LiveCharacter(props: { name: string; state: AgentState; onClose: () => void; onShow: () => void; onOpenTrunk: () => void; onChangePet: () => void; others?: string[]; column: HTMLElement | null }) {
  return <CharacterPanel {...props} />;
}

/** Engine reads the shell needs, in one place. */
function useEngineReads(session: SaplingSession) {
  const s = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const ready = s.status.phase === "connected";
  const [lists, list] = useConversations(session, ready, s.mainKey);
  const [gatewayContacts, refreshContacts, contactsLoaded] = useContacts(session, ready);
  const trunks = useTrunks(session, ready);
  return {
    s,
    ready,
    lists,
    list,
    gatewayContacts,
    refreshContacts,
    contactsLoaded,
    trunks,
    pending: usePendingApprovals(session, ready),
    machine: useMachine(session, ready),
    limits: useLimits(session, ready),
    gateway: useGatewayFacts(session, ready),
    person: usePersonName(session, ready),
  };
}

/** The whole window once connected (DESIGN-SPEC §3): top bar, sidebar, main, status bar, menus and toasts. */
export function WindowShell({ session, url }: { session: SaplingSession; url: string }) {
  const dedicated = new URLSearchParams(location.search).has("conversation");
  const [poppedKeys, setPoppedKeys] = useState<string[]>([]);
  useEffect(() => {
    const bridge = (window as unknown as { branchDesktop?: { conversationWindows?: { list: () => Promise<string[]>; onChanged: (listener: (keys: string[]) => void) => () => void } } }).branchDesktop?.conversationWindows;
    if (!bridge || dedicated) return;
    let live = true;
    void bridge.list().then((keys) => { if (live) setPoppedKeys(keys); }, () => undefined);
    const stop = bridge.onChanged((keys) => { if (live) setPoppedKeys(keys); });
    return () => { live = false; stop(); };
  }, [dedicated]);
  useEffect(() => componentDesktop(session.gatewayUrl)?.onAutoApplyProbe?.(async () => {
    const approvals = await Promise.all(["exec.approval.list", "plugin.approval.list", "branch.approval.list"].map(
      method => session.request<unknown>(method, {}),
    ));
    const pendingApprovals = approvals.reduce<number>((count, result) => {
      const items = Array.isArray(result) ? result : (result as { items?: unknown })?.items;
      if (!Array.isArray(items)) throw new Error("Approval status is unavailable");
      return count + items.length;
    }, 0);
    return { pendingApprovals, streaming: Boolean(session.getSnapshot().liveRunId), unsavedDraftFiles: hasUnsavedDraftFiles() };
  }), [session]);
  const { s, ready, lists, list, gatewayContacts, refreshContacts, contactsLoaded, trunks, pending, machine, limits, gateway, person } = useEngineReads(session);
  const lockdown = useLockdown(session.engine, ready, session);
  const toggleLockdown = () => void lockdown.toggle().catch((error: unknown) => notify(`Couldn't change Lockdown: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" }));
  const groupRooms = useGroupRooms(session, ready);
  const [groupDrop, setGroupDrop] = useState<GroupDrop | null>(null);
  const branchVersion = useBranchVersion(url);
  useEffect(() => {
    if (ready && machine?.name) saveTargetName(url, machine.name);
  }, [ready, machine?.name, url]);
  const people = useListPeople(session, ready);
  const update = useUpdate(session, ready, branchVersion);
  const projects = useProjects(session, ready);
  const [newProject, setNewProject] = useState(false);
  const [route, setRoute] = useState<Route>(loadRoute);
  useEffect(() => { recordPlace(route.kind === "place" ? route.place : route.kind); }, [route]);
  const firstRun = useFirstRun(session, ready, () => document.querySelector(".scrim, .pop, [data-testid=setup]") !== null, trunks.loaded ? trunks.list.length : null, route.kind === "settings");
  const contactRows = contactRowsFor(gatewayContacts, contactsLoaded, trunks.list, lists.rows, s.mainKey, firstRun.isFirstRun,
    firstRun.isFirstRun && firstRun.requiresContact ? trunks.bootstrapDefault : undefined);
  const now = useNow(s.doneAt);
  const [layout, setLayout] = useLayout();
  const pinOrder = usePinOrder(session, ready);
  const [liveW, setLiveW] = useState<number | null>(null);
  const isNarrow = useNarrow();
  const [slideOpen, setSlideOpen] = useState(false);
  const [phoneTopicListFor, setPhoneTopicListFor] = useState<string | null>(null);
  const [searchFind, setSearchFind] = useState<{ key: string; query: string; nonce: number } | null>(null);
  const searchFindNonce = useRef(0);
  const routeRef = useRef(route);
  routeRef.current = route;
  const historyIndexRef = useRef(Number(history.state?.branchIndex) || 0);
  const [draftTopic, setDraftTopic] = useState<{ agentId: string; nonce: string; options: Record<string, unknown> } | null>(null);
  const [draftEcho, setDraftEcho] = useState<string | null>(null);
  const [topicReturnKey, setTopicReturnKey] = useState<string | null>(null);
  const draftTopicRef = useRef(draftTopic);
  draftTopicRef.current = draftTopic;
  const creatingTopic = useRef<string | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);
  const [prefs, setPrefs] = useState<ListPrefs>(readPrefs);
  const [mutedContacts, setMutedContacts] = useState(readMutedContacts);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const [deletingMany, setDeletingMany] = useState<Conversation[] | null>(null);
  const [removingTrunk, setRemovingTrunk] = useState<{ agentId: string; name: string } | null>(null);
  const [panes, setPanes] = useState<Pane[]>([]);
  const [splitW, setSplitW] = useState(50);
  const [reading, setReading] = useState<{ thread: CatalogThread; label: string; remove?: boolean } | null>(null);
  const [keeping, setKeeping] = useState<Conversation | null>(null);
  const [replyTo, setReplyTo] = useState<{ entryId: string; name: string; text: string } | null>(null);
  const [stage, setStage] = useState<StageMode | null>(null);
  const [pane, setPane] = useState<PaneTab | null>(null);
  const [towerOn, setTowerOn] = useState(() => {
    try { return localStorage.getItem("branch.controlTower") !== "hidden"; }
    catch { return true; }
  });
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "t") return;
      event.preventDefault();
      setTowerOn((on) => {
        try { localStorage.setItem("branch.controlTower", on ? "hidden" : "shown"); } catch { /* current window only */ }
        return !on;
      });
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, []);
  const [focusHelpers, setFocusHelpers] = useState(0);
  const [pip, setPip] = useState<PipTarget | null>(null);
  const [stageComputer, setStageComputer] = useState<string | null>(null);
  const [addingComputer, setAddingComputer] = useState(false);
  const [linkingBranch, setLinkingBranch] = useState(false);
  const [stageTakeOver, setStageTakeOver] = useState(false);
  const [guide, setGuide] = useState<"news" | "news-ready" | "tour" | null>(null);
  useEffect(() => {
    const openNews = () => setGuide("news");
    window.addEventListener("branch:whats-new", openNews);
    return () => window.removeEventListener("branch:whats-new", openNews);
  }, []);
  const [characterShown, setCharacterShown] = useCharacterShown();
  // The card and Appearance › Agents › "Show the agent beside the conversation" are one switch: keep both in step.
  const setCharacterVisible = (on: boolean) => { setCharacterShown(on); void lookStore(session.engine).set("agentShown", on).catch(() => undefined); };
  const [conversationColumn, setConversationColumn] = useState<HTMLDivElement | null>(null);
  const [talk, setTalk] = useTalkLayout(); // the default Trunk beside a place or Settings page (§3.3)
  const shown = useShown(session.engine); // Appearance › What's shown
  useEffect(() => {
    // The whole status bar, off: its row folds away everywhere --status-h is read, dialogs drawn over the body included.
    document.documentElement.classList.toggle("no-status", !shown.statusBar);
    return () => document.documentElement.classList.remove("no-status");
  }, [shown.statusBar]);
  // The person's look (theme, accent, fonts, text size) follows them: read it from the engine once connected.
  useEffect(() => {
    if (ready) void lookStore(session.engine).load();
  }, [ready, session.engine]);
  const progress = useProgressCard(session.engine);
  const planRefresh = usePlanRefresh(session.engine, progress.card);
  const planDismiss = usePlanDismiss(progress.card);
  const systemDark = useThemeSync(setTheme);
  useEffect(() => {
    setStage(null);
    setPip(null);
  }, [s.sessionKey, ready]);
  useEffect(() => setReplyTo(null), [s.sessionKey]); // a reply belongs to the conversation it was started in
  useEffect(() => setPanes((cur) => (cur.some((x) => x.key === s.sessionKey) ? cur.filter((x) => x.key !== s.sessionKey) : cur)), [s.sessionKey]);

  const request = useCallback(<T,>(m: string, p?: unknown) => session.request<T>(m, p), [session]);
  useEffect(() => {
    if (!ready || dedicated) return;
    return retrySavedConversationWindows(request);
  }, [ready, dedicated, request]);
  const onGatewayEvent = useCallback((listener: (event: string, payload: unknown) => void) => session.onGatewayEvent(listener), [session]);
  const trunkName = useCallback((id: string | undefined) => trunks.list.find((t) => t.id === id)?.name || s.name || "Sapling", [trunks, s.name]);
  const defaultName = trunkName(trunks.defaultId ?? undefined);
  const appearances = useMemo(
    () => Object.fromEntries(trunks.list.map((t) => [t.name, trunkAppearance(t.avatar, t.name, t.colour)]).filter((entry): entry is [string, Appearance] => Boolean(entry[1]))),
    [trunks],
  );
  const openKey = s.sessionKey;
  const activeContact = contactRows.find((contact) => contact.threadKey === openKey);
  const draftContact = draftTopic ? contactRows.find((contact) => contact.id === `trunk:${draftTopic.agentId}`) : null;
  const openParentKey = lists.rows.find((row) => row.key === openKey)?.parentKey;
  const topicContact = draftContact ?? activeContact ?? contactRows.find((contact) => contact.threadKey === openParentKey) ?? contactRows.find((contact) => contact.threadKey === topicReturnKey);
  const [activeTopics, setActiveTopics] = useState<Topic[]>([]);
  const [topicWho, setTopicWho] = useState<Record<string, string>>({});
  const [allTopics, setAllTopics] = useState<{ contactId: string; history: import("../thread/model").Block[]; loading: boolean; error: string } | null>(null);
  const [topicLayout, setTopicLayout] = useState(() => readTopicSettings().layout);
  useEffect(() => {
    const sync = () => setTopicLayout(topicContact ? topicLayoutFor(topicContact.id) : readTopicSettings().layout);
    sync();
    window.addEventListener("branch:topic-layout-changed", sync);
    const storage = (event: StorageEvent) => { if (event.key === "branch-topics-t5") sync(); };
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener("branch:topic-layout-changed", sync); window.removeEventListener("storage", storage); };
  }, [topicContact?.id]);
  const [fullListFor, setFullListFor] = useState<string | null>(null);
  const topicAutoRail = route.kind === "chat" && Boolean(topicContact && activeTopics.length) && innerWidth > 760 && (topicLayout === "column" || topicLayout === "rail") && fullListFor !== topicContact?.id;
  const rail = layout.rail || (topicAutoRail && !layout.hidden);
  useEffect(() => {
    setAllTopics((value) => value && (!topicContact || value.contactId !== topicContact.id || openKey !== topicContact.threadKey) ? null : value);
  }, [openKey, topicContact?.id]);
  const segments = useContactSegments(request, ready && activeContact ? activeContact.threadKey : null);
  const [focusTopic, setFocusTopic] = useState<{ key: string; nonce: number } | null>(null);
  useEffect(() => {
    if (!ready || !topicContact) { setActiveTopics([]); return; }
    setActiveTopics([]);
    let live = true;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      try {
        const found = await listContactTopics(topicContact.id, (method, params) => session.request(method, params));
        if (live && current === generation) setActiveTopics(found);
      } catch (error) { if (live) console.warn("contacts.topics failed", error); }
    };
    void load();
    const off = session.onGatewayEvent((event) => { if (event === "contacts.changed") void load(); });
    return () => { live = false; off(); };
  }, [session, ready, topicContact?.id]);
  useEffect(() => {
    if (!ready || !topicContact || !activeTopics.length) { setTopicWho({}); return; }
    let live = true;
    const contactName = topicContact.name;
    void Promise.all(topicSpeakerKeys(topicContact.threadKey, activeTopics).map(async (key) => {
      try {
        const result = await request<{ messages?: unknown[] }>("chat.history", { sessionKey: key, limit: 1 });
        const blocks = historyToBlocks(Array.isArray(result.messages) ? result.messages : [], [], key, null);
        return [key, lastSpeakerWho(blocks, contactName)] as const;
      } catch { return [key, ""] as const; }
    })).then((entries) => { if (live) setTopicWho(Object.fromEntries(entries)); });
    return () => { live = false; };
  }, [request, ready, topicContact?.id, activeTopics]);
  const mainKeySuffix = s.mainKey?.split(":").slice(2).join(":") || "main";
  const activeEngine = session.engine;
  const draftEngine = useMemo(() => draftTopic ? {
    ...activeEngine,
    request: <T,>(method: string, params?: unknown) => session.request<T>(method, withOwner(method, params, draftTopic.agentId)),
    sessionKey: `agent:${draftTopic.agentId}:${mainKeySuffix}`,
    agentId: draftTopic.agentId,
  } : undefined, [session, activeEngine, draftTopic?.agentId, mainKeySuffix]);
  const actions = useMemo(() => conversationActions(request, list, () => session.getSnapshot().sessionKey), [request, list, session]);
  const search = useSearch(request, lists.rows, trunkName);

  const go = useCallback((next: Route) => {
    if (dedicated && next.kind !== "chat") {
      const bridge = (window as unknown as { branchDesktop?: { openInMain?: (route: Route) => Promise<void> } }).branchDesktop;
      if (bridge?.openInMain) {
        void bridge.openInMain(next).catch((error: unknown) => notify(`Couldn't open main window: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" }));
        return;
      }
    }
    const navigate = () => {
      if (JSON.stringify(routeRef.current) !== JSON.stringify(next)) {
        const index = Number(history.state?.branchIndex) || 0;
        history.pushState({ branchRoute: next, branchIndex: index + 1 }, "");
        historyIndexRef.current = index + 1;
      }
      draftTopicRef.current = null;
      setDraftTopic(null);
      setDraftEcho(null);
      setStage(null);
      setRoute(next);
      setSlideOpen(false); // opening anything closes the slide-over (§4.1.8)
      saveRoute(next.kind === "chat" ? { kind: "chat", key: next.key ?? session.getSnapshot().sessionKey } : next);
      if (next.kind === "chat" && next.key) void session.open(next.key);
    };
    if (dedicated && next.kind === "chat" && next.key && (routeRef.current.kind !== "chat" || next.key !== routeRef.current.key)) {
      void changeConversationInOwnWindow(next.key, navigate).catch((error: unknown) => notify(`Couldn't change this window: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" }));
      return;
    }
    navigate();
  }, [session, dedicated]);
  useEffect(() => {
    const bridge = (window as unknown as { branchDesktop?: { onOpenMainRoute?: (listener: (route: unknown) => void) => () => void } }).branchDesktop;
    return bridge?.onOpenMainRoute?.((raw) => {
      const route = parseRoute(JSON.stringify(raw) ?? null);
      if (route) go(route);
    });
  }, [go]);
  useEffect(() => {
    if (!dedicated) return;
    const close = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        const bridge = (window as unknown as { branchDesktop?: { closeConversationWindow?: () => Promise<void> } }).branchDesktop;
        if (bridge?.closeConversationWindow) void bridge.closeConversationWindow();
        else window.close();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [dedicated]);
  useEffect(() => {
    history.replaceState({ branchRoute: routeRef.current, branchIndex: Number(history.state?.branchIndex) || 0 }, "");
    historyIndexRef.current = Number(history.state?.branchIndex) || 0;
    let reversing = false;
    const pop = (event: PopStateEvent) => {
      if (reversing) { reversing = false; return; }
      const next = parseRoute(JSON.stringify(event.state?.branchRoute));
      if (!next) return;
      const nextIndex = Number(event.state?.branchIndex) || 0;
      const navigate = () => {
        historyIndexRef.current = nextIndex;
        setDraftTopic(null);
        setStage(null);
        setRoute(next);
        setSlideOpen(false);
        saveRoute(next);
        if (next.kind === "chat" && next.key) void session.open(next.key);
      };
      if (dedicated && next.kind === "chat" && next.key && (routeRef.current.kind !== "chat" || next.key !== routeRef.current.key)) {
        void changeConversationInOwnWindow(next.key, navigate).catch((error: unknown) => {
          const distance = historyIndexRef.current - nextIndex;
          if (distance) { reversing = true; history.go(distance); }
          else history.replaceState({ branchRoute: routeRef.current, branchIndex: historyIndexRef.current }, "");
          notify(`Couldn't change this window: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" });
        });
      } else navigate();
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [session, dedicated]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      handleOfficeNavigation(event, routeRef.current.kind === "place" && routeRef.current.place === "office", () => go({ kind: "place", place: "overview" }));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go]);
  const openConversation = useCallback((key: string) => {
    if ((dedicated && key !== new URLSearchParams(location.search).get("conversation")) || (!dedicated && poppedKeys.includes(key))) {
      void openConversationWindow(key).catch((error: unknown) => notify(`Couldn't open window: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" }));
      return;
    }
    go({ kind: "chat", key });
  }, [go, dedicated, poppedKeys]);
  useEffect(() => {
    const current = routeRef.current;
    if (!dedicated && current.kind === "chat" && poppedKeys.includes(current.key ?? openKey ?? "")) {
      go({ kind: "place", place: "overview" });
    }
  }, [dedicated, go, poppedKeys, openKey]);
  const openSearchMessage = useCallback((key: string, query: string) => {
    setSearchFind({ key, query, nonce: ++searchFindNonce.current });
    openConversation(key);
  }, [openConversation]);
  useEffect(() => {
    const removed = () => {
      const id = trunks.defaultId;
      if (id) openConversation(contactRows.find((contact) => contact.id === `trunk:${id}`)?.threadKey ?? `agent:${id}:${mainKeySuffix}`);
    };
    window.addEventListener(TRUNK_REMOVED_EVENT, removed);
    return () => window.removeEventListener(TRUNK_REMOVED_EVENT, removed);
  }, [trunks.defaultId, contactRows, mainKeySuffix, openConversation]);
  const openTopic = (key: string) => {
    if (topicContact) setTopicReturnKey(topicContact.threadKey);
    openConversation(key);
  };
  const previousContactActivity = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    if (!ready) { previousContactActivity.current = null; return; }
    const previous = previousContactActivity.current;
    previousContactActivity.current = new Map(contactRows.map((contact) => [contact.id, contact.lastActivityAt]));
    if (!previous || !document.hidden || typeof Notification === "undefined" || Notification.permission !== "granted" || !noticesHereOn()) return;
    for (const contact of contactRows) {
      if (!previous.has(contact.id) || contact.lastActivityAt <= previous.get(contact.id)! || (!contact.threadUnread && contact.unreadTopics === 0)) continue;
      const alert = contactAlert(contact, mutedContacts.has(contact.id));
      if (!alert) continue;
      const notification = new Notification(alert.title, { body: alert.body, icon: "/favicon.ico" });
      notification.onclick = () => {
        window.focus();
        setFocusTopic(null);
        openConversation(contactAlertTarget(contact));
        notification.close();
      };
    }
  }, [ready, contactRows, mutedContacts, openConversation]);
  const toggleMute = (contact: Contact) => setMutedContacts((current) => {
    const next = new Set(current);
    if (next.has(contact.id)) next.delete(contact.id); else next.add(contact.id);
    saveMutedContacts(next);
    return next;
  });
  const openPlace = useCallback((place: PlaceId) => go({ kind: "place", place }), [go]);
  const openSettings = useCallback((page: string) => go({ kind: "settings", page }), [go]);
  /** The Trunk's profile, drawn by People's TrunkHost on `branch:open-trunk` (claude/win-places). */
  const openTrunkProfile = useCallback((agentId: string | undefined) => {
    openPlace("people");
    window.dispatchEvent(new CustomEvent("branch:open-trunk", { detail: { agentId, view: "profile" } }));
  }, [openPlace]);
  useEffect(() => {
    const navigate = (event: Event) => {
      const page = (event as CustomEvent<{ page?: string }>).detail?.page;
      if (typeof page === "string" && /^[a-z][a-z0-9-]*$/.test(page)) {
        openSettings(page);
      }
    };
    window.addEventListener("branch:navigate-settings", navigate);
    return () => window.removeEventListener("branch:navigate-settings", navigate);
  }, [openSettings]);
  useEffect(() => {
    // "Couldn't finish" › Check status: the Gateway popover (§4.9.3) at the clicked button, as the preview opens it
    // (openPop(el, POPS.gateway())); else over its status bar item.
    const check = (event: Event) => {
      const at = (event as CustomEvent<{ left?: number; right?: number; top?: number }>).detail;
      const r = at && typeof at.left === "number" && typeof at.right === "number" && typeof at.top === "number"
        ? { left: at.left, right: at.right, top: at.top, width: at.right - at.left }
        : document.querySelector("[data-testid=sb-gateway]")?.getBoundingClientRect();
      const above = r && r.width ? { left: r.left, right: r.right, top: r.top, align: "left" as const } : { left: 8, right: 8, top: innerHeight - 40, align: "left" as const };
      setOverlay({ kind: "status", item: "gateway", above });
    };
    window.addEventListener(CHECK_STATUS_EVENT, check);
    return () => window.removeEventListener(CHECK_STATUS_EVENT, check);
  }, []);
  // The Branch app's tray: its usage ring shows the same reading as the ring bottom right, and a click opens Usage.
  const trayLeft = ringReading(limits)?.left ?? null;
  useEffect(() => {
    const found = desktopControls();
    if ("bridge" in found) found.bridge.setTrayUsage(trayLeft);
  }, [trayLeft]);
  useEffect(() => {
    const found = desktopControls();
    return "bridge" in found ? found.bridge.onOpenUsage(() => openSettings("usage")) : undefined;
  }, [openSettings]);
  useEffect(() => {
    // "Watch its screen" from anywhere (Settings › Computer & browser): the open conversation's stage on that computer.
    const watch = (event: Event) => {
      const id = (event as CustomEvent<{ computerId?: string }>).detail?.computerId;
      if (typeof id !== "string" || !id) return;
      go({ kind: "chat", key: null });
      setStageComputer(id);
      setStage("Computer");
    };
    window.addEventListener("branch:watch-computer", watch);
    // "Add a computer" from anywhere opens the stage's dialog; it says branch:computers-changed when one is added.
    const add = () => setAddingComputer(true);
    window.addEventListener("branch:add-computer", add);
    return () => {
      window.removeEventListener("branch:watch-computer", watch);
      window.removeEventListener("branch:add-computer", add);
    };
  }, [go]);
  useEffect(() => {
    // Settings rows and other areas open a place: detail { place, tab? }; the tab is handed to the place as a
    // "branch:place-tab" event once it shows (places that have tabs listen for it).
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<{ place?: string; tab?: string }>).detail;
      const place = PLACES.find((p) => p.id === detail?.place)?.id;
      if (place) {
        openPlace(place);
        if (typeof detail?.tab === "string") {
          const tab = detail.tab;
          setTimeout(() => window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place, tab } })), 0);
        }
      }
    };
    window.addEventListener("branch:navigate-place", navigate);
    return () => window.removeEventListener("branch:navigate-place", navigate);
  }, [openPlace]);
  useEffect(() => {
    // Ctrl+` shows or hides the side panel's Terminal tab, Ctrl+Shift+B its Files tab (the preview's pane keys).
    // Ctrl+Shift+K is use-shortcuts' sidePanel; a key the person set for another action wins over these.
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const key = (event: KeyboardEvent) => {
      const tab = paneKeyFor(event, mac, currentKeys(keyActions(""), readCustomKeys()));
      if (tab === "Browser" || tab === "Computer") {
        event.preventDefault();
        setStage((value) => (value === tab ? null : tab));
      } else if (tab) {
        event.preventDefault();
        setPane((value) => (value === tab ? null : tab));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // Settings › "Learn more": a new conversation with the default Trunk, started with the question (§4.7.0).
  const askDefault = useCallback(async (text: string) => {
    const key = await actions.create(trunks.defaultId ?? undefined);
    if (!key) {
      return;
    }
    openConversation(key);
    await session.open(key);
    await session.send(text);
  }, [actions, trunks.defaultId, openConversation, session]);
  useEffect(() => {
    // Right-click a part What's shown can hide (data-hide): Hide this, or Choose what's shown… (the preview's menu).
    const onMenu = (e: globalThis.MouseEvent) => {
      const part = hideTarget(e.target);
      if (!part) return;
      e.preventDefault();
      const hide = () => {
        lookStore(session.engine).set(HIDEABLE[part], false).catch((error: unknown) => notify(`Couldn't save that: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" }));
        notify("Hidden. Bring it back in Settings › Appearance."); // fakes-ok: F4 the preview's own toast after Hide this (app-latest ACTS.hide); not yet in DESIGN-SPEC
      };
      setOverlay({ kind: "menu", id: `hide:${part}`, at: { x: e.clientX, y: e.clientY }, items: hideMenuItems(hide, () => openSettings("appearance")), label: "Hide" });
    };
    document.addEventListener("contextmenu", onMenu);
    return () => document.removeEventListener("contextmenu", onMenu);
  }, [session, openSettings]);
  const startNew = useCallback((agentId?: string, options: Record<string, unknown> = {}) => {
    const id = agentId ?? trunks.defaultId;
    if (!id) { notify("Create a Trunk before starting a conversation.", { tone: "bad" }); return; }
    const next = { agentId: id, nonce: crypto.randomUUID(), options };
    draftTopicRef.current = next;
    setDraftEcho(null);
    setDraftTopic(next);
    setRoute({ kind: "chat", key: null });
    setSlideOpen(false);
  }, [trunks.defaultId]);
  const startFromMessage = (afterMessageId: string) => {
    if (!activeContact || activeContact.kind !== "trunk") return;
    setTopicReturnKey(activeContact.threadKey);
    startNew(activeContact.id.slice(6), { contactAnchor: { threadKey: activeContact.threadKey, afterMessageId } });
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".conversation-column textarea")?.focus());
  };

  const sendNew = async (text: string, extras?: SendExtras): Promise<boolean> => {
    if (!draftTopic || creatingTopic.current === draftTopic.nonce) return false;
    const echo = firstSendEcho(text);
    if (!echo) return false;
    creatingTopic.current = draftTopic.nonce;
    setDraftEcho(echo);
    try {
      const threadKey = contactRows.find((contact) => contact.id === `trunk:${draftTopic.agentId}`)?.threadKey;
      const mainKey = threadKey?.slice(`agent:${draftTopic.agentId}:`.length) || mainKeySuffix;
      const backoff = new PreparationRetry();
      let key: string;
      while (true) {
        if (draftTopicRef.current?.nonce !== draftTopic.nonce) return false;
        try {
          key = await createTopic(request, draftTopic.agentId, mainKey, text, { ...draftTopic.options, ...extras });
          break;
        } catch (error) {
          if (!isPreparationPending(error)) throw error;
          const delay = backoff.nextDelay();
          if (delay === null) throw new Error(preparationTimeoutLabel(trunkName(draftTopic.agentId)));
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      await list.refresh();
      if (draftTopicRef.current?.nonce === draftTopic.nonce && draftTopicRef.current.agentId === draftTopic.agentId) {
        session.seedFirstSend(key, echo);
        openConversation(key);
      }
      return true;
    } catch (error) {
      setDraftEcho(null);
      notify(`Couldn't start the conversation: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" });
      return false;
    } finally {
      if (creatingTopic.current === draftTopic.nonce) creatingTopic.current = null;
    }
  };

  // + new › New Trunk (the artifact's newTrunkC18): make the Trunk, open a conversation with it, ask its two questions.
  const [newTrunkFlow, setNewTrunkFlow] = useState<NewTrunk | null>(null);
  const [newTrunkRoster, setNewTrunkRoster] = useState<Roster | null>(null);
  const [makingTrunk, setMakingTrunk] = useState(false);
  const newTrunk = useCallback(async () => {
    try {
      setNewTrunkRoster(readRoster(await session.request("agents.list", {})));
    } catch (e) {
      notify(`Couldn't prepare the Trunk: ${e instanceof Error ? e.message : String(e)}`, { tone: "bad" });
    }
  }, [session]);
  const confirmNewTrunk = async (choice: TrunkChoice) => {
    setMakingTrunk(true);
    try {
      const agentId = await createReadyTrunk(session.engine, choice.name, () => true, choice.avatar);
      const key = await actions.create(agentId);
      if (!key) return;
      setNewTrunkFlow({ agentId, sessionKey: key, name: choice.name });
      setNewTrunkRoster(null);
      openConversation(key);
    } catch (e) {
      notify(creationProblem(e), { tone: "bad" });
    } finally {
      setMakingTrunk(false);
    }
  };

  const contacts = projectContact([...contactRows.map((contact) => contact.kind === "outside" && groupRooms.peerOnline.has(contact.id.slice(4)) ? { ...contact, offline: groupRooms.peerOnline.get(contact.id.slice(4)) === false } : contact), ...groupRooms.rooms.map((room) => roomContact(room, contactRows)).filter((c): c is NonNullable<typeof c> => Boolean(c))], lists.rows);
  const roomNotices = useRoomNotices(session, openKey, contacts);
  // A saved conversation that is neither a session nor a contact thread reopens the default Trunk.
  useEffect(() => {
    if (!draftTopic && !roomIdOf(openKey ?? "") && lists.loaded && s.mainKey && missingConversation(openKey, s.mainKey, contactsLoaded, contacts, lists.rows)) {
      openConversation(s.mainKey);
    }
  }, [draftTopic, lists, contactsLoaded, contactRows, openKey, s.mainKey, openConversation]);

  const questions = useQuestions(ready ? session.engine : undefined);
  const waitingQuestion = questions.list.find((q) => q.status === "pending" && (!q.expiresAtMs || q.expiresAtMs > now)) ?? null;
  const openTrunkPaused = trunks.list.some(t => t.paused && openKey?.startsWith(`agent:${t.id}:`));
  const faceNow = waitingQuestion || (openKey && (pending.get(openKey) ?? 0) > 0) ? "wait" : agentState({ live: s.live, running: Boolean(s.liveRunId), history: s.history, endedAt: s.doneAt, now, paused: openTrunkPaused, lastActivityAt: s.lastActivityAt });
  const rowState = useCallback((row: Conversation) => {
    const open = row.key === openKey;
    return { waiting: row.needsYou === true || (pending.get(row.key) ?? 0) > 0 || (open && faceNow === "wait"), working: row.working || (open && ["think", "work", "search", "read"].includes(faceNow)) };
  }, [pending, openKey, faceNow]);
  const topicUpdates: TopicUpdate[] = activeContact ? activeTopics.map((topic) => {
    const row = lists.rows.find((candidate) => candidate.key === topic.key);
    const featured = activeContact.preview.kind === "topic" && activeContact.preview.topicKey === topic.key ? activeContact.preview : null;
    return { topic, text: featured?.text ?? row?.preview ?? "", at: featured?.at ?? row?.updatedAt ?? topic.anchor?.at ?? 0, unread: topic.unread };
  }) : [];
  const topicItems: TopicListItem[] = activeTopics.map((topic) => {
    const row = lists.rows.find((candidate) => candidate.key === topic.key);
    return { topic, updatedAt: row?.updatedAt ?? topic.anchor?.at ?? 0, preview: row?.preview ?? "", who: topicWho[topic.key] ?? "", projectName: projects.projects.find((project) => project.id === topic.projectId)?.name };
  });
  const topicMainRow = topicContact ? lists.rows.find((row) => row.key === topicContact.threadKey) : null;
  const showingAll = Boolean(allTopics && topicContact && allTopics.contactId === topicContact.id && openKey === topicContact.threadKey);
  useEffect(() => {
    if (!showingAll || !topicContact) return;
    const contactId = topicContact.id;
    const main = { key: topicContact.threadKey, title: "General", updatedAt: topicMainRow?.updatedAt ?? topicContact.lastActivityAt, preview: topicMainRow?.preview ?? "" };
    const topics = topicItems.map(({ topic, updatedAt, preview }) => ({ key: topic.key, title: topic.title, labelled: topic.labelled, updatedAt, preview }));
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      let picks: Record<string, string> = {};
      try { picks = JSON.parse(localStorage.getItem("branch-topic-emoji-t5") || "{}"); } catch { /* A damaged local preference does not hide All. */ }
      void loadAllTopicTranscripts(request, main, topics, picks).then(
        (history) => { if (live) setAllTopics((value) => value?.contactId === contactId ? { contactId, history, loading: false, error: "" } : value); },
        (error: unknown) => { if (live) setAllTopics((value) => value && value.contactId === contactId ? { ...value, loading: false, error: error instanceof Error ? error.message : String(error) } : value); },
      );
    };
    reload();
    const off = session.onGatewayEvent((event) => {
      if (event !== "contacts.changed" && event !== "chat") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(reload, 100);
    });
    const storage = (event: StorageEvent) => { if (event.key === "branch-topic-emoji-t5") reload(); };
    window.addEventListener("storage", storage);
    return () => { live = false; if (timer) clearTimeout(timer); off(); window.removeEventListener("storage", storage); };
  }, [showingAll, topicContact?.id, session, activeTopics, lists.rows, ready]);
  const home = contacts.find((c) => c.isDefault) ? contactRow(contacts.find((c) => c.isDefault)!) : homeRow(lists.rows, s.mainKey, defaultName);
  const sections = buildContactSections(contacts, prefs, now);
  // The main conversation is still navigable while contacts.list is loading (or unavailable).
  if (!contacts.length && home && !prefs.trunk && prefs.status === "active") {
    sections.find((section) => section.id === "recent")?.rows.push(home);
  }
  const pinnedSection = sections.find((section) => section.id === "pinned");
  if (pinnedSection) pinnedSection.rows.sort((a, b) => {
    if (a.key === b.key) return 0;
    if (a.key === home?.key) return -1;
    if (b.key === home?.key) return 1;
    const ar = pinOrder.order.indexOf(a.key), br = pinOrder.order.indexOf(b.key);
    return (ar < 0 ? Number.MAX_SAFE_INTEGER : ar) - (br < 0 ? Number.MAX_SAFE_INTEGER : br);
  });
  const markReadContact = (contact: Contact) => {
    void markContactRead(contact, request).then(refreshContacts).catch((e: unknown) => notify(`Couldn't mark ${contact.name} read: ${e instanceof Error ? e.message : String(e)}.`, { tone: "bad" }));
  };
  const toggleContactPin = (contact: Contact) => {
    void pinContact(contact, lists.rows, actions, request, refreshContacts).catch((e: unknown) => notify(`Couldn't change ${contact.name}: ${e instanceof Error ? e.message : String(e)}.`, { tone: "bad" }));
  };
  const shownCount = sections.reduce((n, x) => n + x.rows.length, 0);
  const level = readLevel();
  const selection = useSelection(useCallback(() => sections.flatMap((x) => x.rows), [sections]));
  const rowCard = useRowCard(!rail);
  const catalogs = useCatalogs(request, ready);
  const personName = useCallback((id: string) => people.names.get(id) ?? lists.rows.find((r) => r.ownerId === id)?.ownerName ?? id, [people, lists.rows]);
  const openRow = openContactRow(openKey, contacts, lists.rows) ?? (openKey === s.mainKey ? home : null);
  const waitingTotal = [...pending.values()].reduce((a, b) => a + b, 0);
  const needsYou = useNeedsCount(session.engine, ready); // what Inbox › Needs you counts: the badge and the title
  const running = lists.rows.filter((r) => r.working).length;
  const ckptOn = useCkptOn(session.engine);
  const [setupTalk, setSetupTalk] = useState<TalkHandle | null>(null);
  const name = draftTopic ? `New conversation with ${trunkName(draftTopic.agentId)}` : activeContact?.name ?? (openRow?.isMain ? trunkName(openRow.agentId) : openRow?.title || defaultName);
  const room = useShellRoom({ engine: session.engine, rowKind: openRow?.kind, agentId: openRow?.agentId, title: name, ownTrunk: trunkName(openRow?.agentId), history: s.history, trunks: trunks.list,
    groupRoom: groupRooms.rooms.find((candidate) => candidate.roomId === roomIdOf(openKey ?? "")),
    memberName: (kind, id) => kind === "person" ? people.names.get(id) ?? id : contacts.find((contact) => contact.id === `${kind === "a2a" ? "a2a" : "trunk"}:${id}`)?.name ?? id,
  });
  const rowName = (key: string) => {
    const contact = contacts.find((c) => c.threadKey === key);
    if (contact) return contact.name;
    const r = lists.rows.find((x) => x.key === key);
    return !r ? defaultName : r.isMain ? trunkName(r.agentId) : r.title || "New conversation";
  };
  useMarkRead(request, openRow, route.kind === "chat" && ready, () => void list.refresh());
  const rowExtras = useRowExtras(openKey, level, useCallback((key: string) => lists.rows.find((r) => r.key === key)?.title || "a conversation", [lists.rows]));
  useBannerNews(session, route.kind === "chat" ? openKey : null, rowName, (key) => trunkName(lists.rows.find((r) => r.key === key)?.agentId));
  useProblemBanners({
    session,
    phase: s.status.phase,
    machineName: machine?.name ?? "",
    defaultName,
    openConnection: () => document.querySelector<HTMLElement>("[data-testid=sb-connection]")?.click(),
    askDefault: (text) => {
      if (!s.mainKey) return;
      const key = s.mainKey;
      openConversation(key);
      void session.open(key).then(() => session.send(text));
    },
  });
  const pageTitle = route.kind === "chat" ? name : route.kind === "place" ? route.place === "office" ? "Grove" : PLACES.find((p) => p.id === route.place)?.name ?? "" : pageName(route.page);
  useEffect(() => {
    document.title = windowTitle(pageTitle, needsYou, !ready);
  }, [pageTitle, needsYou, ready]);

  const narrow = () => isNarrow;
  const compact = isNarrow || layout.focus;
  const toggleList = () => {
    if (narrow()) { setSlideOpen((o) => !o); return; }
    if (topicAutoRail && !layout.rail) { setFullListFor(topicContact?.id ?? null); return; }
    setLayout(toggleListLayout(layout));
  };
  const showMenu = (e: MouseEvent<HTMLElement>, id: string, items: MenuItem[], label: string, upward = false) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const at = upward ? { x: r.left, y: r.top } : below(e);
    // A second click on the button that opened a menu closes it (§5.4 behaviour 1).
    setOverlay((cur) => (cur?.kind === "menu" && cur.id === id ? null : { kind: "menu", id, at, items, label, upward }));
  };
  const machineMenu = (e: MouseEvent<HTMLElement>, id: string, upward = false) => {
    const bridge = (window as { branchDesktop?: { gatewayUrl?: string; getGatewayUrl?: () => string } }).branchDesktop;
    const homeUrl = bridge?.getGatewayUrl?.() ?? bridge?.gatewayUrl ?? import.meta.env.VITE_GATEWAY_URL ?? LOCAL_ADDRESS;
    showMenu(e, id, machineMenuItems({ machineName: machine?.name || readTargetName(url) || "", currentUrl: url, homeUrl, online: ready, level: readLevel(), roundTripMs: gateway.health?.durationMs ?? null, openSettings,
      onLinkBranch: () => setLinkingBranch(true), onSwitch: target => window.dispatchEvent(new CustomEvent("branch:switch-computer", { detail: { url: target } })) }), "Which computer", upward);
  };
  const guideItems = (): MenuItem[] => [
    { label: "What’s new", hint: "this version", run: () => setGuide("news"), testid: "guide-news" },
    { label: "Set up Branch", hint: "3 min", run: () => firstRun.open(0), testid: "guide-setup" },
    { label: "Take the walkthrough", hint: "2 min", run: () => (setOverlay(null), setGuide("tour")), testid: "guide-tour" },
    { kind: "sep" },
    ...guideLinkItems((url) => { window.open(url, "_blank", "noopener"); }),
    { label: "What Branch can do", run: () => setOverlay({ kind: "cando" }), testid: "guide-cando" },
  ];
  const [, setReminded] = useState(0); // "Remind me tomorrow" redraws the person menu's update line
  const statusItem = (item: StatusItem, e: MouseEvent<HTMLElement>) => {
    if (item === "connection") {
      machineMenu(e, "machine-sb", true);
      return;
    }
    const above = statusAnchor(e, item);
    setOverlay((cur) => (cur?.kind === "status" && cur.item === item ? null : { kind: "status", item, above }));
  };
  const rowMenu = (row: Conversation, e: MouseEvent<HTMLElement>) =>
    selection.picked.size > 1 && selection.picked.has(row.key)
      ? showMenu(e, `row:batch`, batchMenuItems(lists.rows.filter((r) => selection.picked.has(r.key)), actions, (rows) => (askBeforeDelete() ? setDeletingMany(rows) : void actions.removeMany(rows).then(selection.clear)), selection.clear), "Conversations")
      : showMenu(e, `row:${row.key}`, rowMenuItems(row, {
      actions,
      contact: contacts.find((c) => c.threadKey === row.key),
      archiveRoom: (contact) => { if (contact.roomId) void session.request("rooms.archive", { roomId: contact.roomId }).then(() => groupRooms.reload(), (error: unknown) => notify(`Couldn't archive ${contact.name}: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" })); },
      moveToGroup: (contact) => {
        const anchor = document.querySelector<HTMLElement>(`[data-drag-key="${CSS.escape(contact.threadKey)}"]`)?.getBoundingClientRect();
        if (anchor) setGroupDrop({ kind: "pick", source: contact.threadKey, anchor });
      },
      markContactRead: markReadContact,
      pinContact: toggleContactPin,
      profile: openTrunkProfile,
      removeTrunk: (agentId, name) => setRemovingTrunk({ agentId, name }),
      whoItKnows: (contact) => {
        openConversation(contact.threadKey);
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("[data-testid=who-it-knows-button]")?.click());
      },
      muted: contacts.some((contact) => contact.threadKey === row.key && mutedContacts.has(contact.id)),
      toggleMute,
      now,
      trunkName: trunkName(row.agentId),
      open: openConversation,
      ownWindow: (key) => { void openConversationWindow(key).catch((error: unknown) => notify(`Couldn't open window: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" })); },
      ownWindowOpen: (key) => poppedKeys.includes(key),
      ownWindowOff: ownWindowUnavailable(),
      rename: (r) => {
        openConversation(r.key);
        setRenaming(r.key);
      },
      confirmDelete: (r) => (askBeforeDelete() ? setDeleting(r) : void actions.remove(r)),
      level: readLevel(),
      ask: (r) => {
        openConversation(r.key);
        void session.open(r.key).then(() => session.send("What can you do?"));
      },
      editTrunk: () => openPlace("customize"),
      tidy: (r, keepLast) => (keepLast ? setKeeping(r) : void tidy({ session, list }, r, false)),
      copyMarkdown: (r) => void copyMarkdown(session.engine, r.key, rowName(r.key)),
      copyText: (text) => void copyText(text),
      copyLink: (r) => void copyText(conversationLink(r.key)),
      copyConversation: (r) => void actions.copyConversation(r, openConversation),
      lookItem: iconColourItem(row, (change) => actions.setLook(row, change)),
    }), "Conversation", e.type === "contextmenu"); // a right-click opens it above the row, at its left edge, as the artifact does
  const changeTheme = (t: ThemeChoice) => setTheme(setThemeChoice(t));
  const changePrefs = (p: ListPrefs) => {
    setPrefs(p);
    savePrefs(p);
  };
  const focusSearch = () => {
    if (topicAutoRail) setFullListFor(topicContact?.id ?? null);
    if (rail || layout.hidden) {
      setLayout({ rail: false, hidden: false });
    }
    if (narrow()) {
      setSlideOpen(true);
    }
    setTimeout(() => document.querySelector<HTMLInputElement>("[data-testid=search] input")?.focus(), 0);
  };

  useShortcuts({
    palette: () => setOverlay((o) => (o?.kind === "palette" ? null : { kind: "palette" })),
    newConversation: () => void startNew(),
    settings: () => openSettings("appearance"),
    sidePanel: () => setPane((value) => (value ? null : "Activity")), // Ctrl Shift K unless the person set other keys
    quickAsk: () => setOverlay((o) => (o?.kind === "ask" ? null : { kind: "ask" })),
    focusMode: () => setLayout({ focus: !layout.focus }),
    toggleList,
    inbox: () => openPlace("inbox"),
    focusSearch,
    focusPastSearch: () => {
      search.setChip("past");
      focusSearch();
    },
    talkBeside: () => {
      if (route.kind !== "chat") setTalk({ open: !talk.open });
    },
    archiveOpen: () => {
      if (openRow && !openRow.isMain && !overlay) {
        void actions.archive(openRow);
      }
    },
    lockdown: toggleLockdown,
    talkLive: () => window.dispatchEvent(new Event(TALK_EVENT)),
    stop: () => void session.stopRun(),
    nextConversation: () => {
      const order = sections.flatMap((x) => x.rows);
      const next = order[(order.findIndex((r) => r.key === openKey) + 1) % Math.max(order.length, 1)];
      if (next) {
        openConversation(next.key);
      }
    },
    shortcuts: () => setOverlay({ kind: "shortcuts" }),
    escape: () => {
      // Escape closes, in order: the popover, then the dialog, then focus mode, then the slide-over (§3.6).
      if (overlay) {
        setOverlay(null);
        return true;
      }
      if (stage) {
        setStage(null);
        return true;
      }
      if (pane) {
        setPane(null);
        return true;
      }
      if (layout.focus) {
        setLayout({ focus: false });
        return true;
      }
      if (slideOpen) {
        setSlideOpen(false);
        return true;
      }
      return false;
    },
  });

  const header =
    route.kind === "chat"
      ? {
          name,
          trunkName: trunkName(draftTopic?.agentId ?? openRow?.agentId),
          state: draftTopic ? "idle" as const : faceNow,
          paused: !draftTopic && openTrunkPaused,
          isDefaultTrunk: (draftTopic?.agentId ?? openRow?.agentId) === trunks.defaultId,
          role: trunks.list.find((t) => t.id === (draftTopic?.agentId ?? openRow?.agentId ?? trunks.defaultId))?.theme,
          renaming: !draftTopic && renaming !== null && renaming === openKey,
          onProfile: !draftTopic && room.header ? undefined : () => openTrunkProfile(draftTopic?.agentId ?? openRow?.agentId ?? trunks.defaultId ?? undefined),
          room: draftTopic ? null : room.header,
          colour: draftTopic ? null : colourHue(openRow?.color),
          onRename: (value: string | null) => {
            setRenaming(null);
            if (value !== null && openRow && value.trim() !== openRow.title) {
              void actions.rename(openRow, value);
            }
          },
        }
      : null;
  const voiceReady = useVoiceCatalog(ready ? session.engine : undefined);
  const pet = usePetLook(session.engine);
  // Let it roam (Appearance › Pet) walks the pet along the chat instead of the card; one pet on screen at a time.
  const lanePet = pet.roam ? pet : { ...pet, id: "none" };
  // Stopping the roam brings the card back, with Undo; the pet's menu and the header face both use it (pet-roam.ts).
  const roamSetting = lookStore(session.engine);
  const stopRoamingHere = () => stopRoaming(roamSetting, () => setCharacterVisible(true));
  const onCharacterButton = () => headerFace(pet.roam, roamSetting, () => setCharacterVisible(true), () => setCharacterVisible(!characterShown));
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pausedTrunks = trunks.list.filter((t) => t.paused);
  const statusExtras = {
    session,
    ready,
    paused: pausedTrunks.map((t) => ({ id: t.id, name: t.name })),
    allPaused: pausedTrunks.length > 0 && pausedTrunks.length === trunks.list.length,
    gfx: shown.gfx,
    onMenu: (e: MouseEvent<HTMLElement>, id: string, items: MenuItem[], label: string) => showMenu(e, id, items, label, true),
    onSettings: openSettings,
  };
  /** "Open another conversation beside": the first pane shows the one picked (the preview's beside15). */
  const besideItems = (): MenuItem[] => [
    { kind: "head", label: "Open beside this one" },
    ...lists.rows.filter((r) => r.key !== openKey && !r.archived).map((r): MenuItem => ({
      label: rowName(r.key),
      sub: r.preview.slice(0, 44) || undefined,
      icon: <Face size={22} label={trunkName(r.agentId)} />,
      run: () => {
        setPanes((cur) => (cur.length ? cur.map((x, i) => (i === 0 ? { ...x, key: r.key } : x)) : [{ key: r.key, dir: "right" }]));
        if (innerWidth < 1000) notify(TOO_NARROW);
      },
    })),
  ];
  const split = (dir: "right" | "down") => {
    const w = document.getElementById("main")?.clientWidth ?? innerWidth;
    const cols = panes.filter((x) => x.dir === "right").length + 1;
    if (dir === "right" && w / (cols + 1) < MIN_PANE) {
      notify(NO_ROOM);
      return;
    }
    setPanes((cur) => [...cur, { key: null, dir: cur.length ? dir : "right" }]);
    if (innerWidth < 1000) notify(TOO_NARROW);
  };
  const conversationMenu = useConversationMenu({
    session,
    url,
    ready,
    now,
    row: openRow,
    ownWindowOpen: dedicated || Boolean(openKey && poppedKeys.includes(openKey)),
    isMain: !openRow || openKey === s.mainKey,
    title: name,
    trunk: { id: openRow?.agentId ?? trunks.defaultId ?? undefined, name: trunkName(openRow?.agentId) },
    trunks,
    actions,
    history: s.history,
    onRename: () => openKey && setRenaming(openKey),
    onDelete: (row) => (askBeforeDelete() ? setDeleting(row) : void actions.remove(row)),
    openPlace,
    characterHidden: !characterShown,
    onShowCharacter: () => setCharacterVisible(true),
    talkOff: voiceReady.live ? null : VOICE_OFF,
    onTalk: () => window.dispatchEvent(new Event(TALK_EVENT)),
    onSearch: () => window.dispatchEvent(new Event(FIND_EVENT)),
    onSidePanel: () => setPane((value) => value ? null : "Activity"),
    onTower: () => setTowerOn((on) => { try { localStorage.setItem("branch.controlTower", on ? "hidden" : "shown"); } catch { /* current window only */ } return !on; }),
    towerVisible: towerOn,
    onList: toggleList,
    onTheme: () => setTheme(toggleTheme(theme)),
    onComputer: () => setStage("Computer"),
    onBrowser: () => setStage("Browser"),
    onGuide: () => { const rect = document.querySelector<HTMLElement>("[data-testid=conversation-menu-button]")?.getBoundingClientRect(); setOverlay({ kind: "menu", id: "guide", at: { x: rect?.left ?? 8, y: (rect?.bottom ?? 48) + 4 }, items: guideItems(), label: "Guide" }); },
    hasContactReturn: Boolean(topicReturnKey && (draftTopic || openKey !== topicReturnKey)),
    onBackToContact: () => { if (topicReturnKey) { const key = topicReturnKey; setTopicReturnKey(null); openConversation(key); } },
    hasContactConversations: Boolean(topicContact && !draftTopic),
    threadView: topicContact && activeTopics.length ? { contactName: topicContact.name, layout: topicLayout as TopicLayout, set: (next: TopicLayout) => { setContactTopicLayout(topicContact.id, next); setTopicLayout(next); } } : undefined,
    onConversations: () => setPane((value) => value === "Conversations" ? null : "Conversations"),
    besideOpen: panes.length > 0,
    // The first time, the pane opens straight away with its own chooser (the artifact's pane); after that the menu
    // changes which conversation sits beside this one.
    onBeside: (at) => (panes.length ? setOverlay({ kind: "menu", id: "beside", at, label: "Open beside this one", items: besideItems() }) : split("right")),
    onSplit: split,
    onAddComputer: () => setAddingComputer(true),
    onManageComputers: () => openSettings("computer"),
    room: room.menu ? { ...room.menu, members: room.members } : null,
  });
  const areaProps = {
    engine: session.engine,
    sessionKey: s.sessionKey,
    onReload: () => void session.reload(),
    onToast: (text: string) => notify(text),
    onOpenSession: openConversation,
    onReply: (target: { entryId: string; name: string; text: string }) => setReplyTo(target),
  };
  const sideWidth = layout.hidden && !isNarrow ? 0 : liveW ?? (rail ? 68 : layout.sideW);
  const frameClass = ["frame", dedicated ? "dedicated" : "", rail ? "rail" : "", layout.hidden && !isNarrow ? "list-hidden" : "", layout.focus ? "focus" : "", slideOpen ? "slide-open" : ""].filter(Boolean).join(" ");
  const summary = filterSummary(prefs, trunkName, personName);
  const dark = theme === "system" ? systemDark : effectiveDark(theme);
  const filterOpen = overlay?.kind === "filter";

  const who = trunkName(openRow?.agentId);
  const conversationNeed = conversationNeedsYou(pending, openKey, questions.list, now);
  const conversationTools = (
    <>
      {draftTopic ? null :
      <ConversationMoreButton need={conversationNeed} idleTitle={`More for ${openRow?.kind === "group" ? name : who}`} onClick={conversationMenu.open} />
      }
    </>
  );
  let main: ReactNode;
  if (route.kind === "chat") {
    const composerProps = {
      ...areaProps,
      lockdown: lockdown.on,
      onToggleLockdown: lockdown.supported ? toggleLockdown : undefined,
      replyTo,
      onClearReply: () => setReplyTo(null),
      onOpenConversation: openConversation,
      lastUserEntryId: [...s.history].reverse().find((block) => block.kind === "user")?.meta?.entryId,
      offline: !ready,
      connectionTarget: (() => {
        const host = new URL(url).hostname;
        return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" ? "this computer" : machine?.name || host;
      })(),
      onOpen: (target: string) => {
        if (target === "settings/accounts/add") {
          sessionStorage.setItem("branch.openAddAccount", "1");
          openSettings("accounts");
        } else if (target.startsWith("settings/")) {
          openSettings(target.slice("settings/".length));
        } else if (target === "customize/tools") {
          openPlace("customize");
        } else if (target === "local-model-setup") {
          openSettings("local");
        }
      },
    };
    main = draftTopic ? (
      <div className="conversation-column" data-testid="new-topic-draft" ref={setConversationColumn}>
        {compact && header ? <HeaderRow header={header} onCharacter={onCharacterButton} onList={toggleList} onBack={() => window.history.back()} onForward={() => window.history.forward()} tools={conversationTools} /> : null}
        <Thread
          name={trunkName(draftTopic.agentId)}
          history={[]}
          live={[]}
          pendingUser={draftEcho}
          running={Boolean(draftEcho)}
          engine={draftEngine}
          onAnswer={() => undefined}
          onOpenSession={openConversation}
          onStart={(start) => void sendNew(start)}
        />
        <div className={lanePet.id === "none" ? "pet-lane empty" : "pet-lane"} aria-label="Pet"><SidebarPet pet={lanePet} onStopRoaming={stopRoamingHere} still={reducedMotion || document.documentElement.hasAttribute("data-still")} working={lists.rows.some((r) => rowState(r).working)} waiting={null} /></div>
        <Composer
          key={draftTopic.nonce}
          {...composerProps}
          engine={draftEngine}
          name={trunkName(draftTopic.agentId)}
          draftAgentId={draftTopic.agentId}
          draftTemporary={draftTopic.options.incognito === true}
          mainKey={mainKeySuffix}
          working={false}
          disabled={!ready || !trunks.loaded || firstRun.requiresContact}
          onSend={sendNew}
          onStop={() => undefined}
          onNewTopic={(agentId, options) => options ? startNew(agentId, options) : setDraftTopic((current) => current ? { ...current, agentId } : current)}
          above={<WhereChips engine={session.engine} row={openRow?.agentId === draftTopic.agentId ? openRow : null} trunkName={trunkName(draftTopic.agentId)} advanced={level !== "regular"} projectName={null} draft onStartTopic={(options) => setDraftTopic((current) => current ? { ...current, options: { ...(current.options.incognito === true ? { incognito: true } : {}), ...options } } : current)} />}
        />
      </div>
    ) : (
      <>
        <StageConversation
        columnRef={setConversationColumn}
        header={compact && header ? <HeaderRow header={header} onCharacter={onCharacterButton} onList={toggleList} onBack={() => window.history.back()} onForward={() => window.history.forward()} tools={conversationTools} /> : null}
        topics={topicContact && activeTopics.length ? <TopicRail
          contactId={topicContact.id}
          contactName={topicContact.name}
          contactKey={topicContact.threadKey}
          generalPreview={topicMainRow?.preview ?? ""}
          generalWho={topicWho[topicContact.threadKey] ?? ""}
          generalUpdatedAt={topicMainRow?.updatedAt ?? topicContact.lastActivityAt}
          currentKey={openKey}
          allSelected={showingAll}
          phoneList={phoneTopicListFor === topicContact.id}
          items={topicItems}
          onOpen={(key) => { setPhoneTopicListFor(null); setAllTopics(null); if (key === topicContact.threadKey) openConversation(key); else openTopic(key); }}
          onAll={() => {
            setPhoneTopicListFor(null);
            const contact = topicContact;
            setAllTopics({ contactId: contact.id, history: [], loading: true, error: "" });
            openConversation(contact.threadKey);
          }}
          onLayout={(next) => {
            setTopicLayout(next);
            if (next === "tabs" || next === "side") setPhoneTopicListFor(null);
          }}
          onPatch={async (topic, change) => {
            await patchTopicSession(request, topic, lists.rows.find((row) => row.key === topic.key)?.sessionId, change);
            await list.refresh();
          }}
        /> : null}
        thread={<SplitFrame panes={panes} width={splitW} onWidth={setSplitW} side={
          <SplitPanes
            panes={panes}
            rows={lists.rows}
            openKey={openKey}
            request={request}
            onEvent={onGatewayEvent}
            trunkName={trunkName}
            rowName={rowName}
            onOpen={openConversation}
            onPick={(n, key) => setPanes((cur) => cur.map((x, i) => (i === n ? { ...x, key } : x)))}
            onClose={(n) => setPanes((cur) => cur.filter((_, i) => i !== n).map((x, i) => (i === 0 ? { ...x, dir: "right" } : x)))}
            onMenu={(e, id, items, label) => showMenu(e, id, items, label)}
            onSplit={split}
          />
        }>
        <Thread
          lockdown={lockdown.on}
          {...areaProps}
          engine={showingAll ? undefined : session.engine}
          sessionKey={showingAll ? null : s.sessionKey}
          findRequest={searchFind?.key === openKey ? searchFind : null}
          onFindRequestHandled={(nonce) => setSearchFind((current) => current?.nonce === nonce ? null : current)}
          earlierPages={segments.pages}
          currentStartedAt={segments.currentStartedAt}
          hasEarlierPages={segments.hasEarlier}
          loadingEarlier={segments.loading}
          earlierError={segments.error}
          preparationError={s.error}
          onStartupReady={() => session.retryOpen()}
          advancedDiagnostics={level !== "regular"}
          onLoadEarlier={segments.loadEarlier}
          onOpenSession={(key) => { if (showingAll) setAllTopics(null); openTopic(key); }}
          onStartTopic={!showingAll && activeContact?.kind === "trunk" ? startFromMessage : undefined}
          topicUpdates={topicContact && activeTopics.length ? [] : topicUpdates}
          focusTopic={focusTopic}
          onOpenActivity={() => { setPane("Activity"); setFocusHelpers((n) => n + 1); }}
          supplement={
            <>
              <ComputerActivityCard blocks={[...s.history, ...s.live]} running={Boolean(s.liveRunId)} name={trunkName(openRow?.agentId)} engine={session.engine} gatewayUrl={url} onWatch={(mode, takeOver) => { setStageTakeOver(Boolean(takeOver)); setStage(mode); }} />
            </>
          }
          name={trunkName(openRow?.agentId)}
          showThinking={conversationMenu.showThinking}
          liveStartedAt={s.liveStartedAt}
          room={room.thread}
          history={showingAll ? allTopics?.loading ? [] : allTopics!.history : mergeRoomNotices(s.history, roomNotices)}
          historyReady={showingAll ? !allTopics?.loading : s.historyReady}
          live={showingAll ? [] : s.live}
          questions={showingAll ? [] : questions.list}
          onStart={(text: string) => void session.send(text)}
          recoveryFailure={openRow?.runError}
          plan={progress.card && !planDismiss.dismissed ? <PlanCard card={progress.card} onRefresh={planRefresh.refresh} refreshing={planRefresh.status} onDismiss={planDismiss.dismiss} /> : null}
          pendingUser={s.pendingUser}
          queued={s.queued}
          steered={s.steered}
          ended={s.ended}
          running={Boolean(s.liveRunId)}
          onAnswer={(id, decision) => void session.answer(id, decision)}
        />
        </SplitFrame>}
        notice={showingAll && allTopics?.error ? <p className="notice indent">Couldn't read all threads: {allTopics.error}</p> : showingAll && allTopics?.loading ? <p className="notice indent">Reading all threads…</p> : s.error && !isPreparationPending(s.error) && !isPreparationStalled(s.error) ? <p className="notice indent">{s.error}</p> : null}
        stage={stage ? (
          <ComputerStage key={openKey} engine={session.engine} gatewayUrl={url} name={trunkName(openRow?.agentId)} mode={stage} blocks={[...s.history, ...s.live]} running={Boolean(s.liveRunId)} card={progress.card} initialComputer={stageComputer} initialControl={stageTakeOver} onMode={setStage} onClose={() => { setStage(null); setStageComputer(null); setStageTakeOver(false); }} onChooseComputer={() => openSettings("computer")} onPip={(computer) => { setPip(computer); setStage(null); }} />
        ) : null}
        pet={<div className={lanePet.id === "none" ? "pet-lane empty" : "pet-lane"} aria-label="Pet"><SidebarPet pet={lanePet} onStopRoaming={stopRoamingHere} still={reducedMotion || document.documentElement.hasAttribute("data-still")} working={lists.rows.some((r) => rowState(r).working)} waiting={(() => { const w = lists.rows.find((r) => rowState(r).waiting); return w ? trunkName(w.agentId) : null; })()} /></div>}
        composer={<Composer
          {...composerProps}
          mainKey={mainKeySuffix}
          onNewTopic={startNew}
          name={trunkName(openRow?.agentId)}
          placeholder={room.placeholder}
          working={Boolean(s.liveRunId)}
          disabled={!s.sessionKey || !ready || !trunks.loaded || !trunks.list.length || firstRun.requiresContact}
          plan={progress.card?.steps?.length && !planDismiss.dismissed ? { done: progress.card.steps.filter((x) => x.status === "completed").length, total: progress.card.steps.length, steps: progress.card.steps } : null}
          above={
            waitingQuestion ? (
              <DockQuestion record={waitingQuestion} trunkName={trunkName(openRow?.agentId)} onResolve={questions.resolve} />
            ) : setupTalk ? (
              <TalkSetup handle={setupTalk} />
            ) : newTrunkFlow && newTrunkFlow.sessionKey === openKey ? (
              <NewTrunkCard engine={session.engine} flow={newTrunkFlow} onDone={(name) => { setNewTrunkFlow(null); notify(`${name} is ready. What’s the first job?`); }} />
            ) : ready && s.historyReady !== false && !roomNotices.length && !s.history.length && !s.pendingUser && !s.liveRunId ? (
              <WhereChips key={s.sessionKey} engine={session.engine} row={openRow} trunkName={trunkName(openRow?.agentId)} advanced={level !== "regular"}
                projectName={projects.projects.find((x) => x.id === openRow?.projectId)?.name ?? null} onStartTopic={(options) => startNew(openRow?.agentId, options)} />
            ) : null
          }
          onSend={(text: string, extras?: SendExtras, idempotencyKey?: string) => { if (showingAll) setAllTopics(null); void session.send(text, extras, idempotencyKey); }}
          onStop={() => void session.stopRun()}
        />}
        />
        {pane && ready ? (
          <SidePane key={s.sessionKey} engine={session.engine} name={trunkName(openRow?.agentId)} blocks={[...s.history, ...s.live]} running={Boolean(s.liveRunId)} card={progress.card} cardError={progress.error} tab={pane} focusHelpers={focusHelpers} onTab={setPane} onClose={() => setPane(null)} toast={notify} title={name} onReload={() => void session.reload()}
            contactTopics={topicContact ? { items: topicItems, name: topicContact.name, onOpen: openTopic } : undefined} />
        ) : null}
      </>
    );
  } else if (route.kind === "place") {
    main = (
      <>
        {isNarrow ? <PlaceHead onList={toggleList} onSettings={() => openSettings("general")} onBack={() => window.history.back()} onForward={() => window.history.forward()} /> : null}
        <PlaceView place={route.place} engine={session.engine} facts={{ running, waiting: waitingTotal }} openConversation={openConversation} openPlace={openPlace} openSettings={openSettings} startConversation={(agentId) => void startNew(agentId)} createTrunk={() => void newTrunk()} />
      </>
    );
  } else {
    main = <SettingsFrame page={route.page} backName={name} engine={session.engine} onPage={openSettings} onBack={() => go({ kind: "chat", key: openKey })} onAsk={(text) => void askDefault(text)} askName={defaultName} />;
  }
  const talkEntry: TalkEntry | null =
    route.kind === "chat" ? null : { name: defaultName, keys: currentKeys(keyActions(defaultName), readCustomKeys()).talkBeside, open: talk.open, onToggle: () => setTalk({ open: !talk.open }) };
  const talkShown = talkEntry !== null && route.kind === "place" && talk.open && !layout.focus;
  if (route.kind !== "chat") {
    main = (
      <>
        <div className="talk-page">{main}</div>
        {talkShown ? (
          <TalkBeside
            request={request}
            onEvent={onGatewayEvent}
            sessionKey={s.mainKey}
            name={defaultName}
            page={pageTitle}
            layout={talk}
            onLayout={setTalk}
            onFull={() => {
              setTalk({ open: false });
              if (s.mainKey) openConversation(s.mainKey);
            }}
          />
        ) : null}
      </>
    );
  }
  const threadGeneralKey = topicContact?.threadKey ?? (openRow?.isMain ? openKey : null);
  const showThreadColumn = shouldShowThreadColumn({
    chat: route.kind === "chat",
    focus: layout.focus,
    stage: Boolean(stage),
    draft: Boolean(draftTopic),
    generalKey: threadGeneralKey,
    topicRow: Boolean(topicContact && activeTopics.length),
  });
  const showTower = route.kind === "chat" && ready && towerOn && !pane && !layout.focus && !stage && !draftTopic && firstRun.step === null;
  const mainClass = route.kind === "chat" ? `main${pane ? " with-pane" : ""}${showThreadColumn || showTower ? " v23-layout" : ""}` : talkShown ? (talk.dock === "bottom" ? "main with-talk talk-bottom" : "main with-talk") : "main";

  return (
    <TrunkAppearances.Provider value={appearances}>
    <TrunkPebbleLooks.Provider value={Object.fromEntries(trunks.list.map((t) => [t.name, { colour: t.colour, shape: t.shape, eyes: t.eyes }]))}>
    <TrunkEmojiFaces.Provider value={Object.fromEntries(trunks.list.map((t) => [t.name, t.emoji ?? ""]))}>
    <div className={frameClass} data-connection={ready ? "ready" : s.status.phase} data-route={route.kind} style={{ ["--side-w" as string]: `${dedicated ? 0 : sideWidth}px` }}>
      <a className="skip" href="#main">
        {route.kind === "chat" ? "Skip to the conversation" : "Skip to the page"}
      </a>
      <TopBar
        compact={compact}
        machine={<MachineSwitcher name={machine?.name || readTargetName(url) || "This computer"} online={ready} connecting={s.status.phase === "connecting"} onOpen={(e) => machineMenu(e, "machine")} />}
        header={header}
        dark={dark}
        listHidden={isNarrow ? !slideOpen : rail || layout.hidden}
        onToggleList={toggleList}
        onBack={() => window.history.back()}
        onForward={() => window.history.forward()}
        onCharacter={onCharacterButton}
        onGuide={(e) => showMenu(e, "guide", guideItems(), "Guide")}
        conversationTools={conversationTools}
        ask={route.kind === "settings" ? { name: defaultName, open: false, help: true, onToggle: () => window.dispatchEvent(new Event("branch-settings-help")) } : talkEntry}
        onSettings={route.kind === "place" ? () => openSettings("general") : undefined}
      />
      <Sidebar
        home={home}
        sections={sections}
        openKey={route.kind === "chat" ? openKey : null}
        currentPlace={route.kind === "place" ? route.place : null}
        now={now}
        showPreview={prefs.preview}
        poppedKeys={poppedKeys}
        rowState={rowState}
        trunkName={trunkName}
        personName={person}
        hasUnread={contacts.some((contact) => (contact.threadUnread && contact.threadKey !== openKey) || contact.unreadTopics > 0)}
        filterSlot={<FilterButton prefs={prefs} open={filterOpen} onOpen={(e) => (filterOpen ? setOverlay(null) : setOverlay({ kind: "filter", at: below(e) }))} />}
        summary={
          summary ? (
            <span className="filter-sum" data-testid="filter-summary">
              {summary}
              <button type="button" className="ib sm" aria-label="Clear filters" title="Clear filters" onClick={() => changePrefs(clearFilters(prefs))}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ) : null
        }
        emptyLine={emptyLineFor(prefs, shownCount) ?? (contactsLoaded && trunks.loaded && contactRows.length === 0 ? "No contacts yet. Use + to create one." : null)}
        search={<SearchBox query={search.query} onQuery={search.setQuery} />}
        searchResults={
          search.query.trim() ? (
            <SearchResultsView
              query={search.query}
              chip={search.chip}
              results={search.results}
              now={now}
              trunkName={trunkName}
              rowName={rowName}
              onChip={search.setChip}
              onOpen={(key) => {
                search.setQuery("");
                openConversation(key);
              }}
              onOpenMessage={(key, query) => {
                search.setQuery("");
                openSearchMessage(key, query);
              }}
              onLibrary={() => {
                search.setQuery("");
                openPlace("library");
              }}
            />
          ) : null
        }
        rail={rail}
        onReorderPins={(drop, visible) => { if (drop.source !== home?.key) void pinOrder.move(drop, visible); }}
        dropHint={(drop) => drop.target.startsWith("project:") ? (contacts.find((c) => c.threadKey === drop.source)?.thread ? `Move to ${projects.projects.find((p) => p.id === drop.target.slice(8))?.name ?? "project"}` : "") : groupHint(drop, contacts, groupRooms.rooms)}
        onGroupDrop={(drop, anchor) => {
          if (drop.target.startsWith("project:")) {
            const contact = contacts.find((candidate) => candidate.threadKey === drop.source);
            if (contact?.thread) void moveContactToProject(session, contact.threadKey, drop.target.slice(8)).then(() => list.refresh(), (error: unknown) => notify(`Couldn't move ${contact.name}: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" }));
            return;
          }
          const kind = groupPlan(drop, contacts, groupRooms.rooms);
          if (kind === "new" || kind === "add") {
            const source = contacts.find((c) => c.threadKey === drop.source);
            const target = contacts.find((c) => c.threadKey === drop.target);
            setGroupDrop({ kind, source: drop.source, target: drop.target, roomId: target?.roomId ?? source?.roomId, anchor });
          }
        }}
        onRailSearch={focusSearch}
        onOpen={(key) => {
          selection.clear();
          setTopicReturnKey(null);
          const contact = contacts.find((candidate) => candidate.threadKey === key);
          setPhoneTopicListFor(innerWidth <= 640 && contact?.topicCount && topicLayout !== "tabs" && topicLayout !== "side" ? contact.id : null);
          setFocusTopic(contact?.preview.kind === "topic" ? { key: contact.preview.topicKey, nonce: Date.now() } : null);
          openConversation(key);
        }}
        onNew={(e) => showMenu(e, "new", [
          ...newMenuItems({ newWith: (id) => startNew(id), trunks: trunks.list, defaultId: trunks.defaultId, newTrunk: () => void newTrunk(), openPlace, makeTrunk: () => setOverlay({ kind: "studio" }), quickAsk: () => setOverlay({ kind: "ask" }) }),
          ...(rail ? [{ kind: "sep" as const }, { label: "Settings", run: () => openSettings("general") }, { label: "Show the full list", hint: "Ctrl B", run: () => { if (topicAutoRail && !layout.rail) setFullListFor(topicContact?.id ?? null); else setLayout({ rail: false }); } }] : []),
        ], "New")}
        onMenu={rowMenu}
        onPin={(r) => { const contact = contacts.find((c) => c.threadKey === r.key); if (contact) toggleContactPin(contact); else void actions.pin(r); }}
        onArchive={(r) => {
          const roomId = contacts.find((contact) => contact.threadKey === r.key)?.roomId;
          if (roomId) void session.request("rooms.archive", { roomId }).then(() => groupRooms.reload(), (error: unknown) => notify(`Couldn't archive ${r.title}: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" }));
          else void (r.archived ? actions.restore(r) : actions.archive(r));
        }}
        onMarkAllRead={() => void Promise.all(contacts.map((contact) => markContactRead(contact, request))).then(refreshContacts).catch((e: unknown) => notify(`Couldn't mark all read: ${e instanceof Error ? e.message : String(e)}.`, { tone: "bad" }))}
        onPerson={(e) => (overlay?.kind === "person" ? setOverlay(null) : setOverlay({ kind: "person", at: above(e), from: statusAnchor(e, "connection") }))}
        onSettings={() => openSettings("general")}
        talk={talkEntry}
        projects={shown.projects ? projects.projects : undefined}
        allRows={lists.rows}
        onNewProject={() => setNewProject(true)}
        rowExtras={rowExtras}
        machine={isNarrow ? <MachineSwitcher name={machine?.name || readTargetName(url) || "This computer"} online={ready} connecting={s.status.phase === "connecting"} onOpen={(e) => machineMenu(e, "machine-side")} /> : undefined}
        selected={selection.picked}
        onSelect={selection.select}
        onCard={rowCard.onCard}
        showOnly={prefs.groupBy === "person" ? { current: prefs.people, name: personName, onShow: (id) => changePrefs({ ...prefs, people: id ? `p:${id}` : "everyone" }) } : undefined}
        onClearFilters={() => changePrefs(clearFilters(prefs))}
        appSections={
          <AppSections
            data={catalogs}
            now={now}
            onMenu={(e, id, items, label) => showMenu(e, id, items, label)}
            onRead={(thread, label) => setReading({ thread, label })}
            onDelete={(thread, label) => setReading({ thread, label, remove: true })}
          />
        }
      />
      {rowCard.card ? (
        <RowCard
          row={rowCard.card.row}
          anchor={rowCard.card.el}
          request={request}
          trunkName={trunkName(rowCard.card.row.agentId)}
          personName={person}
          project={projects.projects.find((x) => x.id === rowCard.card?.row.projectId)?.name ?? null}
          advanced={level !== "regular"}
          extras={rowExtras(rowCard.card.row)}
        />
      ) : null}
      {layout.focus || layout.hidden ? null : <SideResizer layout={layout} onLayout={setLayout} onLive={setLiveW} />}
      {slideOpen ? <div className="slide-scrim" onClick={() => setSlideOpen(false)} /> : null}
      <main className={mainClass} id="main">
        {lockdown.on ? <LockdownBanner onTurnOff={toggleLockdown} /> : null}
        {layout.focus ? (
          <button type="button" className="btn sm focus-exit" onClick={() => setLayout({ focus: false })}>
            {keyLabel("Leave focus mode · Ctrl+.")}
          </button>
        ) : null}
        {showThreadColumn && threadGeneralKey ? <ThreadColumn key={topicContact?.id ?? threadGeneralKey} name={topicContact?.name ?? defaultName} generalKey={threadGeneralKey} openKey={openKey} items={topicItems} onOpen={(key) => key === threadGeneralKey ? openConversation(key) : openTopic(key)}
          onMenu={(e, key, label) => { const row = lists.rows.find((r) => r.key === key); if (row) showMenu(e, `thread:${key}`, threadMenuItems(row, { actions, rename: (r) => { openConversation(r.key); setRenaming(r.key); } }), label); }} /> : null}
        {main}
        {showTower ? <ControlTower engine={session.engine} rows={lists.rows} needsCount={needsYou} trunkName={trunkName} onOpen={openConversation} onInbox={() => openPlace("inbox")} onClose={() => { setTowerOn(false); try { localStorage.setItem("branch.controlTower", "hidden"); } catch { /* current window only */ } }} /> : null}
      </main>
      {addingComputer && ready ? <AddComputer engine={session.engine} onClose={() => setAddingComputer(false)} onAdded={computersChanged} /> : null}
      {linkingBranch && ready ? <BranchLinkDialog engine={session.engine} onClose={() => setLinkingBranch(false)} onOpenGatewaySettings={() => { setLinkingBranch(false); openSettings("gateway"); }} /> : null}
      {route.kind === "chat" && pip && !stage ? (
        <StagePip key={openKey} engine={session.engine} gatewayUrl={url} name={trunkName(openRow?.agentId)} computer={pip} blocks={[...s.history, ...s.live]} onOpen={() => { setPip(null); setStage(pip.kind === "browser" ? "Browser" : "Computer"); }} onClose={() => setPip(null)} />
      ) : null}
      {ready ? <SaveProgressOffer engine={session.engine} limits={limits} on={ckptOn} runningKeys={lists.rows.filter((r) => r.working).map((r) => r.key)} /> : null}
      {shown.statusBar ? (
        <StatusBar
          connection={ready ? "connected" : s.status.phase === "connecting" ? "connecting" : "offline"}
          gateway={!ready ? (s.status.phase === "connecting" ? "checking" : "offline") : gateway.health?.ok ? "on" : gateway.error || gateway.health ? "offline" : "checking"}
          machineName={machine?.name || "this computer"}
          roomUsed={route.kind === "chat" ? roomUsed(openRow) : null}
          running={running}
          version={branchVersion}
          readyVersion={update?.latest}
          usage={shown.usage ? ringReading(limits) : null}
          usageShown={shown.usage}
          gatewayShown={shown.gateway}
          open={overlay?.kind === "status" ? overlay.item : overlay?.kind === "menu" && overlay.id === "machine-sb" ? "connection" : null}
          extras={{
            left: <StatusLeftExtras {...statusExtras} />,
            gfx: <StatusGfx {...statusExtras} />,
          }}
          onItem={statusItem}
        />
      ) : null}
      {overlay?.kind === "status" ? (
        <StatusPopover
          item={overlay.item}
          above={overlay.above}
          onClose={() => setOverlay(null)}
          ctx={{
            session,
            list,
            limits,
            gateway,
            update,
            version: branchVersion,
            computerName: machine?.name ?? "",
            openRow,
            working: lists.rows.filter((r) => r.working).map((r) => ({ key: r.key, title: trunkName(r.agentId), line: r.isMain ? "Working" : r.title || "New conversation", runIds: r.activeRunIds })),
            openSettings,
            openAutomations: () => openPlace("automations"),
            openConversation,
            onWhatsNew: () => setGuide("news-ready"),
            onReminded: () => setReminded((n) => n + 1),
          }}
        />
      ) : null}
      {overlay?.kind === "menu" ? <Menu at={overlay.at} items={overlay.items} label={overlay.label} upward={overlay.upward} testid={`${overlay.id.split(":")[0]}-menu`} onClose={() => setOverlay(null)} /> : null}
      {overlay?.kind === "filter" ? (
        <FilterSortPopover
          at={overlay.at}
          prefs={prefs}
          facts={{
            trunks: trunks.list,
            people,
            owners: owners(lists.rows).length,
            folders: hasFolders(lists.rows),
            level,
            unreadTrunks: new Set(filterRows(lists.rows, { ...prefs, trunk: null }, now, openKey, people).filter((r) => r.unread && r.key !== openKey).map((r) => r.agentId ?? "")),
          }}
          onChange={changePrefs}
          onClose={() => setOverlay(null)}
          onSettings={openSettings}
        />
      ) : null}
      {overlay?.kind === "person" ? (
        <PersonMenu
          at={overlay.at}
          above={overlay.from}
          person={person}
          theme={theme}
          onTheme={changeTheme}
          onClose={() => setOverlay(null)}
          onSettings={() => openSettings("general")}
          onShortcuts={() => setOverlay({ kind: "shortcuts" })}
          onApps={() => setOverlay({ kind: "apps" })}
          onAbout={() => openSettings("updates")}
          onGuide={() => {
            const r = document.querySelector("[data-testid=guide]")?.getBoundingClientRect();
            setOverlay({ kind: "menu", id: "guide", at: { x: r ? r.left : 8, y: r ? r.bottom + 4 : 48 }, items: guideItems(), label: "Guide" });
          }}
          onReplay={() => firstRun.open(0)}
          onAddPerson={() => openSettings("people")}
          onLock={() => openSettings("permissions")}
          updateTo={update?.latest && update.latest !== branchVersion && !remindedToday(update.latest) ? update.latest : null}
          onUpdate={() => {
            const r = document.querySelector("[data-testid=sb-version]")?.getBoundingClientRect();
            const above = r && r.width ? { left: r.left, right: r.right, top: r.top, align: "right" as const } : { left: 8, right: 8, top: innerHeight - 40, align: "left" as const };
            setOverlay({ kind: "status", item: "version", above });
          }}
        />
      ) : null}
      {overlay?.kind === "palette" ? (
        <Palette
          request={request}
          rowName={rowName}
          onOpenMessage={openSearchMessage}
          onClose={() => setOverlay(null)}
          rows={paletteRows({
            conversations: [...contacts.map(contactRow), ...lists.rows.filter((r) => !r.isMain && !r.archived)],
            trunks: trunks.list,
            trunkName,
            newConversation: () => void startNew(),
            newTrunk: () => void newTrunk(),
            toggleTheme: () => setTheme(toggleTheme(theme)),
            focusMode: () => setLayout({ focus: true }),
            shortcuts: () => setOverlay({ kind: "shortcuts" }),
            setup: () => firstRun.open(0),
            tour: () => setGuide("tour"),
            quickAsk: () => setOverlay({ kind: "ask" }),
            openConversation,
            openPlace,
            openSettings,
            toggleLockdown: lockdown.supported ? toggleLockdown : undefined,
            lockdownOn: lockdown.on,
          })}
        />
      ) : null}
      {overlay?.kind === "ask" ? (
        <QuickAsk
          trunks={trunks.list}
          defaultId={trunks.defaultId}
          onClose={() => setOverlay(null)}
          onSend={(text, agentId) => {
            void actions.create(agentId).then((key) => {
              if (key) {
                openConversation(key);
                void session.open(key).then(() => session.send(text));
              }
            });
          }}
        />
      ) : null}
      {overlay?.kind === "studio" ? <TrunkStudio engine={session.engine} onClose={() => setOverlay(null)} openTrunk={openTrunkProfile} /> : null}
      {lockdown.confirmation}
      {newTrunkRoster ? <NewTrunkPreview roster={newTrunkRoster} busy={makingTrunk} onClose={() => setNewTrunkRoster(null)} onConfirm={(choice) => void confirmNewTrunk(choice)} /> : null}
      {overlay?.kind === "shortcuts" ? <ShortcutsDialog defaultName={defaultName} onClose={() => setOverlay(null)} /> : null}
      {overlay?.kind === "cando" ? <CanDoDialog onClose={() => setOverlay(null)} onGo={(g) => {
        setOverlay(g.kind === "pair" ? { kind: "pair" } : null);
        if (g.kind === "place") openPlace(g.place);
        else if (g.kind === "settings") openSettings(g.page);
        else if (g.kind === "ask" && s.mainKey) { window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: { sessionKey: s.mainKey, text: g.text } })); openConversation(s.mainKey); void session.open(s.mainKey); }
      }} /> : null}
      {overlay?.kind === "apps" ? <GetAppsDialog onClose={() => setOverlay(null)} onPair={() => setOverlay({ kind: "pair" })} /> : null}
      {overlay?.kind === "pair" ? <PairDialog engine={session.engine} close={() => setOverlay(null)} /> : null}
      {newProject ? <NewProjectDialog session={session} onDone={projects.reload} onClose={() => setNewProject(false)} /> : null}
      {keeping ? <KeepLastDialog onCancel={() => setKeeping(null)} onKeep={() => (setKeeping(null), void tidy({ session, list }, keeping, true))} /> : null}
      {deletingMany && deletingMany.length ? (
        <ConfirmDelete
          row={deletingMany[0]}
          count={deletingMany.length}
          onCancel={() => setDeletingMany(null)}
          onDelete={() => {
            const rows = deletingMany;
            setDeletingMany(null);
            void actions.removeMany(rows).then(selection.clear);
          }}
        />
      ) : null}
      {reading && !reading.remove ? (
        <ReadOnlyThread
          request={request}
          thread={reading.thread}
          label={reading.label}
          onClose={() => setReading(null)}
          onBringIn={() => {
            const t = reading.thread;
            setReading(null);
            void catalogs.bringIn(t).then((key) => key && openConversation(key));
          }}
        />
      ) : null}
      {reading?.remove ? (
        <ConfirmCatalogDelete
          name={reading.thread.name}
          onCancel={() => setReading(null)}
          onDelete={() => {
            const t = reading.thread;
            setReading(null);
            void catalogs.remove(t);
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDelete
          row={deleting}
          onCancel={() => setDeleting(null)}
          onDelete={() => {
            const row = deleting;
            setDeleting(null);
            void actions.remove(row);
          }}
        />
      ) : null}
      {removingTrunk ? <RemoveTrunkDialog engine={session.engine} agentId={removingTrunk.agentId} name={removingTrunk.name} onClose={() => setRemovingTrunk(null)} /> : null}
      {route.kind === "chat" && characterShown && !pet.roam ? (
        <LiveCharacter name={trunkName(openRow?.agentId)} state={faceNow} onClose={() => setCharacterVisible(false)} onShow={() => setCharacterVisible(true)} onOpenTrunk={() => openTrunkProfile(openRow?.agentId)} onChangePet={() => openSettings("appearance")} others={room.others} column={conversationColumn} />
      ) : null}
      <NewGroupChatHost engine={ready ? session.engine : undefined} onOpen={openConversation} />
      {guide === "tour" ? <Walkthrough defaultName={defaultName} onClose={() => setGuide(null)} /> : null}
      {guide === "news" || guide === "news-ready" ? (
        <WhatsNew
          version={branchVersion}
          update={update}
          desktopInstall={Boolean(componentDesktop(session.gatewayUrl)?.componentUpdates)}
          computerName={machine?.name ?? ""}
          startOnReady={guide === "news-ready"}
          installed={installedRows({ setup: () => firstRun.open(0), shortcuts: () => setOverlay({ kind: "shortcuts" }), palette: () => setOverlay({ kind: "palette" }), settings: openSettings })}
          onOpenUpdates={() => openSettings("updates")}
          onInstall={() => void stageWindowUpdate(session.engine).catch((e: unknown) => notify(`Couldn't install the update: ${e instanceof Error ? e.message : String(e)}`, { tone: "bad" }))}
          onClose={() => setGuide(null)}
        />
      ) : null}
      {!dedicated && firstRun.step !== null && ready && trunks.loaded ? (
        <SetupFlow
          engine={session.engine}
          version={branchVersion}
          trunkNames={trunks.list.map((t) => t.name)}
          defaultAgentId={trunks.defaultId}
          defaultName={defaultName}
          startAt={firstRun.step ?? 0}
          requireContact={firstRun.requiresContact}
          onContactCreated={firstRun.contactCreated}
          onTalk={(handle) => {
            setSetupTalk(handle);
            if (handle && s.mainKey) { openConversation(s.mainKey); void session.open(s.mainKey); }
          }}
          onClose={(finished) => {
            setSetupTalk(null);
            firstRun.close();
            if (finished) {
              setTimeout(() => setGuide("tour"), 700); // the walkthrough starts 700 ms after setup (§4.8.1.11 rule 3)
            }
          }}
          onLocalModel={() => {
            firstRun.leaveForLocalModel();
            openSettings("local");
          }}
        />
      ) : null}
      {route.kind === "chat" ? conversationMenu.node : null}
      {groupDrop ? <GroupDropPopover key={`${groupDrop.kind}:${groupDrop.source}:${groupDrop.target ?? groupDrop.roomId ?? ""}`} drop={groupDrop} contacts={contacts} rooms={groupRooms.rooms} defaultTrunk={trunks.defaultId ?? ""} session={session} onClose={() => setGroupDrop(null)} onPick={setGroupDrop} onOpen={(key) => { void groupRooms.reload(); openConversation(key); }} /> : null}
      <BannerView onOpen={openConversation} setupOpen={firstRun.step !== null && ready && trunks.loaded} />
      <Toasts setupOpen={firstRun.step !== null && ready && trunks.loaded} />
    </div>
    </TrunkEmojiFaces.Provider>
    </TrunkPebbleLooks.Provider>
    </TrunkAppearances.Provider>
  );
}

/** The thread alone, or the thread as the first of several panes with a divider (§4.2.6 Split view). */
function SplitFrame({ panes, width, onWidth, side, children }: { panes: Pane[]; width: number; onWidth: (w: number) => void; side: ReactNode; children: ReactNode }) {
  if (!panes.length) return <>{children}</>;
  return (
    <div className="split" style={{ ["--mainw" as string]: `${width}%` }}>
      <div className="split-main">{children}</div>
      <PaneDivider width={width} onWidth={onWidth} />
      {side}
    </div>
  );
}
