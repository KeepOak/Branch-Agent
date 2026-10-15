// Talk beside in the R1 window (parity row 20). The Classic pane (shell/TalkBeside.tsx) is re-hosted unchanged: the
// default Trunk's main conversation beside a place, sending with the page as work context, docked at the right or the
// bottom, resizable, with Open it full size. As in Classic it shows on places only; Ctrl Shift H (the person's
// talkBeside key) and the header's Talk button open and close it. It reads chat.history and sends with chat.send.
import { useEffect } from "react";
import type { CapsuleItem } from "../../glass/Capsule";
import { Icon } from "../../shell/icons";
import { TalkBeside, useTalkLayout } from "../../shell/TalkBeside";
import { shortcutFor } from "../../shell/use-shortcuts";
import { currentKeys, keyActions, readCustomKeys } from "../../shell/keymap";
import "../../shell/talk-beside.css";
import "./talk.css";

export const TALK_NEED = ["chat.history", "chat.send"] as const;

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;
type OnEvent = (listener: (event: string, payload: unknown) => void) => () => void;
type Args = {
  /** Talk beside shows on places only (Classic: route.kind === "place"). */
  shown: boolean;
  request: Request;
  onEvent: OnEvent;
  /** The default Trunk's main conversation. */
  mainKey: string | null;
  name: string;
  /** The page's title, sent as work context. */
  page: string;
  /** Opens the main conversation full size. */
  onFull: (key: string) => void;
};

/** The header button and the pane for the Frame's beside slot. */
export function useTalkBeside({ shown, request, onEvent, mainKey, name, page, onFull }: Args): { item: CapsuleItem | null; beside: { node: React.ReactNode; dock: "right" | "bottom"; size: number } | undefined } {
  const [layout, setLayout] = useTalkLayout();
  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("[data-listening], [aria-modal=\"true\"]")) return;
      if (shortcutFor(event, /Mac|iPhone|iPad/.test(navigator.platform), currentKeys(keyActions(name), readCustomKeys())) !== "talkBeside") return;
      event.preventDefault();
      setLayout({ open: !layout.open });
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [shown, layout.open, setLayout, name]);
  if (!shown) return { item: null, beside: undefined };
  const item: CapsuleItem = { label: `Talk to ${name}`, icon: <Icon name="chat" />, need: [...TALK_NEED], coming: "This engine can’t talk beside a page.", onClick: () => setLayout({ open: !layout.open }) };
  const beside = layout.open ? {
    dock: layout.dock, size: layout.dock === "right" ? layout.w : layout.h,
    node: <TalkBeside clear request={request} onEvent={onEvent} sessionKey={mainKey} name={name} page={page} layout={layout} onLayout={setLayout}
      onFull={() => { setLayout({ open: false }); if (mainKey) onFull(mainKey); }} />,
  } : undefined;
  return { item, beside };
}
