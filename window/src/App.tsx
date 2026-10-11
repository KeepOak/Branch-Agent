import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { startKey, type DesktopBridge } from "./connect/start-key";
import { SaplingSession } from "./connect/session";
import { installUiEventLog } from "./diagnostics/ui-log";
import { loadRoute } from "./places-nav/routes";
import { WindowShell } from "./shell/WindowShell";
import { PreConnect, type PreConnectState } from "./setup/PreConnect";
import { LOCAL_ADDRESS, readTarget, saveTarget } from "./setup/pre-connect-state";
import { Connecting } from "./setup/Connecting";
import { ConnectElsewhereDialog } from "./shell/ConnectElsewhereDialog";
import "./shell/shell.css";
import "./shell/frame.css";
import "./shell/controls.css";

/** Set by the desktop app's preload, only when the window runs inside the desktop app. */
const desktop: DesktopBridge | undefined = (window as { branchDesktop?: DesktopBridge }).branchDesktop;
const BUILT_IN: string | undefined = desktop?.gatewayUrl ?? import.meta.env.VITE_GATEWAY_URL;
/** This computer's gateway: the desktop app's, the build's, or the engine's own default address. */
const LOCAL = BUILT_IN ?? LOCAL_ADDRESS;
const RESIDENT_URL_KEY = "branch.window.residentUrl";

export function App() {
  useEffect(() => installUiEventLog(), []);
  const [url, setUrl] = useState<string | null>(() => readTarget() ?? BUILT_IN ?? null);
  const [typed, setTyped] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [elsewhere, setElsewhere] = useState(false);
  useEffect(() => {
    // The machine menu's "Connect to a Branch elsewhere…" opens the preview's small dialog over this window.
    const open = () => setElsewhere(true);
    window.addEventListener("branch:connect-elsewhere", open);
    return () => window.removeEventListener("branch:connect-elsewhere", open);
  }, []);
  useEffect(() => {
    const switchComputer = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: unknown; key?: unknown }>).detail;
      const next = detail?.url;
      if (typeof next !== "string" || !/^wss?:\/\/\S+$/.test(next)) return;
      sessionStorage.removeItem(RESIDENT_URL_KEY);
      saveTarget(next === LOCAL ? null : next);
      setTyped(typeof detail?.key === "string" ? detail.key : null);
      setUrl(next);
      setAttempt(n => n + 1);
    };
    window.addEventListener("branch:switch-computer", switchComputer);
    return () => window.removeEventListener("branch:switch-computer", switchComputer);
  }, []);
  const connect = (to: string, key: string) => {
    if (to !== url) sessionStorage.removeItem(RESIDENT_URL_KEY);
    saveTarget(to === LOCAL ? null : to);
    setTyped(key.trim());
    setUrl(to);
    setElsewhere(false);
    setAttempt((n) => n + 1);
  };
  const key = url ? startKey(url, typed, desktop) : null;
  const overlay = elsewhere ? <ConnectElsewhereDialog onClose={() => setElsewhere(false)} /> : null;
  if (!url || key === null) {
    const state: PreConnectState = url && key === null ? { kind: "key" } : { kind: "address" };
    return <>
      <PreConnect local={LOCAL} address={url} state={state} busy={false} onConnect={connect} onRetry={() => setAttempt((n) => n + 1)} />
      {overlay}
    </>;
  }
  return <>
    <Window key={`${url}#${attempt}`} url={url} sharedToken={key || undefined} onConnect={connect} onRetry={() => setAttempt((n) => n + 1)} />
    {overlay}
  </>;
}

/** The conversation the window last showed (§3.3 "Reopen where you were"). */
function savedConversation(): string | null {
  const route = loadRoute();
  return route.kind === "chat" ? route.key : null;
}

type WindowProps = { url: string; sharedToken?: string; onConnect: (url: string, key: string) => void; onRetry: () => void };

function Window({ url, sharedToken, onConnect, onRetry }: WindowProps) {
  const session = useMemo(() => new SaplingSession(url, sharedToken, savedConversation()), [url, sharedToken]);
  const [activeUrl, setActiveUrl] = useState(url);
  useEffect(() => {
    session.start();
    // The desktop app updated the engine underneath this window; reconnect without waiting for the backoff.
    const engineReady = () => session.reconnectNow();
    const engineHandoff = (event: Event) => {
      const next = (event as CustomEvent<{ gatewayUrl?: unknown }>).detail?.gatewayUrl;
      // Page scripts can dispatch CustomEvents too; only the isolated preload's current target is authoritative.
      if (typeof next !== "string" || !/^ws:\/\/127\.0\.0\.1:\d+\/?$/.test(next) || next !== desktop?.getGatewayUrl?.()) return;
      session.handoff(next, desktop?.gatewayToken);
      setActiveUrl(next);
    };
    window.addEventListener("branch:engine-ready", engineReady);
    window.addEventListener("branch:engine-handoff", engineHandoff);
    return () => {
      window.removeEventListener("branch:engine-ready", engineReady);
      window.removeEventListener("branch:engine-handoff", engineHandoff);
      session.stop();
    };
  }, [session]);
  const s = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [everConnected, setEverConnected] = useState(() => {
    const residentUrl = sessionStorage.getItem(RESIDENT_URL_KEY);
    if (!residentUrl) return false;
    try {
      // Preload's handoff URL has a trailing slash; desktop info after reload may not.
      return new URL(residentUrl).href === new URL(url).href;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (s.status.phase === "connected") {
      sessionStorage.setItem(RESIDENT_URL_KEY, activeUrl);
      setEverConnected(true);
    }
  }, [s.status.phase, activeUrl]);
  // Once connected, the frame stays up through reconnects; the status bar says "Offline" or "Connecting" (§3.5).
  if (everConnected || s.status.phase === "connected") {
    return <WindowShell session={session} url={activeUrl} />;
  }
  const status = s.status;
  if (status.phase === "pairing" || status.phase === "failed") {
    const state: PreConnectState = status.phase === "pairing" ? { kind: "pairing", requestId: status.requestId } : { kind: "failed", code: status.code, message: status.message };
    return <PreConnect local={LOCAL} address={url} state={state} busy={false} onConnect={onConnect} onRetry={onRetry} />;
  }
  return <Connecting url={url} status={status.phase} />;
}
