// Dashboard: what the Trunk pinned for this conversation (its board, board.get, OpenClaw's show_widget board),
// each widget as a card in the board's 12-column grid. The live widget view (OpenClaw's sandboxed frame with its
// view ticket) isn't in this window yet, so a card names that instead of drawing a fake page.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/settings-nav";
import { shows } from "../../places-nav/level";
import { SIcon } from "../stage-icons";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NO_FRAME = "Its live view opens in a later version of this window.";
const KIND: Record<string, string> = { html: "Widget", "mcp-app": "App", plugin: "Plugin" };

export type BoardWidgetCard = { name: string; tabId: string; title: string; kind: string; w: number; h: number; position: number; pending: boolean };
export type BoardView = { tabs: { tabId: string; title: string }[]; widgets: BoardWidgetCard[] };

/** board.get read into tabs in order and widgets in order. */
export function readBoard(result: unknown): BoardView {
  const r = rec(result);
  const tabs = (Array.isArray(r.tabs) ? r.tabs : []).map(rec).sort((a, b) => num(a.position, 0) - num(b.position, 0)).map((t) => ({ tabId: str(t.tabId), title: str(t.title) || str(t.tabId) })).filter((t) => t.tabId);
  const widgets = (Array.isArray(r.widgets) ? r.widgets : []).map(rec).filter((w) => str(w.name)).map((w) => ({
    name: str(w.name),
    tabId: str(w.tabId),
    title: str(w.title) || str(w.name),
    kind: str(w.kindLabel) || KIND[str(w.contentKind)] || "Widget",
    w: Math.max(1, Math.min(12, num(w.sizeW, 6))),
    h: Math.max(1, Math.min(20, num(w.sizeH, 3))),
    position: num(w.position, 0),
    pending: w.grantState === "pending",
  }));
  return { tabs, widgets: widgets.sort((a, b) => a.position - b.position) };
}

export function DashboardTab({ engine, name, level }: { engine: WindowEngine; name: string; level: Level }) {
  const [state, setState] = useState<{ key: string; board?: BoardView; error?: string }>({ key: "" });
  const [tab, setTab] = useState("");
  const key = engine.sessionKey ?? "";
  useEffect(() => {
    if (!key) return;
    let live = true;
    let generation = 0;
    const read = () => {
      const current = ++generation;
      void engine.request("board.get", { sessionKey: key, ...(engine.agentId ? { agentId: engine.agentId } : {}) }).then(
        (r) => live && current === generation && setState({ key, board: readBoard(r) }),
        (e: unknown) => live && current === generation && setState({ key, error: errorText(e) }),
      );
    };
    const off = engine.onEvent((event) => {
      if (event.event === "board.changed" && rec(event.payload).sessionKey === key) read();
    });
    read();
    return () => {
      live = false;
      off();
    };
  }, [engine, key]);
  const cur = state.key === key ? state : { key };
  if (cur.error) return <p className="err-st" role="alert">{cur.error}</p>;
  if (!cur.board) return <p className="pane-empty">Reading what {name} pinned…</p>;
  const { tabs, widgets } = cur.board;
  const shown = tab && tabs.some((t) => t.tabId === tab) ? tab : tabs[0]?.tabId ?? "";
  const list = widgets.filter((w) => !shown || w.tabId === shown);
  return (
    <div className="dash-pn">
      {shows(level, "advanced") && tabs.length > 1 ? (
        <div className="dtabs-pn" role="tablist" aria-label="Dashboard tabs">
          {tabs.map((t) => (
            <button key={t.tabId} type="button" role="tab" className="tab" aria-selected={t.tabId === shown} onClick={() => setTab(t.tabId)}>
              {t.title}
            </button>
          ))}
        </div>
      ) : null}
      {list.length ? (
        <div className="dg-pn" role="list" aria-label="Pinned">
          {list.map((w) => (
            <section key={w.name} className="wd-pn" role="listitem" aria-label={w.title} style={{ gridColumn: `span ${w.w}`, gridRow: `span ${w.h}` }}>
              <div className="wh-pn">
                <b>{w.title}</b>
                <span className="pill idle">{w.kind}</span>
              </div>
              <p className="hint-st">{w.pending ? "Shows only; tools off until you allow them." : NO_FRAME}</p>
            </section>
          ))}
        </div>
      ) : (
        <div className="dempty-pn">
          <SIcon name="layers" />
          <b>Nothing pinned yet</b>
          <small>Ask {name} to pin something here, like a status card.</small>
        </div>
      )}
    </div>
  );
}
