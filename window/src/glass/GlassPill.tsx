import type { ReactNode, RefObject } from "react";
import type { WindowEngine } from "../connect/engine";
import { Coming } from "./coming";

/** The header pill. With `need` (the calls its popover makes) it goes through <Coming>: an engine without them, or a pill
 *  with nothing to open, is Coming with `coming` as the reason (R1-10). Without `need` it opens something in this window. */
export function GlassPill({ face, title, onOpen, tight, variant = "chat", buttonRef, coming, need, engine }: {
  face: ReactNode; title: string; onOpen?: () => void; tight?: boolean; variant?: "chat" | "room" | "person" | "exchange"; buttonRef?: RefObject<HTMLButtonElement | null>; coming?: string;
  need?: string | readonly string[]; engine?: Pick<WindowEngine, "features"> | null;
}) {
  const inner = <><span className="g-pill-face">{face}</span><span className="g-pill-title">{title}</span></>;
  if (!need) return <button type="button" ref={buttonRef} className="g-frost g-pill" data-local="" data-tight={tight || undefined} data-variant={variant} onClick={onOpen} disabled={!onOpen || Boolean(coming)} aria-label={coming ? `${title} · Coming` : title} title={coming ? `Coming · ${coming}` : title} aria-haspopup="dialog">{inner}</button>;
  return <Coming engine={engine} need={need} unwired={!onOpen} reason={coming} where={`${title} pill`}>
    <button type="button" ref={buttonRef} className="g-frost g-pill" data-tight={tight || undefined} data-variant={variant} onClick={onOpen} aria-label={onOpen ? title : `${title} · Coming`} title={title} aria-haspopup="dialog">{inner}</button>
  </Coming>;
}
