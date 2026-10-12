// Preview: the app a Trunk is building (§4.5.8 Preview tab), from the engine's portals (portal.list, portal.close,
// the portal.changed event). One row per open preview; the chosen one shows in a frame.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { COMPOSE_EVENT } from "../../composer/Composer";
import { SIcon } from "../stage-icons";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type Portal = { id: string; title: string; port: number; url: string; createdAtMs: number };
const ASKS = ["Show me in a preview.", "Start the app in a preview.", "Make the server available in a preview."];

/** portal.list read into previews, newest first. `url` carries the access token and is left out for read-only callers. */
export function readPortals(result: unknown): Portal[] {
  const list = rec(result).portals;
  return (Array.isArray(list) ? list : [])
    .map(rec)
    .filter((p) => str(p.id) && typeof p.port === "number")
    .map((p) => ({ id: str(p.id), title: str(p.title) || `Port ${String(p.port)}`, port: p.port as number, url: str(p.url), createdAtMs: typeof p.createdAtMs === "number" ? p.createdAtMs : 0 }))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/** The open previews, read again whenever the engine says they changed. */
export function usePortals(engine: WindowEngine): { portals: Portal[]; error: string; reload: () => void } {
  const [state, setState] = useState<{ portals: Portal[]; error: string }>({ portals: [], error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void engine.request("portal.list", {}).then(
      (r) => live && setState({ portals: readPortals(r), error: "" }),
      (e: unknown) => live && setState({ portals: [], error: errorText(e) }),
    );
    const off = engine.onEvent((event) => {
      if (event.event === "portal.changed") setTick((t) => t + 1);
    });
    return () => {
      live = false;
      off();
    };
  }, [engine, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

type Props = { engine: WindowEngine; name: string; portals: Portal[]; error: string; onError: (m: string) => void; toast: (m: string) => void };

export function PreviewTab({ engine, name, portals, error, onError, toast }: Props) {
  const [chosen, setChosen] = useState("");
  if (error) return <p className="err-st" role="alert">{error}</p>;
  if (!portals.length) {
    const ask = (text: string) => window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: { sessionKey: engine.sessionKey, text } }));
    return (
      <div className="pv-empty-pn">
        <p>Nothing to preview yet. Ask {name}:</p>
        <div className="pv-chips-pn">
          {ASKS.map((t) => <button key={t} type="button" className="chip6-pn" onClick={() => ask(t)}>{t}</button>)}
        </div>
      </div>
    );
  }
  const current = portals.find((p) => p.id === chosen) ?? portals[0]!;
  const close = (p: Portal) =>
    void engine.request("portal.close", { id: p.id }).then(() => toast(`Closed the ${p.title} preview. The app keeps running.`), (e: unknown) => onError(errorText(e)));
  return (
    <div className="pv-pn">
      <div className={portals.length === 1 ? "pv-rows-pn one" : "pv-rows-pn"}>
        {portals.map((p) => (
          <div key={p.id} className="pv-row-pn" aria-current={p.id === current.id}>
            <button type="button" className="pv-pick-pn" onClick={() => setChosen(p.id)}>
              <b>{p.title}</b>
              <small>Port {p.port}</small>
            </button>
            <button type="button" className="ib sm" aria-label="Open in browser" title={p.url ? "Open in browser" : "Only a person who may change things here can open it."} disabled={!p.url} onClick={() => window.open(p.url, "_blank", "noopener")}>
              <SIcon name="forward" small />
            </button>
            <button type="button" className="ib sm" aria-label={`Close ${p.title}`} title={`Close ${p.title}`} onClick={() => close(p)}>
              <SIcon name="x" small />
            </button>
          </div>
        ))}
      </div>
      {current.url ? (
        <div className="pv-frame-pn" role="region" aria-label={`${current.title} preview`}>
          <iframe key={current.id} src={current.url} title={`${current.title} preview`} sandbox="allow-scripts allow-forms allow-same-origin allow-popups" />
        </div>
      ) : null}
      {!current.url ? (
        <div className="pv-status-pn">
          <b>Can’t show this preview here</b>
          <p>Its address is shown only to a person who may change things on this Branch.</p>
        </div>
      ) : null}
    </div>
  );
}
