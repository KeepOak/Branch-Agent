import { useRef, useState, type DOMAttributes } from "react";
import { notify } from "./notify";
import { dragResult, SIDE_DEFAULT, type Layout } from "./use-layout";

type Props = { layout: Layout; onLayout: (patch: Partial<Layout>) => void; onLive: (width: number | null) => void };
type HandleProps = { width: number; dragging: boolean } & Pick<DOMAttributes<HTMLDivElement>,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture" | "onDoubleClick">;

function ResizeHandle({ width, dragging, ...events }: HandleProps) {
  return (
    <div
      className={dragging ? "resizer on" : "resizer"}
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to resize · below 200 pixels becomes the face rail · drag to the edge to hide · double-click to reset"
      title="Drag to resize · below 200 pixels becomes the face rail · drag to the edge to hide · double-click to reset"
      data-testid="side-resizer"
      style={{ left: `calc(${width}px - 4px)`, cursor: "col-resize" }}
      {...events}
    >
      <i className="grip" aria-hidden="true" />
    </div>
  );
}

/** Drag resizes, makes the rail or hides the list; double-click restores the usual width. */
export function SideResizer({ layout, onLayout, onLive }: Props) {
  const [dragging, setDragging] = useState(false);
  const activeDrag = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const width = layout.rail ? 68 : layout.sideW;
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    startW.current = width;
    activeDrag.current = true;
    setDragging(true);
  };
  const widthAt = (e: React.PointerEvent) => startW.current + (e.clientX - startX.current);
  const cancel = () => {
    activeDrag.current = false;
    setDragging(false);
    onLive(null);
  };
  return <ResizeHandle width={width} dragging={dragging} onPointerDown={onPointerDown}
    onPointerMove={(e) => {
      if (activeDrag.current) onLive(Math.max(0, widthAt(e)));
    }}
    onPointerUp={(e) => {
      if (!activeDrag.current) return;
      cancel();
      onLayout(dragResult(widthAt(e)));
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
    onDoubleClick={() => {
      onLayout({ sideW: SIDE_DEFAULT, rail: false });
      notify("Back to the usual size.");
    }} />;
}
