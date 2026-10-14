// The ring popover's "This computer" row (HANDOFF R1-02: computer moved to the top of the ring popover; QUEUE-PASS17
// item 3). Under the connection line it shows what computer.status says about Trunks using this screen, and Branch's
// browser from browser.request GET /, which it can start (POST /start). The header's computer and globe buttons open
// the stage itself; this row is the status. Each part is read only when the engine offers its method.
import { useCallback, useEffect, useState } from "react";
import { availability } from "../../connect/capabilities";
import type { WindowEngine } from "../../composer/engine";
import type { OpenTarget } from "../../composer/nav";
import { Coming } from "../../glass/coming";

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec => (value && typeof value === "object" && !Array.isArray(value) ? value as Rec : {});
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
type Read = { data: Rec | null; error: string | null };
const BROWSER_STATUS = { method: "GET", path: "/" };

function useRead(engine: WindowEngine, method: string, params: unknown, on: boolean) {
  const [read, setRead] = useState<Read>({ data: null, error: null });
  const key = JSON.stringify(params);
  const load = useCallback(() => {
    if (!on) return undefined;
    let active = true;
    engine.request<unknown>(method, JSON.parse(key)).then(
      (value) => { if (active) setRead({ data: rec(value), error: null }); },
      (error: unknown) => { if (active) setRead({ data: null, error: message(error) }); },
    );
    return () => { active = false; };
  }, [engine, method, key, on]);
  useEffect(() => load(), [load]);
  return { ...read, reload: load };
}

/** What computer.status says about Trunks using this computer's screen, keyboard and mouse. */
export function computerLine(data: Rec | null, error: string | null): string {
  if (error) return `Couldn’t check computer control: ${error}`;
  if (!data) return "Checking computer control…";
  if (data.available === true) return "Trunks can use this screen";
  if (data.configured === true) return "Computer control is set up but can’t reach this screen";
  return "Computer control is off";
}

/** What browser.request GET / says about Branch's own browser. */
export function browserLine(data: Rec | null, error: string | null): string {
  if (error) return `Couldn’t check the browser: ${error}`;
  if (!data) return "Checking the browser…";
  const name = typeof data.detectedBrowser === "string" && data.detectedBrowser ? data.detectedBrowser : null;
  if (data.running === true) return name ? `Branch’s browser is open (${name})` : "Branch’s browser is open";
  return name ? `Branch’s browser is closed · found ${name}` : "Branch’s browser is closed";
}

export function ThisComputer({ engine, offline, onOpen }: { engine: WindowEngine; offline: boolean; onOpen: (target: OpenTarget) => void }) {
  const canComputer = !offline && availability(engine, "computer.status") !== "no";
  const canBrowser = !offline && availability(engine, "browser.request") !== "no";
  const computer = useRead(engine, "computer.status", {}, canComputer);
  const browser = useRead(engine, "browser.request", BROWSER_STATUS, canBrowser);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState<string | null>(null);
  const start = () => {
    setBusy(true); setFailed(null);
    engine.request("browser.request", { method: "POST", path: "/start" }).then(
      () => { setBusy(false); browser.reload(); },
      (error: unknown) => { setBusy(false); setFailed(`Couldn’t start the browser: ${message(error)}`); },
    );
  };
  const ok = (data: Rec | null, key: "available" | "running") => (data?.[key] === true ? "on" : "off");
  return <section className="r1c-sec" data-part="this-computer">
    <div className="c-pt">This computer</div>
    <div className="r1c-line"><i className="r1c-dot" data-state={offline ? "off" : "on"} />{offline ? "Offline · reconnecting to Branch" : "Online · you are here"}</div>
    {canComputer ? <div className="r1c-line" data-tool="computer" role="status"><i className="r1c-dot" data-state={ok(computer.data, "available")} />{computerLine(computer.data, computer.error)}</div> : null}
    {canBrowser ? <div className="r1c-line" data-tool="browser" role="status"><i className="r1c-dot" data-state={ok(browser.data, "running")} />{failed ?? browserLine(browser.data, browser.error)}</div> : null}
    <div className="r1c-acts">
      {browser.data && browser.data.running !== true
        ? <Coming engine={engine} need="browser.request"><button type="button" className="r1c-quiet" disabled={busy} onClick={start}>{busy ? "Starting…" : "Start the browser"}</button></Coming>
        : null}
      <button type="button" className="r1c-quiet" data-local="" onClick={() => onOpen("settings/browser")}>Computer & browser settings</button>
    </div>
  </section>;
}
