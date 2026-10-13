import type { ReactNode } from "react";

export type CapsuleItem = { icon: ReactNode; label: string; onClick?: () => void; disabled?: boolean; coming?: string; badge?: ReactNode };
export function Capsule({ items, size = 36, label, className = "" }: { items: CapsuleItem[]; size?: 36 | 32; label: string; className?: string }) {
  return <div className={`g-frost g-capsule ${className}`} role="group" aria-label={label} data-size={size}>
    {items.map(item => <button type="button" key={item.label} aria-label={item.coming ? `${item.label} · Coming` : item.label} title={item.coming ? `Coming · ${item.coming}` : item.label} disabled={item.disabled || Boolean(item.coming) || !item.onClick} onClick={item.onClick}>
      {item.icon}{item.badge && <span className="g-capsule-badge">{item.badge}</span>}
    </button>)}
  </div>;
}
