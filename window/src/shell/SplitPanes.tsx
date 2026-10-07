// Side by side and Split (DESIGN-SPEC §4.2.6, the preview's panesPB18): next to the open conversation, more panes,
// each a whole conversation with its own header, messages and message box (chat.history and chat.send on its key).
// "Split right" adds a column, "Split down" stacks a pane under the last column; the divider resizes the main pane.
import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { Conversation } from "../connect/conversations";
import { Pebble } from "../face/Pebble";
import { Icon } from "./icons";
import type { MenuItem } from "./Menu";
import { TalkThread, useTalkThread } from "./TalkBeside";
import "./split.css";

export type Pane = { key: string | null; dir: "right" | "down" };
type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;
type OnEvent = (listener: (event: string, payload: unknown) => void) => () => void;

/** The narrowest a pane may be; "Split right" says there's no room below this. */
export const MIN_PANE = 320;
export const NO_ROOM = "There’s no room for another pane. Widen the window or close one.";
export const TOO_NARROW = "Side by side needs a wider window. It opens when there is room.";

/** Panes grouped into columns: a "down" pane joins the column before it. */
export function paneColumns(panes: Pane[]): [Pane, number][][] {
  const cols: [Pane, number][][] = [];
  panes.forEach((p, n) => {
    if (p.dir === "down" && cols.length) cols[cols.length - 1].push([p, n]);
    else cols.push([[p, n]]);
  });
  return cols;
}

type Props = {
  panes: Pane[];
  rows: Conversation[];
  openKey: string | null;
  request: Request;
  onEvent: OnEvent;
  trunkName: (agentId: string | undefined) => string;
  rowName: (key: string) => string;
  onOpen: (key: string) => void;
  onPick: (n: number, key: string) => void;
  onClose: (n: number) => void;
  onMenu: (e: MouseEvent<HTMLElement>, id: string, items: MenuItem[], label: string) => void;
  onSplit: (dir: "right" | "down") => void;
};

function ChoosePane({ n, p }: { n: number; p: Props }) {
  return (
    <section className="pane empty" data-pane={n}>
      <div className="pane-h">
        <span className="grow"><b>Choose a conversation</b></span>
        <button type="button" className="ib sm" aria-label="Close pane" title="Close pane" onClick={() => p.onClose(n)}><Icon name="x" small /></button>
      </div>
      <div className="pane-pick">
        {p.rows.filter((r) => !r.archived && r.key !== p.openKey).map((r) => (
          <button key={r.key} type="button" className="mi" onClick={() => p.onPick(n, r.key)}>
            <Pebble size={22} label={p.trunkName(r.agentId)} state="idle" priority={50} />
            <span className="mi-t">{p.rowName(r.key)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ConversationPane({ n, k, p }: { n: number; k: string; p: Props }) {
  const row = p.rows.find((r) => r.key === k);
  const trunk = p.trunkName(row?.agentId);
  const thread = useTalkThread(p.request, p.onEvent, k);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setPending(text);
    const ok = await thread.send(text, undefined);
    setPending(null);
    if (!ok) setDraft(text);
  };
  const menu: MenuItem[] = [
    { label: "Split right", run: () => p.onSplit("right") },
    { label: "Split down", run: () => p.onSplit("down") },
    { label: "Close pane", run: () => p.onClose(n) },
  ];
  return (
    <section className="pane" data-pane={n} aria-label={p.rowName(k)}>
      <div className="pane-h">
        <Pebble size={26} label={trunk} state={thread.running ? "work" : "idle"} priority={100} />
        <span className="grow">
          <b>{p.rowName(k)}</b>
          <small>{trunk}</small>
        </span>
        <button type="button" className="btn ghost sm" onClick={() => p.onOpen(k)}>Open</button>
        <button type="button" className="ib sm" aria-label="More for this pane" title="More" aria-haspopup="menu" onClick={(e) => p.onMenu(e, `pane:${n}`, menu, "Pane")}><Icon name="more" small /></button>
        <button type="button" className="ib sm" aria-label="Close the conversation beside" title="Close" onClick={() => p.onClose(n)}><Icon name="x" small /></button>
      </div>
      <div className="pane-sc">
        <TalkThread rows={thread.rows} name={trunk} running={thread.running} pending={pending} />
      </div>
      {thread.error ? <p className="talk-error" role="alert">{thread.error}</p> : null}
      <form className="pane-c" onSubmit={(e) => (e.preventDefault(), void send())}>
        <input className="inp" aria-label={`Message ${trunk}`} placeholder={`Message ${trunk}`} autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn sm primary" disabled={!draft.trim()}>Send</button>
      </form>
    </section>
  );
}

/** The divider between the main pane and the rest: drag, or Left and Right, between 25% and 75%. */
export function PaneDivider({ width, onWidth, down = false }: { width: number; onWidth: (w: number) => void; down?: boolean }) {
  const clamp = (w: number) => Math.min(75, Math.max(25, w));
  const downPointer = (e: PointerEvent<HTMLDivElement>) => {
    const wrap = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!wrap) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => onWidth(clamp((down ? (ev.clientY - wrap.top) / wrap.height : (ev.clientX - wrap.left) / wrap.width) * 100));
    const el = e.currentTarget;
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", () => el.removeEventListener("pointermove", move), { once: true });
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const before = down ? "ArrowUp" : "ArrowLeft";
    const after = down ? "ArrowDown" : "ArrowRight";
    if (e.key === before || e.key === after) {
      e.preventDefault();
      onWidth(clamp(width + (e.key === before ? -5 : 5)));
    }
  };
  return <div className="pane-divider" style={{ cursor: down ? "row-resize" : "col-resize" }} role="separator" aria-orientation={down ? "horizontal" : "vertical"} aria-label="Resize panes" aria-valuenow={Math.round(width)} tabIndex={0} onPointerDown={downPointer} onKeyDown={key} />;
}

/** Leading down panes share the main column; later right panes start new columns. */
export function SplitFrame({ panes, width, onWidth, renderPanes, children }: { panes: Pane[]; width: number; onWidth: (w: number) => void; renderPanes: (start: number, end: number) => ReactNode; children: ReactNode }) {
  const [height, setHeight] = useState(50);
  if (!panes.length) return <>{children}</>;
  const firstRight = panes.findIndex((p) => p.dir === "right");
  const below = firstRight < 0 ? panes.length : firstRight;
  const frame = (main: ReactNode, side: ReactNode, stacked: boolean) => (
    <div className={stacked ? "split stacked" : "split"} style={{ ["--mainw" as string]: `${stacked ? height : width}%` }}>
      <div className="split-main">{main}</div>
      <PaneDivider width={stacked ? height : width} onWidth={stacked ? setHeight : onWidth} down={stacked} />
      {side}
    </div>
  );
  const main = below ? frame(children, renderPanes(0, below), true) : children;
  return below === panes.length ? main : frame(main, renderPanes(below, panes.length), false);
}

/** The panes beside the main one, column by column. */
export function SplitPanes(p: Props & { start?: number; end?: number }) {
  return (
    <div className="split-side">
      {paneColumns(p.panes.slice(p.start ?? 0, p.end)).map((col, i) => (
        <div key={i} className="split-col">
          {col.map(([pane, index]) => {
            const n = index + (p.start ?? 0);
            return pane.key ? <ConversationPane key={`${n}:${pane.key}`} n={n} k={pane.key} p={p} /> : <ChoosePane key={`${n}:choose`} n={n} p={p} />;
          })}
        </div>
      ))}
    </div>
  );
}
