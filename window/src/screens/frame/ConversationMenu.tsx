// The R1 header's ••• conversation menu and what its rows open. The rows are the approved nine (conversation-menu.ts); the
// dialogs are the Classic ones, re-hosted as clear glass (README item 48): Start over and Map (shell/ConversationDialogs.tsx),
// Replay (shell/Replay.tsx), Export (transcript-export/ExportDialog.tsx), Look inside (thread/dialogs.tsx) and Delete
// (shell/ConfirmDelete.tsx). Every row acts through the Classic conversation actions (shell/conversation-actions.ts).
import { useEffect, useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Conversation, ConversationList } from "../../connect/conversations";
import { CapabilityProvider } from "../../connect/capabilities";
import type { SaplingSession } from "../../connect/session";
import { Coming } from "../../glass/coming";
import { Menu } from "../../glass/Menu";
import { Popover } from "../../glass/Popover";
import type { PlaceId } from "../../places-nav/routes";
import { ConfirmDelete, askBeforeDelete } from "../../shell/ConfirmDelete";
import { conversationActions } from "../../shell/conversation-actions";
import { MapDialog, StartOverDialog } from "../../shell/ConversationDialogs";
import { Dialog } from "../../shell/Dialog";
import { notify } from "../../shell/notify";
import { openConversationWindow, ownWindowUnavailable } from "../../shell/own-window";
import { ReplayDialog } from "../../shell/Replay";
import { copyMarkdown } from "../../shell/row-actions";
import { ThreadContext } from "../../thread/context";
import { LookInside } from "../../thread/dialogs";
import { turnOf } from "../../thread/layout";
import type { Block } from "../../thread/model";
import { ExportDialog } from "../../transcript-export/ExportDialog";
import type { TranscriptExportFormat } from "../../transcript-export/render";
import type { WorkMode } from "../chat/chat-logic";
import { CONVERSATION_NEED, conversationMenu } from "./conversation-menu";

export type ConversationMenuProps = {
  session: SaplingSession;
  /** The ••• menu is open; dialogs a row opened stay up after it closes. */
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  sessionKey: string | null;
  /** The open conversation's list row; null before its first message. */
  row: Conversation | null;
  /** The default Trunk's own conversation (the window's main key). */
  isDefault: boolean;
  list: ConversationList;
  /** The conversation's name in the header: the Trunk's name in its own conversation. */
  name: string;
  history: Block[];
  work: { global: WorkMode; override: WorkMode | null; setOverride: (mode: WorkMode | null) => Promise<void> };
  /** Opens a conversation (after a delete, the default one). */
  onOpen: (key: string) => void;
  mainKey: string | null;
  onPlace: (place: PlaceId) => void;
};

type Open = { kind: "rename" | "delete" | "start" | "map" | "replay" | "inspect" } | { kind: "export"; format: TranscriptExportFormat } | null;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
const bad = (error: unknown) => notify(reason(error), { tone: "bad" });
/** The frame owns wide and rail (Ctrl+B); the menu asks it through its own toggle, as the sidebar does. */
const toggleList = () => document.querySelector<HTMLButtonElement>(".r1-side-top button")?.click();

function useNow(open: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (open) setNow(Date.now()); }, [open]);
  return now;
}

export function ConversationMenu(p: ConversationMenuProps) {
  const { session, sessionKey: key, row } = p;
  const engine = session.engine;
  const request = useMemo(() => <T,>(method: string, params?: unknown) => session.request<T>(method, params), [session]);
  const actions = useMemo(() => conversationActions(request, p.list, () => key), [request, p.list, key]);
  const [open, setOpen] = useState<Open>(null);
  const now = useNow(p.open);
  useEffect(() => { setOpen(null); }, [key]);
  const lastReply = [...p.history].reverse().find((block) => block.kind === "text");
  const target = key ? { key, ...(row?.agentId ? { agentId: row.agentId } : {}) } : null;
  const close = () => setOpen(null);
  const removeRow = (gone: Conversation) => void actions.remove(gone).then(() => { if (p.mainKey && p.mainKey !== gone.key) p.onOpen(p.mainKey); });
  const items = conversationMenu({
    row, isDefault: p.isDefault, now, hasReply: Boolean(lastReply), work: { global: p.work.global, override: p.work.override }, ownWindowOff: ownWindowUnavailable(),
    run: {
      pin: () => { if (row) void actions.pin(row); },
      rename: () => setOpen({ kind: "rename" }),
      editTrunk: () => p.onPlace("customize"),
      snooze: (until) => { if (row) void actions.snooze(row, until); },
      archive: () => { if (row) void actions.archive(row); },
      restore: () => { if (row) void actions.restore(row); },
      toBoard: () => { if (key) void request(CONVERSATION_NEED.board, { sessionKey: key, title: p.name, ...(row?.agentId ? { agentId: row.agentId } : {}) }).then(() => notify(`Sent “${p.name}” to the board.`), bad); },
      exportFile: () => setOpen({ kind: "export", format: "markdown" }),
      exportWebPage: () => setOpen({ kind: "export", format: "html" }),
      copyConversation: () => { if (key) void copyMarkdown(engine, key, p.name); },
      map: () => setOpen({ kind: "map" }),
      replay: () => setOpen({ kind: "replay" }),
      lookInside: () => setOpen({ kind: "inspect" }),
      workMode: (mode) => { void p.work.setOverride(mode).catch(bad); },
      list: toggleList,
      ownWindow: () => { if (key) void openConversationWindow(key).catch(bad); },
      startOver: () => setOpen({ kind: "start" }),
      remove: () => { if (!row) return; if (askBeforeDelete()) setOpen({ kind: "delete" }); else removeRow(row); },
    },
  });
  const dialog = !open || !target ? null
    : open.kind === "rename" && row ? <RenameDialog name={p.name} onClose={close} onSave={(label) => { close(); void actions.rename(row, label); }} />
    : open.kind === "delete" && row ? <ConfirmDelete clear row={row} onCancel={close} onDelete={() => { close(); removeRow(row); }} />
    : open.kind === "start" ? <StartOverDialog clear trunkName={p.name} onClose={close} onStart={() => request(CONVERSATION_NEED.reset, { ...target, reason: "reset" }).then(() => session.reload())} />
    : open.kind === "map" ? <MapDialog clear engine={engine} sessionKey={target.key} agentId={target.agentId} onSwitched={() => void session.reload()} onClose={close} />
    : open.kind === "replay" ? <ReplayDialog clear history={p.history} trunkName={p.name} onClose={close} />
    : open.kind === "export" ? <ExportDialog clear engine={engine} sessionKey={target.key} title={p.name} initialFormat={open.format} onClose={close} />
    : open.kind === "inspect" && lastReply?.kind === "text" ? <LastReply history={p.history} block={lastReply} name={p.name} sessionKey={target.key} session={session} onClose={close} />
    : null;
  // It draws outside the frame (the header's popover and window-wide dialogs), so it names the engine its Coming rows check.
  return <CapabilityProvider engine={engine}>
    {p.open ? <Popover anchor={p.anchor} label="Conversation" align="end" width={280} onClose={p.onClose}>
      <div className="r1c-conv g-clear"><Menu label="Conversation" rows={items} onClose={p.onClose} /></div>
    </Popover> : null}
    {dialog ? createPortal(dialog, document.body) : null}
  </CapabilityProvider>;
}

/** Look inside the last reply: the Classic dialog reads its turn's meta and the engine through the thread context. */
function LastReply({ history, block, name, sessionKey, session, onClose }: { history: Block[]; block: Extract<Block, { kind: "text" }>; name: string; sessionKey: string; session: SaplingSession; onClose: () => void }) {
  const turn = turnOf(history, history.indexOf(block));
  const done = turn.find((b): b is Extract<Block, { kind: "done" }> => b.kind === "done");
  const steps = turn.filter((b) => b.kind === "step" || b.kind === "approval").length;
  return <ThreadContext.Provider value={{ engine: session.engine, sessionKey, name, toast: (text) => notify(text), running: false }}>
    <LookInside clear inspect={{ meta: block.meta, durationMs: done?.durationMs, steps }} onClose={onClose} />
  </ThreadContext.Provider>;
}

function RenameDialog({ name, onClose, onSave }: { name: string; onClose: () => void; onSave: (label: string) => void }) {
  const [value, setValue] = useState(name);
  return <Dialog title={`Rename ${name}`} onClose={onClose} testid="rename" clear footer={<>
    <button type="button" className="btn ghost" data-local="" onClick={onClose}>Cancel</button>
    <Coming need={CONVERSATION_NEED.patch}><button type="button" className="btn" data-solid="" onClick={() => onSave(value)}>Rename</button></Coming>
  </>}>
    <input className="inp" data-local="" aria-label="Name" value={value} autoFocus onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSave(value); }} />
  </Dialog>;
}
