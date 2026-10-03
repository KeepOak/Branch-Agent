// Small shared parts of Canopy: the context every tab reads, a tick-list popover, faces and pills.
import type { ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Face } from "../../face/Face";
import type { Level } from "../../places-nav/level";
import type { PlaceId } from "../../places-nav/routes";
import { Icon } from "../../shell/icons";
import type { MenuAnchor } from "../../shell/Menu";
import { Popover } from "../../shell/Popover";
import type { CanopyData, Computer } from "./data";

export type Ctx = {
  engine: WindowEngine; d: CanopyData; level: Level; comps: Computer[];
  write: boolean; approve: boolean; busy: boolean; now: number;
  act: (op: () => Promise<unknown>, message: string) => Promise<boolean>;
  openConversation: (key: string) => void; openPlace: (place: PlaceId) => void;
  /** Canopy › Cards and that card's detail sheet. */
  openCard: (id: string) => void;
};

export const anchorOf = (el: HTMLElement, right = false): MenuAnchor => {
  const r = el.getBoundingClientRect();
  return { x: right ? r.right - 220 : r.left, y: r.bottom + 4 };
};

export type Choice = { id: string; label: ReactNode; checked: boolean; disabled?: string };

/** A popover of menuitemcheckbox / menuitemradio rows that stays open while you tick (§5.4). */
export function ChoiceMenu({ at, label, head, options, onPick, onClose, radio, foot }: {
  at: MenuAnchor; label: string; head?: string; options: Choice[]; onPick: (id: string) => void; onClose: () => void; radio?: boolean; foot?: ReactNode;
}) {
  return (
    <Popover at={at} label={label} onClose={onClose}>
      <div className="cn-menu" role="menu" aria-label={label}>
        {head ? <div className="ph">{head}</div> : null}
        {options.map(o => (
          <button key={o.id} type="button" className="mi" role={radio ? "menuitemradio" : "menuitemcheckbox"} aria-checked={o.checked}
            disabled={Boolean(o.disabled)} title={o.disabled} onClick={() => onPick(o.id)}>
            <span className="cn-mi-t">{o.label}</span>
            <span className="cn-tick">{o.checked ? <Icon name="check" /> : null}</span>
          </button>
        ))}
        {foot}
      </div>
    </Popover>
  );
}

export function TrunkFace({ name, size, working }: { name: string; size: number; working?: boolean }) {
  return <Face size={size} label={name} state={working ? "work" : "idle"} />;
}

export function Nobody({ size = 18 }: { size?: number }) {
  return <span className="cn-nobody" style={{ width: size, height: size }} aria-hidden="true"><Icon name="users" /></span>;
}

export function Pill({ tone, children, tip }: { tone: string; children: ReactNode; tip?: string }) {
  return <span className={`cn-pill ${tone}`} title={tip}><i />{children}</span>;
}

export const sinceWords = (t: number | undefined, now: number) => {
  if (!t) return "";
  const m = Math.floor((now - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
};
export const clock = (t: number | undefined) => t ? new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

export const when = (t: unknown) => { const n = Number(t); return n > 0 ? new Date(n).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—"; };
export function Sec({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return <section className="cn-ssec"><div className="cn-sec-h"><h2>{title}</h2>{extra}</div>{children}</section>;
}
