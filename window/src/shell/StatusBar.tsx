import type { MouseEvent, ReactNode } from "react";
import type { RingReading } from "./status-data";
import { versionParts } from "../connect/branch-version";

export type ConnectionPhase = "connected" | "connecting" | "offline";
/** The gateway's own state (§4.9.1 item 2): its dot is green only while its health check answers. */
export type GatewayPhase = "on" | "checking" | "offline";
export type StatusItem = "connection" | "gateway" | "room" | "running" | "usage" | "version";

export type StatusFacts = {
  connection: ConnectionPhase;
  gateway: GatewayPhase;
  machineName: string;
  /** Share of the open conversation's room used (0–1), or null when the engine has not said. */
  roomUsed: number | null;
  running: number;
  version: string;
  usage: RingReading | null;
};

type Props = StatusFacts & {
  open: StatusItem | null;
  onItem: (item: StatusItem, e: MouseEvent<HTMLElement>) => void;
  /** Appearance › What's shown › The gateway in the status bar (on unless switched off). */
  gatewayShown?: boolean;
  /** Paused Trunks and live calls (after "N running"), the graphics readout (after the spacer), the pet (before the version). */
  extras?: { left?: ReactNode; gfx?: ReactNode; pet?: ReactNode };
};

/** The meter's colour by share used (§4.9.1 Room left): under 50% ok, 50–79% warn, 80–94% orange, 95% and over bad. */
export function roomColour(used: number): string {
  if (used >= 0.95) {
    return "var(--bad)";
  }
  if (used >= 0.8) {
    return "#E8912F"; // the spec's one literal (§4.9.1)
  }
  return used >= 0.5 ? "var(--warn)" : "var(--ok)";
}

const WORDS: Record<ConnectionPhase, string> = { connected: "", connecting: "Connecting", offline: "Offline" };
const RING = 2 * Math.PI * 9;

/** The 16 px usage ring (§4.9.4): % left of the window used next, amber under 15%. */
export function UsageRing({ left, low }: { left: number; low: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 22 22" aria-hidden="true" className="ring-sb">
      <circle cx="11" cy="11" r="9" fill="none" stroke="var(--line-2)" strokeWidth="3" />
      <circle cx="11" cy="11" r="9" fill="none" stroke={low ? "var(--warn)" : "var(--accent)"} strokeWidth="3" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING * (1 - Math.max(0, Math.min(100, left)) / 100)} transform="rotate(-90 11 11)" />
    </svg>
  );
}

/** Health polling and socket connectivity are independent facts. */
function GatewayStatus(p: Pick<Props, "gateway" | "open" | "onItem">) {
  const word = p.gateway === "offline" ? "Offline" : p.gateway === "checking" ? "Checking" : "";
  const dot = p.gateway === "on" ? "dot on" : p.gateway === "checking" ? "dot wait" : "dot";
  return (
    <button type="button" className="sb sb-gw" title="The gateway keeps Branch running in the background"
      aria-label="The gateway keeps Branch running in the background" data-testid="sb-gateway"
      data-hide="gateway" data-state={p.gateway} aria-expanded={p.open === "gateway"} aria-haspopup="dialog"
      onClick={(e) => p.onItem("gateway", e)}>
      <i className={dot} aria-hidden="true" />
      {word ? <span>{word}</span> : null}
      <span>Gateway</span>
    </button>
  );
}

/** The status bar (DESIGN-SPEC §4.9.1): connection, gateway, room left, running, then the usage ring and version. */
export function StatusBar(p: Props) {
  const word = WORDS[p.connection];
  const dot = p.connection === "connected" ? "dot on" : p.connection === "connecting" ? "dot wait" : "dot";
  const left = p.roomUsed === null ? null : Math.max(0, Math.round((1 - p.roomUsed) * 100));
  const item = (id: StatusItem) => ({ "aria-expanded": p.open === id, "aria-haspopup": "dialog" as const, onClick: (e: MouseEvent<HTMLElement>) => p.onItem(id, e) });
  return (
    <footer className="statusbar" data-testid="statusbar">
      <button type="button" className="sb" title="Which computer you’re talking to" data-testid="sb-connection" data-state={p.connection} {...item("connection")}>
        <i className={dot} aria-hidden="true" />
        {word ? <span>{word}</span> : null}
        <span>{p.machineName.toLowerCase()}</span>
      </button>
      {p.gatewayShown === false ? null : <GatewayStatus gateway={p.gateway} open={p.open} onItem={p.onItem} />}
      {left !== null && p.roomUsed !== null ? (
        <button type="button" className="sb" title={p.roomUsed >= 0.9 ? "How much room this conversation has left · Tidy up recommended" : "How much room this conversation has left"} data-testid="sb-room" {...item("room")}>
          <span className="sb-room-w">Room left</span>
          <span className="meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, left)}%`, background: roomColour(p.roomUsed) }} />
          </span>
          <span className="num">{left}%</span>
        </button>
      ) : null}
      <button type="button" className="sb" title="What is running in the background" data-testid="sb-running" {...item("running")}>
        <i className={p.running > 0 ? "rdot on" : "rdot"} aria-hidden="true" />
        <span className="num">{p.running} running</span>
      </button>
      {p.extras?.left}
      <span className="sb-spacer" />
      {p.extras?.gfx}
      {p.usage ? (
        <button type="button" className={p.usage.low ? "sb usage low" : "sb usage"} title="What each connection has left: 5-hour, daily and weekly limits" data-testid="sb-usage" data-hide="usage" {...item("usage")}>
          <UsageRing left={p.usage.left} low={p.usage.low} />
          <span className="hide-sm">
            {p.usage.name} · {p.usage.left}% left{p.usage.reset ? ` · ${p.usage.reset}` : ""}
          </span>
        </button>
      ) : null}
      {p.extras?.pet}
      {p.version ? (
        <button type="button" className="sb hide-sm" title={`Branch ${versionParts(p.version).detail} · Version and updates`} data-testid="sb-version" {...item("version")}>
          Branch {versionParts(p.version).short}
        </button>
      ) : null}
    </footer>
  );
}
