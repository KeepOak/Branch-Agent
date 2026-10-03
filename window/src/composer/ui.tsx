// Small parts the composer's menus share: segmented control (§5.2), switch (§5.3), menu item (§5.4).
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export type Seg = { id: string; label: string };

export function Segmented({ label, items, value, onPick, disabled, reason }: {
  label: string;
  items: readonly Seg[];
  value: string;
  onPick: (id: string) => void;
  disabled?: boolean;
  reason?: string;
}) {
  return (
    <div className="c-seg" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} title={reason}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={item.id === value}
          className={item.id === value ? "on" : ""}
          disabled={disabled}
          onClick={() => onPick(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, label, onChange, disabled, reason }: {
  on: boolean;
  label: string;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  reason?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={reason}
      className={`c-switch${on ? " on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <i />
    </button>
  );
}

export function MenuItem({ icon, lead, tick, top, label, sub, right, onClick, disabled, reason, reasonLine, checked, danger, testId }: {
  icon?: IconName;
  /** Drawn where the icon goes (a model's logo). */
  lead?: ReactNode;
  /** The tick goes before the row instead of after it (the preview's model rows). */
  tick?: boolean;
  /** The row's parts sit at its top (the preview's .mi.pm rows, whose lines wrap). */
  top?: boolean;
  label: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  reason?: string;
  /** Show the reason in place of the sub-line (the mode menu's blocked rows); otherwise it is the tooltip. */
  reasonLine?: boolean;
  checked?: boolean;
  danger?: boolean;
  testId?: string;
}) {
  const line = disabled && reason && reasonLine ? reason : sub;
  return (
    <button
      type="button"
      data-mi=""
      data-testid={testId}
      className={`c-mi${danger ? " bad" : ""}${checked ? " checked" : ""}${top ? " top" : ""}`}
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      disabled={disabled}
      title={reason}
      aria-description={reason}
      onClick={onClick}
    >
      {tick ? <span className="c-mi-tick">{checked ? <Icon name="check" size={15} /> : null}</span> : null}
      {icon ? <span className="c-mi-ic"><Icon name={icon} size={16} /></span> : lead ? <span className="c-mi-lead">{lead}</span> : null}
      <span className="c-mi-t">
        <span>{label}</span>
        {line ? <small>{line}</small> : null}
      </span>
      {right !== undefined ? <span className="c-mi-r">{right}</span> : checked && !tick ? <span className="c-mi-r"><Icon name="check" size={15} /></span> : null}
    </button>
  );
}

export function Sep() {
  return <hr className="c-sep" />;
}

export function Head({ children }: { children: ReactNode }) {
  return <div className="c-ph">{children}</div>;
}
