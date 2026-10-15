// The later-update rows of one section (rows whose control waits for a later update), folded into one quiet line at
// Advanced: "N more come in a later update". The line opens them. Regular never shows these rows (rows.ts hides them),
// so the fold only appears where the rows would otherwise sit under live controls.
import { useState, type ReactNode } from "react";

export function laterLine(count: number): string {
  return `${count} more ${count === 1 ? "comes" : "come"} in a later update`;
}

export function LaterRows({ count, label, children }: { count: number; label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="r1s-later g-clear" data-later-rows={count}>
      <button type="button" className="r1s-later-btn g-label" data-local="" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {label ?? laterLine(count)}
      </button>
      {/* The rows stay mounted and read as hidden until the line opens them. */}
      <div hidden={!open}>{children}</div>
    </div>
  );
}
