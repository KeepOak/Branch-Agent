import type { ReactNode, RefObject } from "react";
export function GlassPill({ face, title, onOpen, tight, variant = "chat", buttonRef, coming }: {
  face: ReactNode; title: string; onOpen?: () => void; tight?: boolean; variant?: "chat" | "room" | "person" | "exchange"; buttonRef?: RefObject<HTMLButtonElement | null>; coming?: string;
}) {
  return <button type="button" ref={buttonRef} className="g-frost g-pill" data-tight={tight || undefined} data-variant={variant} onClick={onOpen} disabled={!onOpen || Boolean(coming)} aria-label={coming ? `${title} · Coming` : title} title={coming ? `Coming · ${coming}` : title} aria-haspopup="dialog">
    <span className="g-pill-face">{face}</span><span className="g-pill-title">{title}</span>
  </button>;
}
