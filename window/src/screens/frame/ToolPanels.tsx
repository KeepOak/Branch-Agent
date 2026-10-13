// The header's Computer and Browser buttons (R1-15, #977). Each opens a small panel with what the engine reports right
// now: computer.status for screen control on this computer, browser.request GET / for Branch's own browser. The
// browser panel can start that browser (browser.request POST /start). Both panels link to their Settings page. The
// popover opens once the first answer is in, so it is measured with its real content.
import { useCallback, useEffect, useState, type RefObject } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import { Popover } from "../../glass/Popover";

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec => (value && typeof value === "object" && !Array.isArray(value) ? value as Rec : {});
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Read = { data: Rec | null; error: string | null };

function useRead(engine: WindowEngine, method: string, params: unknown) {
  const [read, setRead] = useState<Read>({ data: null, error: null });
  const key = JSON.stringify(params);
  const load = useCallback(() => {
    let active = true;
    engine.request<unknown>(method, JSON.parse(key)).then(
      (value) => { if (active) setRead({ data: rec(value), error: null }); },
      (error: unknown) => { if (active) setRead({ data: null, error: message(error) }); },
    );
    return () => { active = false; };
  }, [engine, method, key]);
  useEffect(() => load(), [load]);
  return { ...read, reload: load };
}

/** What computer.status says about Trunks using this computer's screen, keyboard and mouse. */
export function computerLine(data: Rec | null, error: string | null): string {
  if (error) return `Couldn’t check this computer: ${error}`;
  if (!data) return "Checking this computer…";
  if (data.available === true) return "Trunks can use this computer’s screen.";
  if (data.configured === true) return "Computer control is set up but can’t reach this screen right now.";
  return "Computer control is off on this computer.";
}

/** What browser.request GET / says about Branch's own browser. */
export function browserLine(data: Rec | null, error: string | null): string {
  if (error) return `Couldn’t check the browser: ${error}`;
  if (!data) return "Checking the browser…";
  const name = typeof data.detectedBrowser === "string" && data.detectedBrowser ? data.detectedBrowser : null;
  if (data.running === true) return name ? `Branch’s browser is open (${name}).` : "Branch’s browser is open.";
  return name ? `Branch’s browser is closed. Found ${name}.` : "Branch’s browser is closed.";
}

type Status = Read & { reload: () => void };
type PanelProps = { engine: WindowEngine; status: Status; onSettings: (page: string) => void };

export function ComputerPanel({ status, onSettings }: PanelProps) {
  const actions = Array.isArray(rec(status.data?.computerUse).actions) ? (rec(status.data?.computerUse).actions as unknown[]).filter((a): a is string => typeof a === "string") : [];
  return <div className="r1-tool-panel g-clear" data-tool="computer">
    <strong className="g-label">This computer</strong>
    <p className="g-label" role="status">{computerLine(status.data, status.error)}</p>
    {actions.length ? <p className="g-label">Can {actions.slice(0, 4).join(", ")}{actions.length > 4 ? "…" : ""}</p> : null}
    <button type="button" data-local="" onClick={() => onSettings("devices")}>Computer settings</button>
  </div>;
}

export function BrowserPanel({ engine, status, onSettings }: PanelProps) {
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState<string | null>(null);
  const start = () => {
    setBusy(true); setFailed(null);
    engine.request("browser.request", { method: "POST", path: "/start" }).then(
      () => { setBusy(false); status.reload(); },
      (error: unknown) => { setBusy(false); setFailed(`Couldn’t open the browser: ${message(error)}`); },
    );
  };
  return <div className="r1-tool-panel g-clear" data-tool="browser">
    <strong className="g-label">Browser</strong>
    <p className="g-label" role="status">{failed ?? browserLine(status.data, status.error)}</p>
    {status.data && status.data.running !== true
      ? <Coming engine={engine} need="browser.request"><button type="button" disabled={busy} onClick={start}>{busy ? "Opening…" : "Open the browser"}</button></Coming>
      : null}
    <button type="button" data-local="" onClick={() => onSettings("browser")}>Browser settings</button>
  </div>;
}

const BROWSER_STATUS = { method: "GET", path: "/" };

/** The header tool's popover: computer.status or browser.request GET /, drawn once the engine has answered. */
export function ToolPopover({ tool, engine, anchor, onClose, onSettings }: { tool: "computer" | "browser"; engine: WindowEngine; anchor: RefObject<HTMLElement | null>; onClose: () => void; onSettings: (page: string) => void }) {
  const status = useRead(engine, tool === "computer" ? "computer.status" : "browser.request", tool === "computer" ? {} : BROWSER_STATUS);
  if (!status.data && !status.error) return null;
  return <Popover anchor={anchor} label={tool === "computer" ? "Computer" : "Browser"} align="end" width={280} onClose={onClose}>
    {tool === "computer" ? <ComputerPanel engine={engine} status={status} onSettings={onSettings} /> : <BrowserPanel engine={engine} status={status} onSettings={onSettings} />}
  </Popover>;
}
