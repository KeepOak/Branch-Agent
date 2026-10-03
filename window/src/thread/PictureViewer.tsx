// The picture viewer (DESIGN-SPEC §4.2.6 Parity adds "Picture viewer", "Picture viewer keys"): a dark scrim,
// the picture centred, and a toolbar. + and − zoom, 0 resets, Left and Right move, Escape closes.
import { useEffect, useState } from "react";
import { useThread } from "./context";
import { Icon, ICONS } from "./icons";
import type { Attachment } from "./model";

const STEP = 1.25;

async function copyPicture(src: string): Promise<void> {
  const blob = await (await fetch(src)).blob();
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

function useKeys(handlers: Record<string, () => void>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const run = handlers[e.key];
      if (run) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}

export function PictureViewer({ items, start, onClose }: { items: Attachment[]; start: number; onClose: () => void }) {
  const { toast } = useThread();
  const [at, setAt] = useState(start);
  const [zoom, setZoom] = useState(1);
  const item = items[at];
  const go = (d: number) => {
    setAt((i) => (i + d + items.length) % items.length);
    setZoom(1);
  };
  useKeys({ Escape: onClose, ArrowLeft: () => go(-1), ArrowRight: () => go(1), "+": () => setZoom((z) => z * STEP), "=": () => setZoom((z) => z * STEP), "-": () => setZoom((z) => z / STEP), "0": () => setZoom(1) });
  if (!item?.src) return null;
  const copy = () =>
    copyPicture(item.src ?? "").then(
      () => toast("Copied."),
      () => toast("Couldn't copy this picture. Check clipboard access and try again."), // fakes-ok: words of DESIGN-SPEC on main, §4.2.6 Picture viewer (this worktree's copy is older)
    );
  const tool = (label: string, d: string, run: () => void) => (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={run}>
      <Icon d={d} size={16} />
    </button>
  );
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={item.name} data-testid="picture-viewer">
      <div className="viewer-bar">
        {items.length > 1 ? tool("Previous picture", "M15 6l-6 6 6 6", () => go(-1)) : null}
        {items.length > 1 ? <span className="viewer-count">{`${at + 1} / ${items.length}`}</span> : null}
        {items.length > 1 ? tool("Next picture", ICONS.chev, () => go(1)) : null}
        {tool("Zoom out", "M5 12h14", () => setZoom((z) => z / STEP))}
        <button type="button" className="viewer-zoom" onClick={() => setZoom(1)}>{`${Math.round(zoom * 100)}%`}</button>
        {tool("Zoom in", "M12 5v14M5 12h14", () => setZoom((z) => z * STEP))}
        {tool("Open in your browser", "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6", () => window.open(item.src, "_blank", "noopener"))}
        {tool("Copy picture", ICONS.copy, () => void copy())}
        <a className="icon-btn" href={item.src} download={item.name} aria-label="Save picture" title="Save picture">
          <Icon d={ICONS.down} size={16} />
        </a>
        {tool("Close", ICONS.x, onClose)}
      </div>
      <div className="viewer-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <img src={item.src} alt={item.name} style={{ transform: `scale(${zoom})` }} onDoubleClick={() => setZoom((z) => (z === 1 ? 2 : 1))} />
      </div>
    </div>
  );
}
