import type { ReactNode } from "react";
import type { WindowEngine } from "../connect/engine";
import { Coming } from "./coming";

/** One capsule button. With `need` it names the engine call it makes (R1-10): an engine without it, or an item this window
 *  hasn't wired yet (no onClick, or `unwired`), draws it through <Coming> with `coming` as the reason. Without `need` the
 *  button stays in this window (back, forward, a menu) and says data-local. With `pressed` the button is a toggle and
 *  says aria-pressed; without it no aria-pressed is drawn. */
export type CapsuleItem = { icon: ReactNode; label: string; onClick?: () => void; disabled?: boolean; coming?: string; badge?: ReactNode; need?: string | readonly string[]; unwired?: boolean; pressed?: boolean };
export function Capsule({ items, size = 36, label, className = "", engine }: { items: CapsuleItem[]; size?: 36 | 32; label: string; className?: string; engine?: Pick<WindowEngine, "features"> | null }) {
  return <div className={`g-frost g-capsule ${className}`} role="group" aria-label={label} data-size={size}>
    {items.map(item => {
      const inner = <>{item.icon}{item.badge && <span className="g-capsule-badge">{item.badge}</span>}</>;
      if (!item.need) return <button type="button" key={item.label} data-local="" aria-label={item.coming ? `${item.label} · Coming` : item.label} title={item.coming ? `Coming · ${item.coming}` : item.label} aria-pressed={item.pressed} disabled={item.disabled || Boolean(item.coming) || !item.onClick} onClick={item.onClick}>{inner}</button>;
      const unwired = item.unwired || !item.onClick;
      return <Coming key={item.label} engine={engine} need={item.need} unwired={unwired} reason={item.coming} where={item.label}>
        <button type="button" aria-label={unwired ? `${item.label} · Coming` : item.label} title={item.label} aria-pressed={item.pressed} disabled={item.disabled} onClick={item.onClick}>{inner}</button>
      </Coming>;
    })}
  </div>;
}
