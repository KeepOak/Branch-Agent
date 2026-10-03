import { useRef, useState } from "react";
import { notify } from "./notify";
import { dragResult, SIDE_DEFAULT, type Layout } from "./use-layout";

type Props = { layout: Layout; onLayout: (patch: Partial<Layout>) => void; onLive: (width: number | null) => void };

/** The sidebar's right edge (DESIGN-SPEC §4.1.1 Resizer): drag to resize, to the rail, or to hide; double-click resets. */
export function SideResizer({ layout, onLayout, onLive }: Props) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const width = layout.hidden ? 0 : layout.rail ? 68 : layout.sideW;
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    startW.current = width;
    setDragging(true);
  };
  const widthAt = (e: React.PointerEvent) => startW.current + (e.clientX - startX.current);
  return (
    <div
      className={dragging ? "resizer on" : "resizer"}
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to resize · drag to the edge to hide · double-click to reset"
      title="Drag to resize · drag to the edge to hide · double-click to reset"
      data-testid="side-resizer"
      style={{ left: `calc(${width}px - 4px)`, cursor: "col-resize" }}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        if (dragging) {
          onLive(Math.max(0, widthAt(e)));
        }
      }}
      onPointerUp={(e) => {
        if (!dragging) {
          return;
        }
        setDragging(false);
        onLive(null);
        onLayout({ rail: false, hidden: false, ...dragResult(widthAt(e)) });
      }}
      onDoubleClick={() => {
        onLayout({ sideW: SIDE_DEFAULT, rail: false, hidden: false });
        notify("Back to the usual size.");
      }}
    >
      <i className="grip" aria-hidden="true" />
    </div>
  );
}
