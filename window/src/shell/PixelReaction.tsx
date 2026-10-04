import { useEffect, useState } from "react";
import type { PetReaction } from "./pet-reaction";
import { pixelCells, PIXEL_REACTIONS, PIXEL_REST } from "./pet-pixel";

/** Exact preview pose maps: discrete steps, never a tween or idle loop. */
export function PixelReaction({ id, reaction, onRest }: { id: string; reaction: PetReaction; onRest: () => void }) {
  const [frame, setFrame] = useState(PIXEL_REST);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const frames = PIXEL_REACTIONS[reaction];
    const show = (index: number) => {
      if (!alive) return;
      if (!frames[index]) { onRest(); return; }
      setFrame(frames[index]); timer = setTimeout(() => show(index + 1), frames[index].ms);
    };
    show(0);
    return () => { alive = false; clearTimeout(timer); };
  }, [id, reaction]);
  return <svg viewBox="0 0 24 20" width="24" height="20" aria-hidden="true" shapeRendering="crispEdges"
    style={{ transform: `translateY(${-frame.lift}px)` }}>
    {pixelCells(id, frame).map((cell, index) => <rect key={index} x={cell.x} y={cell.y} width="2" height="2" fill={cell.colour} />)}
  </svg>;
}
