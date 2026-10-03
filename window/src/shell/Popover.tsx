import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MenuAnchor } from "./Menu";

// A glass popover that holds controls rather than menu rows (DESIGN-SPEC §5.4 surface). Escape and a click
// outside close it; focus returns to what opened it.
/** `above`: the rectangle of a status-bar item; the popover opens above it, left- or right-aligned to it (§4.9.1 rule 6). */
export type Above = { left: number; right: number; top: number; align: "left" | "right" };
type Props = { at: MenuAnchor; onClose: () => void; label: string; children: ReactNode; testid?: string; width?: number; above?: Above; className?: string };

export function Popover({ at, onClose, label, children, testid, width, above, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      const x = above ? (above.align === "right" ? above.right - r.width : above.left) : at.x;
      const y = above ? above.top - r.height - 6 : at.y;
      setPos({ x: Math.max(8, Math.min(x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
    }
  }, [at, above]);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const trigger = back && back !== document.body ? back : null;
    ref.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    const away = (e: PointerEvent) => {
      // A flyout opened from inside the popover (Filter and sort's choices) counts as inside.
      const inFly = Boolean((e.target as Element).closest?.(".pop.fly"));
      if (!ref.current?.contains(e.target as Node) && !trigger?.contains(e.target as Node) && !inFly) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", away, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      // Focus returns to the opener unless what the menu ran already moved it (for example a rename field).
      const now = document.activeElement;
      if (!now || now === document.body || ref.current?.contains(now)) {
        back?.focus?.();
      }
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className={`pop panel in17${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-label={label}
      data-testid={testid}
      style={{ left: pos.x, top: pos.y, ...(width ? { width } : {}) }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

/** A segmented control (§5.2) for short choices: Left and Right move the choice. */
export function Segmented<T extends string>({ label, value, options, onChange, testid }: { label: string; value: T; options: { id: T; name: string }[]; onChange: (v: T) => void; testid?: string }) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div
      className="seg"
      role="radiogroup"
      aria-label={label}
      data-testid={testid}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)`, ["--i" as string]: index, ["--n" as string]: options.length }}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (step) {
          e.preventDefault();
          onChange(options[(index + step + options.length) % options.length].id);
        }
      }}
    >
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} tabIndex={o.id === value ? 0 : -1} data-value={o.id} onClick={() => onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

/** A switch (§5.3): 38 × 22 track; the row's title is its label. */
export function Switch({ label, on, onChange, testid }: { label: string; on: boolean; onChange: (v: boolean) => void; testid?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" data-testid={testid} onClick={() => onChange(!on)} />;
}
