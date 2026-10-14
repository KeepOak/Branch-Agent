// Quick ask in the R1 window (preview: Quick ask, a small box from anywhere into a new conversation). The Classic box
// (shell/QuickAsk.tsx) is re-hosted unchanged as item 48 clear glass. Ctrl Shift Space opens and closes it, as in
// Classic, and the sidebar's + menu row sends branch:quick-ask. Start makes a new conversation with the Trunk under To
// (sessions.create) and sends the question there (chat.send), as the Classic window does.
import { useEffect, useMemo, useState } from "react";
import type { ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { availability } from "../../connect/capabilities";
import { conversationActions } from "../../shell/conversation-actions";
import { useTrunks } from "../../shell/engine-data";
import { QuickAsk } from "../../shell/QuickAsk";
import { shortcutFor } from "../../shell/use-shortcuts";
import "../../shell/quick-ask.css";
import "./quickask.css";

export const QUICK_ASK_EVENT = "branch:quick-ask";
/** The calls Start makes. */
export const QUICK_ASK_NEED = ["sessions.create", "chat.send"] as const;
export const QUICK_ASK_COMING = "This engine can’t start a conversation from Quick ask.";

type Props = {
  session: SaplingSession;
  ready: boolean;
  list: ConversationList;
  /** Opens the new conversation in the window. */
  onOpen: (key: string) => void;
  /** A line for the window's notice. */
  onNotice: (text: string) => void;
};

export function QuickAskHost(props: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setOpen(shown => !shown);
    const key = (event: KeyboardEvent) => {
      // Another dialog or the shortcut recorder owns the keyboard. The open box is modal too, and the shortcut closes it.
      if (event.defaultPrevented || document.querySelector("[data-listening], [aria-modal=\"true\"]:not(.qa-box)")) return;
      if (shortcutFor(event, /Mac|iPhone|iPad/.test(navigator.platform)) !== "quickAsk") return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener(QUICK_ASK_EVENT, toggle);
    document.addEventListener("keydown", key);
    return () => { window.removeEventListener(QUICK_ASK_EVENT, toggle); document.removeEventListener("keydown", key); };
  }, []);
  return open ? <Open {...props} onClose={() => setOpen(false)} /> : null;
}

/** The open box: it reads the Trunks only while it shows. */
function Open({ session, ready, list, onOpen, onNotice, onClose: close }: Props & { onClose: () => void }) {
  const trunks = useTrunks(session, ready);
  const actions = useMemo(() => conversationActions(<T,>(method: string, params?: unknown) => session.request<T>(method, params), list, () => null), [session, list]);
  const missing = QUICK_ASK_NEED.some(method => availability(session.engine, method) === "no");
  return <QuickAsk clear trunks={trunks.list} defaultId={trunks.defaultId} onClose={close} onSend={(text, agentId) => {
    if (!ready || missing) { onNotice(`Coming · ${QUICK_ASK_COMING}`); return; }
    void actions.create(agentId).then(key => {
      if (!key) return;
      onOpen(key);
      void session.open(key).then(() => session.send(text));
    }, (e: unknown) => onNotice(`Couldn’t start the conversation: ${e instanceof Error ? e.message : String(e)}`));
  }} />;
}
