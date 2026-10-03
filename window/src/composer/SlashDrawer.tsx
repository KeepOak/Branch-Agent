// The slash drawer and the lists that share its look (DESIGN-SPEC §4.3.5): commands, a command's choices,
// the mid-message Skills popover and the @ mention popover. The composer owns the keys; these only draw.
import type { ReactNode } from "react";
import { Pebble } from "../face/Pebble";
import { Icon } from "./icons";

export type DrawerRow = {
  id: string;
  /** "/goal" or a choice's value */
  main: string;
  hint?: string;
  line?: ReactNode;
  owner?: string;
  checked?: boolean;
  lead?: ReactNode;
  /** A Trunk's name: the row leads with its face (the classic pebble's still; §5.10). */
  face?: string;
  /** An icon to lead with (the "Add as context" rows). */
  icon?: string;
};

type Props = {
  label: string;
  rows: DrawerRow[];
  selected: number;
  onPick: (index: number) => void;
  onHover: (index: number) => void;
  footer?: string;
  kind: "slash" | "mention" | "skills";
  groupLabel?: (index: number) => string | undefined;
};

export function Drawer({ label, rows, selected, onPick, onHover, footer, kind, groupLabel }: Props) {
  return (
    <div className={`c-drawer c-drawer-${kind}`} role="listbox" aria-label={label} data-testid={`${kind}-drawer`}>
      {kind !== "slash" ? <div className="c-ph">{label}</div> : null}
      <div className="c-scroll">
        {rows.map((row, i) => {
          const group = groupLabel?.(i);
          return (
            <div key={row.id}>
              {group ? <div className="c-grp">{group}</div> : null}
              <div
                role="option"
                aria-selected={i === selected}
                className={`c-drow${i === selected ? " sel" : ""}`}
                data-testid={`${kind}-row`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(i);
                }}
                onMouseEnter={() => onHover(i)}
              >
                {row.face ? <span className="c-dlead"><Pebble size={22} label={row.face} /></span> : row.icon ? <span className="c-dlead c-dico"><Icon name={row.icon} size={16} /></span> : row.lead ? <span className="c-dlead">{row.lead}</span> : null}
                <code>{row.main}</code>
                {row.hint ? <span className="c-dhint">{row.hint}</span> : <span />}
                <small>
                  {row.line}
                  {row.owner ? <span className="c-downer"> · {row.owner}</span> : null}
                  {row.checked ? " ✓" : ""}
                </small>
              </div>
            </div>
          );
        })}
      </div>
      {footer ? <div className="c-dfoot">{footer}</div> : null}
    </div>
  );
}
