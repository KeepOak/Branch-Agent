// The header's ⋯ conversation menu and what its rows open (DESIGN-SPEC §4.2.7): the rows come from
// conversation-menu.ts; this hook runs them against the engine and keeps the menu, popover and dialogs.
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { describePlacement, listComputers, placementComputer, type Computer, type Placement } from "../stage/computers";
import { ComputerPicker } from "../stage/ComputerPicker";
import { ReplayDialog } from "./Replay";
import type { Conversation } from "../connect/conversations";
import type { SaplingSession } from "../connect/session";
import type { PlaceId } from "../places-nav/routes";
import { copyText, ThreadContext } from "../thread/context";
import { LookInside } from "../thread/dialogs";
import { turnOf } from "../thread/layout";
import { railTicks } from "../thread/Rail";
import type { Block } from "../thread/model";
import type { TranscriptExportFormat } from "../transcript-export/render";
import { ExportDialog } from "../transcript-export/ExportDialog";
import { MapDialog, StartOverDialog } from "./ConversationDialogs";
import { RemoveTrunkDialog } from "../places/trunk/RemoveTrunk";
import { conversationMenuItems, type ConversationDetail, type ConversationMenuRun } from "./conversation-menu";
import type { Actions } from "./conversation-actions";
import type { Trunks } from "./engine-data";
import { Menu, type MenuAnchor, type MenuItem } from "./Menu";
import { notify } from "./notify";
import { ShareDialog } from "./ShareDialog";
import { whoItKnowsItems } from "./who-it-knows-menu";
import { roomMenuItems } from "../rooms/room-menu";
import "./conversation-menu.css";
import { conversationLink, openConversationWindow, ownWindowUnavailable } from "./own-window";
import type { TopicLayout } from "./topic-layout";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
const bad = (e: unknown) => notify(reason(e), { tone: "bad" });

export type ConversationMenuProps = {
  session: SaplingSession;
  url: string;
  ready: boolean;
  now: number;
  row: Conversation | null;
  isMain: boolean;
  title: string;
  trunk: { id?: string; name: string };
  trunks: Trunks;
  actions: Actions;
  history: Block[];
  onRename: () => void;
  onDelete: (row: Conversation) => void;
  openPlace: (place: PlaceId) => void;
  talkOff: string | null;
  onTalk: () => void;
  onSearch?: () => void;
  onSidePanel?: () => void;
  onTower?: () => void;
  towerVisible?: boolean;
  onList?: () => void;
  onComputer?: () => void;
  onBrowser?: () => void;
  onGuide?: () => void;
  onBackToContact?: () => void;
  onConversations?: () => void;
  hasContactReturn?: boolean;
  hasContactConversations?: boolean;
  threadView?: { contactName: string; layout: TopicLayout; set: (layout: TopicLayout) => void };
  /** The agent window is closed; the header face opens the profile now, so the menu brings the window back. */
  characterHidden: boolean;
  onShowCharacter: () => void;
  /** Side by side: pick the conversation beside (a list under the ⋯ button), or open an empty pane. */
  besideOpen: boolean;
  onBeside: (at: MenuAnchor) => void;
  onSplit: (dir: "right" | "down") => void;
  /** Add a computer and Computer & browser, from the Move picker. */
  onAddComputer: () => void;
  onManageComputers: () => void;
  /** A room (rooms/): its rule on the Room rules row, and the Room rules menu. */
  room?: { ruleWords: string | null; rules: () => MenuItem[]; members?: ReactNode[] } | null;
  ownWindowOpen?: boolean;
};

type Open =
  | { kind: "menu"; at: MenuAnchor }
  | { kind: "known"; at: MenuAnchor; items: MenuItem[] }
  | { kind: "start" | "map" | "share" | "removeTrunk" | "inspect" | "replay" }
  | { kind: "move"; at: MenuAnchor }
  | { kind: "rules"; at: MenuAnchor }
  | { kind: "export"; format: TranscriptExportFormat }
  | null;

export { conversationLink } from "./own-window";

/** The public link for a share token, on the engine's web address (session-url-contract public-share.ts). */
export function publicShareLink(token: string, gatewayUrl: string, controlUiUrl?: string): string {
  const url = new URL(controlUiUrl || gatewayUrl);
  url.protocol = url.protocol.replace(/^ws/, "http");
  const base = controlUiUrl ? url.pathname.replace(/\/+$/, "") : "";
  return new URL(`${base}/share/session?${new URLSearchParams({ token })}`, url.origin).toString();
}

export function readDetail(raw: unknown): ConversationDetail {
  const s = rec(rec(raw).session);
  const r = str(s.reasoningLevel);
  return { showThinking: r !== "off" };
}

/** `open` shows the ⋯ menu, the only conversation-header control. */
export function useConversationMenu(p: ConversationMenuProps): { open: (e: MouseEvent<HTMLElement>) => void; node: ReactNode; showThinking: boolean } {
  const [open, setOpen] = useState<Open>(null);
  const [, setBookmarkVersion] = useState(0);
  useEffect(() => {
    const update = () => setBookmarkVersion((v) => v + 1);
    window.addEventListener("branch:turn-bookmarks-changed", update);
    return () => window.removeEventListener("branch:turn-bookmarks-changed", update);
  }, []);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const key = p.session.getSnapshot().sessionKey;
  useEffect(() => {
    setDetail(null);
    if (!key || !p.ready) return;
    let active = true;
    p.session.request("sessions.describe", { key, ...(p.trunk.id ? { agentId: p.trunk.id } : {}) })
      .then((value) => { if (active) setDetail(readDetail(value)); }, () => undefined);
    return () => { active = false; };
  }, [key, p.ready, p.session, p.trunk.id]);
  const target = key ? { key, ...(p.trunk.id ? { agentId: p.trunk.id } : {}) } : null;
  const close = () => setOpen(null);

  const loadDetail = () => {
    if (!target) return;
    p.session.request("sessions.describe", target).then((r) => setDetail(readDetail(r)), () => setDetail(null));
  };
  const computers = useComputers(p, key);
  const run = useRun(p, { key, setOpen });
  const lastReply = [...p.history].reverse().find((b) => b.kind === "text");
  const items = conversationMenuItems({
    row: p.row,
    isMain: p.isMain,
    trunkName: p.trunk.name,
    ownTrunk: Boolean(p.trunk.id && p.trunk.id !== p.trunks.defaultId),
    canRemoveTrunk: p.trunks.list.length > 1,
    online: p.ready,
    now: p.now,
    hasReply: Boolean(lastReply),
    talkOff: p.talkOff,
    characterHidden: p.characterHidden,
    besideOpen: p.besideOpen,
    canMove: computers.list.length > 1,
    ownWindowOpen: p.ownWindowOpen,
    ownWindowOff: ownWindowUnavailable(),
    hasContactReturn: p.hasContactReturn,
    hasContactConversations: p.hasContactConversations,
    threadView: p.threadView,
    towerVisible: p.towerVisible,
    room: p.room ? [...roomMenuItems({ ruleWords: p.room.ruleWords, canLeave: Boolean(p.row && !p.isMain), run: { rename: run.rename, rules: () => setOpen({ kind: "rules", at: menuAnchor() }), leave: run.archive, remove: run.remove } }),
      ...(p.room.members?.length ? [{ kind: "sub" as const, label: `Members · ${p.room.members.length}`, items: [{ kind: "head" as const, label: "Members" }, ...p.room.members.map((member) => ({ kind: "custom" as const, node: <div className="mi">{member}</div> }))] }] : [])] : null,
    run,
  });
  let bookmarked: string[] = [];
  try { if (key) bookmarked = JSON.parse(localStorage.getItem(`branch:turn-bookmarks:${key}`) ?? "[]") as string[]; } catch { /* storage unavailable */ }
  const ticks = useMemo(() => railTicks(p.history), [p.history]);
  const bookmarkedTicks = ticks.filter((tick) => bookmarked.includes(tick.key));
  if (bookmarkedTicks.length && key) items.unshift({
    kind: "sub", label: "Bookmarks", items: [
      { kind: "head", label: "Bookmarks" },
      ...bookmarkedTicks.map((tick): MenuItem => ({ label: tick.title.slice(0, 48), run: () => {
        close();
        window.dispatchEvent(new CustomEvent("branch:turn-jump", { detail: { sessionKey: key, blockKey: tick.key } }));
      } })),
    ],
  });
  const show = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    loadDetail();
    setOpen((cur) => (cur ? null : { kind: "menu", at: { x: r.right - 260, y: r.bottom + 4 } }));
  };
  return { open: show, showThinking: detail?.showThinking ?? true, node: <Overlays p={p} open={open} items={items} close={close} target={target} lastReply={lastReply} computers={computers} /> };
}

/** Under the header's ⋯ button, for what a menu row opens. */
function menuAnchor(): MenuAnchor {
  const r = document.querySelector<HTMLElement>("[data-testid=conversation-menu-button]")?.getBoundingClientRect();
  return { x: (r?.right ?? 300) - 300, y: (r?.bottom ?? 50) + 4 };
}

type RunCtx = { key: string | null; setOpen: (o: Open) => void };

function useRun(p: ConversationMenuProps, c: RunCtx): ConversationMenuRun {
  const { key, setOpen } = c;
  const row = p.row;
  const copy = (text: string) => void copyText(text, notify);
  const req = (method: string, params: unknown) => p.session.request(method, params);
  const menuAt = menuAnchor;
  return {
    beside: () => p.onBeside(menuAt()),
    split: p.onSplit,
    move: () => setOpen({ kind: "move", at: menuAt() }),
    replay: () => setOpen({ kind: "replay" }),
    share: () => setOpen({ kind: "share" }),
    whoItKnows: () => void whoItKnows(p, setOpen),
    reload: () => void p.session.reload(),
    toBoard: () => key && void req("canopy.cards.captureSession", { sessionKey: key, title: p.title, ...(p.trunk.id ? { agentId: p.trunk.id } : {}) }).then(() => notify(`Sent “${p.title}” to the board.`), bad),
    archive: () => row && void p.actions.archive(row),
    restore: () => row && void p.actions.restore(row),
    snooze: (until) => row && void p.actions.snooze(row, until),
    copyLink: () => key && copy(conversationLink(key)),
    ownWindow: () => key && void openConversationWindow(key).catch(bad),
    pin: () => row && void p.actions.pin(row),
    rename: p.onRename,
    profile: () => openTrunk(p, "profile"),
    editTrunk: () => openTrunk(p, "edit"),
    talk: p.onTalk,
    showCharacter: p.onShowCharacter,
    lookInside: () => setOpen({ kind: "inspect" }),
    startOver: () => setOpen({ kind: "start" }),
    exportConversation: () => setOpen({ kind: "export", format: "markdown" }),
    map: () => setOpen({ kind: "map" }),
    exportWebPage: () => setOpen({ kind: "export", format: "html" }),
    remove: () => row && p.onDelete(row),
    removeTrunk: () => setOpen({ kind: "removeTrunk" }),
    search: () => p.onSearch?.(),
    sidePanel: () => p.onSidePanel?.(),
    tower: () => p.onTower?.(),
    list: () => p.onList?.(),
    computer: () => p.onComputer?.(),
    browser: () => p.onBrowser?.(),
    guide: () => p.onGuide?.(),
    backToContact: () => p.onBackToContact?.(),
    conversations: () => p.onConversations?.(),
  };
}

/** Opens People on this Trunk; the profile and editor screens listen for `branch:open-trunk`. */
function openTrunk(p: ConversationMenuProps, view: "profile" | "edit") {
  p.openPlace("people");
  window.dispatchEvent(new CustomEvent("branch:open-trunk", { detail: { agentId: p.trunk.id ?? p.trunks.defaultId, view } }));
}

/** Who it knows: the Trunks this one may talk to under tools.agentToAgent, opened from the ⋯ menu. */
async function whoItKnows(p: ConversationMenuProps, setOpen: (o: Open) => void, from?: DOMRect) {
  const self = p.trunk.id ?? p.trunks.defaultId ?? "";
  const anchor = from ?? document.querySelector<HTMLElement>("[data-testid=conversation-menu-button]")?.getBoundingClientRect();
  try {
    const items = await whoItKnowsItems((method, params) => p.session.request(method, params), { id: self, name: p.trunk.name }, p.trunks.list);
    setOpen({ kind: "known", at: { x: (anchor?.right ?? 360) - 340, y: (anchor?.bottom ?? 50) + 4 }, items });
  } catch (e) {
    bad(e);
  }
}

/** The computers this conversation could move to (environments.list) and where it is now (sessions.describe). */
function useComputers(p: ConversationMenuProps, key: string | null) {
  const [state, setState] = useState<{ list: Computer[]; profiles: { id: string; name: string }[]; placement?: Placement; tick: number }>({ list: [], profiles: [], tick: 0 });
  useEffect(() => {
    if (!p.ready || !key) return;
    let live = true;
    Promise.allSettled([listComputers(p.session.engine), describePlacement(p.session.engine)]).then(([c, pl]) => {
      if (!live) return;
      setState((cur) => ({
        tick: cur.tick,
        list: c.status === "fulfilled" ? c.value.computers : [],
        profiles: c.status === "fulfilled" ? c.value.profiles : [],
        placement: pl.status === "fulfilled" ? pl.value : undefined,
      }));
    });
    return () => {
      live = false;
    };
  }, [p.ready, p.session, key, state.tick]);
  return { ...state, reload: () => setState((cur) => ({ ...cur, tick: cur.tick + 1 })) };
}

type OverlayProps = { p: ConversationMenuProps; open: Open; items: MenuItem[]; close: () => void; target: { key: string; agentId?: string } | null; lastReply: Block | undefined; computers: ReturnType<typeof useComputers> };

function Overlays({ p, open, items, close, target, lastReply, computers }: OverlayProps) {
  if (!open) return null;
  if (open.kind === "menu") return <Menu at={open.at} items={items} label="Conversation" testid="conversation-menu" onClose={close} />;
  if (open.kind === "known") return <Menu at={open.at} items={open.items} label="Who it knows" testid="who-it-knows" onClose={close} />;
  if (open.kind === "rules") return p.room ? <Menu at={open.at} items={p.room.rules()} label="Group rules" testid="room-rules" onClose={close} /> : null;
  if (!target) return null;
  const engine = p.session.engine;
  const copy = (text: string) => void copyText(text, notify);
  switch (open.kind) {
    case "start":
      return <StartOverDialog trunkName={p.trunk.name} onClose={close} onStart={() => p.session.request("sessions.reset", { ...target, reason: "reset" }).then(() => p.session.reload())} />;
    case "removeTrunk":
      return p.trunk.id ? <RemoveTrunkDialog engine={engine} agentId={p.trunk.id} name={p.trunk.name} onClose={close} /> : null;
    case "map":
      return <MapDialog engine={engine} sessionKey={target.key} agentId={target.agentId} onSwitched={() => void p.session.reload()} onClose={close} />;
    case "share": {
      const hello = p.session.getSnapshot().status;
      const controlUiUrl = hello.phase === "connected" ? str(rec(hello.hello).controlUiUrl) : "";
      return <ShareDialog engine={engine} sessionKey={target.key} agentId={target.agentId} sessionId={p.row?.sessionId} title={p.title} publicLink={(t) => publicShareLink(t, p.url, controlUiUrl)} onCopy={copy} onClose={close} />;
    }
    case "export":
      return <ExportDialog engine={engine} sessionKey={target.key} title={p.title} initialFormat={open.format} onClose={close} />;
    case "inspect":
      return <InspectLast p={p} block={lastReply} onClose={close} />;
    case "replay":
      return <ReplayDialog history={p.history} trunkName={p.trunk.name} onClose={close} />;
    case "move":
      return (
        <ComputerPicker at={open.at} engine={engine} name={p.trunk.name} computers={computers.list} profiles={computers.profiles} placement={computers.placement}
          current={placementComputer(computers.placement) ?? "gateway"} onClose={close} onAdd={() => (close(), p.onAddComputer())} onManage={() => (close(), p.onManageComputers())}
          onMoved={computers.reload} />
      );
  }
}

function InspectLast({ p, block, onClose }: { p: ConversationMenuProps; block: Block | undefined; onClose: () => void }) {
  if (!block || block.kind !== "text") return null;
  const turn = turnOf(p.history, p.history.indexOf(block));
  const done = turn.find((b): b is Extract<Block, { kind: "done" }> => b.kind === "done");
  const ctx = { engine: p.session.engine, sessionKey: target(p), name: p.trunk.name, toast: (t: string) => notify(t), running: false };
  return (
    <ThreadContext.Provider value={ctx}>
      <LookInside inspect={{ meta: block.meta, durationMs: done?.durationMs, steps: turn.filter((b) => b.kind === "step" || b.kind === "approval").length }} onClose={onClose} />
    </ThreadContext.Provider>
  );
}

const target = (p: ConversationMenuProps) => p.session.getSnapshot().sessionKey;
