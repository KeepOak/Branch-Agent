import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { startKey, type DesktopBridge } from "./connect/start-key";
import { SaplingSession } from "./connect/session";
import { loadRoute } from "./places-nav/routes";
import { WindowShell } from "./shell/WindowShell";
import { PreConnect, type PreConnectState } from "./setup/PreConnect";
import { isLocalTarget, LOCAL_ADDRESS, readTarget, readTargetName, saveTarget } from "./setup/pre-connect-state";
import "./shell/shell.css";
import "./shell/frame.css";
import "./shell/controls.css";

/** Set by the desktop app's preload, only when the window runs inside the desktop app. */
const desktop: DesktopBridge | undefined = (window as { branchDesktop?: DesktopBridge }).branchDesktop;
const BUILT_IN: string | undefined = desktop?.gatewayUrl ?? import.meta.env.VITE_GATEWAY_URL;
/** This computer's gateway: the desktop app's, the build's, or the engine's own default address. */
const LOCAL = BUILT_IN ?? LOCAL_ADDRESS;

export function App() {
  const [url, setUrl] = useState<string | null>(() => readTarget() ?? BUILT_IN ?? null);
  const [typed, setTyped] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [elsewhere, setElsewhere] = useState(false);
  useEffect(() => {
    // The machine menu's "Connect to a Branch elsewhere…" comes back here, at Where should Branch run? (§4.1.3).
    const open = () => setElsewhere(true);
    window.addEventListener("branch:connect-elsewhere", open);
    return () => window.removeEventListener("branch:connect-elsewhere", open);
  }, []);
  const connect = (to: string, key: string) => {
    saveTarget(to === LOCAL ? null : to);
    setTyped(key.trim());
    setUrl(to);
    setElsewhere(false);
    setAttempt((n) => n + 1);
  };
  const key = url ? startKey(url, typed, desktop) : null;
  if (!url || key === null || elsewhere) {
    const state: PreConnectState = url && key === null && !elsewhere ? { kind: "key" } : { kind: "address" };
    return <PreConnect local={LOCAL} address={url} state={state} busy={false} startAtWhere={elsewhere} onConnect={connect} onRetry={() => setAttempt((n) => n + 1)} />;
  }
  return <Window key={`${url}#${attempt}`} url={url} sharedToken={key || undefined} onConnect={connect} onRetry={() => setAttempt((n) => n + 1)} />;
}

/** The conversation the window last showed (§3.3 "Reopen where you were"). */
function savedConversation(): string | null {
  const route = loadRoute();
  return route.kind === "chat" ? route.key : null;
}

type WindowProps = { url: string; sharedToken?: string; onConnect: (url: string, key: string) => void; onRetry: () => void };

function Window({ url, sharedToken, onConnect, onRetry }: WindowProps) {
  const session = useMemo(() => new SaplingSession(url, sharedToken, savedConversation()), [url, sharedToken]);
  useEffect(() => {
    session.start();
    // The desktop app updated the engine underneath this window; reconnect without waiting for the backoff.
    const engineReady = () => session.reconnectNow();
    window.addEventListener("branch:engine-ready", engineReady);
    return () => {
      window.removeEventListener("branch:engine-ready", engineReady);
      session.stop();
    };
  }, [session]);
  const s = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => {
    if (s.status.phase === "connected") {
      setEverConnected(true);
    }
  }, [s.status.phase]);
  // Once connected, the frame stays up through reconnects; the status bar says "Offline" or "Connecting" (§3.5).
  if (everConnected || s.status.phase === "connected") {
    return <WindowShell session={session} url={url} />;
  }
  const status = s.status;
  if (status.phase === "pairing" || status.phase === "failed") {
    const state: PreConnectState = status.phase === "pairing" ? { kind: "pairing", requestId: status.requestId } : { kind: "failed", code: status.code, message: status.message };
    return <PreConnect local={LOCAL} address={url} state={state} busy={false} onConnect={onConnect} onRetry={onRetry} />;
  }
  return <StartingConnection url={url} phase={status.phase} />;
}

export function StartingConnection({ url, phase }: { url: string; phase: string }) {
  const [slow, setSlow] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main className="connect" data-connection={phase}>
      <span className="connect-spinner" role="progressbar" aria-label="Connecting" />
      <p>{isLocalTarget(url) ? "Starting Branch…" : `Connecting to ${readTargetName(url) ?? "another computer"}…`}</p>
      {slow ? <>
        <p>This is taking longer than usual</p>
        <button type="button" className="link-k" onClick={() => setDetails((open) => !open)} aria-expanded={details}>Details</button>
        {details ? <div className="connect-details"><div>Gateway: {url}</div><div>Status: {phase}</div></div> : null}
      </> : null}
    </main>
  );
}
