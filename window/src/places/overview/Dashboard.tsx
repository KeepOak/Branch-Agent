// Overview as the owner approved it (preview.html P34, item 34a): a hero composer that talks to the default Trunk, the
// range and account chips, and reorderable widgets: GitHub, Gmail and Branch (which keeps the old tiles), with Calendar
// and Drive as Coming. The order and what is hidden are kept on this computer; nothing here shows demo numbers.
import { useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "../../shell/icons";
import { ToolLogo } from "../../setup/tool-logos";
import { Coming } from "../../glass/coming";

export type WidgetId = "github" | "gmail" | "branch" | "calendar" | "drive";
export const WIDGET_NAMES: Record<WidgetId, string> = { github: "GitHub", gmail: "Gmail", branch: "Branch", calendar: "Google Calendar", drive: "Google Drive" };
/** The widgets with a card of their own in R1; Calendar and Drive are Coming. */
export const BUILT_WIDGETS: WidgetId[] = ["github", "gmail", "branch"];
const DEFAULT_ORDER: WidgetId[] = ["github", "gmail", "branch", "calendar", "drive"];
/** The preview's key for the order and hidden cards (preview.html:45915), kept on this computer. */
const KEY = "branch-p34-ov";
const RANGES: [string, string][] = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["year", "This year"]];

type Layout = { order: WidgetId[]; hidden: WidgetId[] };
const isWidget = (v: unknown): v is WidgetId => typeof v === "string" && v in WIDGET_NAMES;

/** The saved layout, with any widget the saved list leaves out added at its default place. */
export function readLayout(raw: string | null): Layout {
  try {
    const saved = JSON.parse(raw || "null") as { order?: unknown; hidden?: unknown } | null;
    const order = Array.isArray(saved?.order) ? saved.order.filter(isWidget) : [];
    const merged = [...new Set([...order, ...DEFAULT_ORDER])];
    const hidden = Array.isArray(saved?.hidden) ? saved.hidden.filter(isWidget) : [];
    return { order: merged, hidden };
  } catch {
    return { order: [...DEFAULT_ORDER], hidden: [] };
  }
}

/** The page's layout: order and hidden cards, saved on change; the range and account chips are for this visit. */
export function useWidgetLayout() {
  const [layout, setLayout] = useState<Layout>(() => readLayout(safeGet()));
  const save = (next: Layout) => {
    setLayout(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* this window keeps its layout for this visit */ }
  };
  // Moves a card past its nearest visible neighbour in the saved order, so a hidden card never takes a step.
  const move = (id: WidgetId, by: -1 | 1) => {
    const visible = layout.order.filter(x => !layout.hidden.includes(x));
    const i = visible.indexOf(id), neighbour = visible[i + by];
    if (i < 0 || !neighbour) return;
    const order = [...layout.order];
    const a = order.indexOf(id), b = order.indexOf(neighbour);
    [order[a], order[b]] = [order[b]!, order[a]!];
    save({ ...layout, order });
  };
  const hide = (id: WidgetId) => save({ ...layout, hidden: [...new Set([...layout.hidden, id])] });
  const show = (id: WidgetId) => save({ ...layout, hidden: layout.hidden.filter(x => x !== id) });
  return { ...layout, move, hide, show };
}
function safeGet(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** One card: its head with the logo, name and account, then the move and hide controls, then its body. */
export function WidgetCard({ id, index, count, head, onMove, onHide, children }: {
  id: WidgetId; index: number; count: number; head: ReactNode; onMove: (id: WidgetId, by: -1 | 1) => void; onHide: (id: WidgetId) => void; children: ReactNode;
}) {
  const name = WIDGET_NAMES[id];
  return (
    <section className="p34-w g-clear" data-w={id} aria-label={name}>
      <div className="p34-w-head">
        {head}
        <span className="p34-grow" />
        <span className="p34-w-btns" role="group" aria-label={`${name} card`}>
          {index > 0 ? <button type="button" className="icon-btn" aria-label={`Move ${name} up`} title="Move up" onClick={() => onMove(id, -1)}><span className="p34-flip"><Icon name="down" /></span></button> : null}
          {index < count - 1 ? <button type="button" className="icon-btn" aria-label={`Move ${name} down`} title="Move down" onClick={() => onMove(id, 1)}><Icon name="down" /></button> : null}
          <button type="button" className="icon-btn" aria-label={`Hide ${name}`} title="Hide this card" onClick={() => onHide(id)}><Icon name="eye" /></button>
        </span>
      </div>
      {children}
    </section>
  );
}

/** The mark at the head of a card: the service's logo where there is one, the Trunk's leaf for Branch. */
export function WidgetMark({ id, leaf }: { id: WidgetId; leaf?: ReactNode }) {
  if (id === "branch") return <span className="p34-leaf">{leaf}</span>;
  if (id === "github" || id === "gmail" || id === "drive") return <ToolLogo id={id} size={26} />;
  return <span className="p34-leaf"><Icon name="clock" /></span>;
}

/** A card with nothing real to show yet: the preview's words, and one line that says what it is waiting for. */
export function ComingBody({ linked }: { linked: boolean }) {
  return (
    <div className="p34-coming">
      <p>{linked ? "Linked. A card like the others is coming: what changed, and what needs you." : "Coming: link it and this card shows what changed and what needs you."}</p>
      <span className="pill idle">Coming</span>
    </div>
  );
}

/** A built card whose account is not linked: the preview's empty state, with its link button. */
export function UnlinkedBody({ id, onLink }: { id: "github" | "gmail"; onLink: () => void }) {
  const name = WIDGET_NAMES[id];
  const what = id === "github" ? "your contributions, pull requests and reviews" : "your mail: unread, what needs a reply, top senders";
  return (
    <div className="p34-unlinked">
      <p>{name} isn’t linked yet. Link it and this card fills with {what}.</p>
      <button type="button" className="btn pri sm" onClick={onLink}>Link {name}</button>
    </div>
  );
}

/** The hero: a glass composer that sends to the default Trunk. */
export function OverviewHero({ name, me, chip, onSend }: { name: string; me: string; chip: string; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    onSend(message).then(sent => { if (sent) setText(""); }).finally(() => setBusy(false));
  };
  return (
    <section className="p34-hero">
      <div className="p34-bg-row">
        <Coming need="overview.background" reason="Change background comes in a later update.">
          <button type="button" className="p34-bg" disabled>Change background</button>
        </Coming>
      </div>
      <form className="p34-ask" onSubmit={submit}>
        <input className="inp" value={text} onChange={event => setText(event.target.value)} placeholder="Ask anything, or describe a change…" aria-label={`Ask ${name}`} autoComplete="off" />
        {chip ? <span className="p34-chip">{chip}</span> : null}
        <button type="submit" className="p34-send" aria-label={`Send to ${name}`} disabled={!text.trim() || busy}><span className="p34-flip"><Icon name="down" /></span></button>
      </form>
      <p className="p34-to">Goes to {name}, your default Trunk.{me ? ` Good to see you, ${me}.` : ""}</p>
    </section>
  );
}

/** The range and the account chips, and Add a widget with each widget's state. */
export function OverviewBar({ range, onRange, source, onSource, layout, linked, onAdd, onLink }: {
  range: string; onRange: (range: string) => void; source: string; onSource: (source: string) => void;
  layout: Layout; linked: Record<WidgetId, boolean>; onAdd: (id: WidgetId) => void; onLink: () => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = layout.order.filter(id => !layout.hidden.includes(id) && BUILT_WIDGETS.includes(id));
  return (
    <>
      <div className="p34-head">
        <h1>Overview</h1>
        <span className="p34-seg" role="group" aria-label="Range">
          {RANGES.map(([value, label]) => <button key={value} type="button" aria-pressed={range === value} onClick={() => onRange(value)}>{label}</button>)}
        </span>
      </div>
      <div className="p34-src">
        <div className="p34-chips" role="group" aria-label="Accounts">
          <button type="button" aria-pressed={source === "all"} onClick={() => onSource("all")}>All accounts</button>
          {shown.map(id => <button key={id} type="button" aria-pressed={source === id} onClick={() => onSource(id)}>{WIDGET_NAMES[id]}</button>)}
        </div>
        <div className="p34-add">
          <button type="button" className="btn sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="plus" />Add a widget</button>
          {open ? (
            <div className="p34-pop" role="menu" aria-label="Add a widget">
              {DEFAULT_ORDER.map(id => {
                const on = !layout.hidden.includes(id), built = BUILT_WIDGETS.includes(id);
                const state = on ? "Shown" : built ? (linked[id] || id === "branch" ? "Add" : "Link first") : "Coming";
                return (
                  <button key={id} type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => {
                    setOpen(false);
                    if (!on && built && !linked[id] && id !== "branch") { onLink(); return; }
                    onAdd(id);
                  }}>
                    <span>{WIDGET_NAMES[id]}</span><span className="p34-state">{state}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
