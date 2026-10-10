import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { RingReading } from "./status-data";
import { BRANCH_VERSION_TIP, branchVersionDetail, branchVersionLabel } from "../connect/branch-version";
import "./status.css";

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
  readyVersion?: string | null;
  usage: RingReading | null;
};

type Props = StatusFacts & {
  open: StatusItem | null;
  onItem: (item: StatusItem, e: MouseEvent<HTMLElement>) => void;
  /** Appearance › What's shown › The gateway in the status bar (on unless switched off). */
  gatewayShown?: boolean;
  usageShown?: boolean;
  /** Paused Trunks and live calls (after "N running"), and the graphics readout (after the spacer). */
  extras?: { left?: ReactNode; gfx?: ReactNode };
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
/** Preview GLYPH_T5.ringUse: 16px viewBox, r=6, stroke 2, arc 37.7. */
export const USAGE_RING_ARC = 37.7;
export function usageRingDash(left: number): string {
  return `${((Math.max(0, Math.min(100, left)) / 100) * USAGE_RING_ARC).toFixed(1)} 40`;
}
/** Preview colour: <15% left bad, <35% warn, else ok. */
export function usageRingColour(left: number | null): string {
  if (left === null) {
    return "var(--line-2)";
  }
  if (left < 15) {
    return "var(--bad)";
  }
  return left < 35 ? "var(--warn)" : "var(--ok)";
}

type Glyph = "computer" | "gateway" | "running" | "update";
function StatusGlyph({ kind, colour = "currentColor", value = 0 }: { kind: Glyph; colour?: string; value?: number }) {
  const common = { className: `status-glyph status-glyph-${kind}`, viewBox: "0 0 16 16", "aria-hidden": true as const };
  if (kind === "computer") return <svg {...common}><rect x="1.8" y="3" width="12.4" height="8.2" rx="1.4"/><path d="M5.6 14h4.8M8 11.2V14"/><circle cx="12.6" cy="4.6" r="2.1" fill={colour} stroke="var(--side)" strokeWidth="1"/></svg>;
  if (kind === "gateway") return <svg {...common}><circle cx="3.4" cy="8" r="2"/><circle cx="12.6" cy="8" r="2"/><path d="M5.4 8h5.2"/><circle className="status-gateway-pulse" cx="8" cy="8" r="1.3" fill={colour} stroke="none"/></svg>;
  if (kind === "running") return <svg {...common}><circle className={value ? "status-running-ring" : undefined} cx="8" cy="8" r="6.2" stroke={colour}/><path d="M6.6 5.4v5.2l4.2-2.6z" fill={colour} stroke={colour} strokeWidth="1"/></svg>;
  return <svg {...common}><path d="M5.2 14.6V3.6M5.2 9.6c0-2.6 5.6-1.8 5.6-5.4"/><circle cx="5.2" cy="2.6" r="1.1"/><circle cx="10.8" cy="3.2" r="1.1"/></svg>;
}

/** Preview GLYPH_T5.ringUse: 16px viewBox, r=6, stroke-width 2. */
export function UsageRing({ left }: { left: number | null }) {
  const colour = usageRingColour(left);
  return (
    <svg className="gT5" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="var(--line-2)" fill="none" strokeWidth="2" />
      {left === null ? null : <circle cx="8" cy="8" r="6" fill="none" stroke={colour} strokeWidth="2" strokeDasharray={usageRingDash(left)} transform="rotate(-90 8 8)" strokeLinecap="round" />}
    </svg>
  );
}

/** Health polling and socket connectivity are independent facts. */
function GatewayStatus(p: Pick<Props, "gateway" | "open" | "onItem">) {
  const word = p.gateway === "offline" ? "stopped" : p.gateway === "checking" ? "checking" : "running";
  const colour = p.gateway === "on" ? "var(--ok)" : p.gateway === "checking" ? "var(--warn)" : "var(--bad)";
  return (
    <button type="button" className="sb status-symbol sb-gw" title={`Gateway · ${word}`}
      aria-label={`Gateway · ${word}`} data-testid="sb-gateway"
      data-hide="gateway" data-state={p.gateway} aria-expanded={p.open === "gateway"} aria-haspopup="dialog"
      onClick={(e) => p.onItem("gateway", e)}>
      <StatusGlyph kind="gateway" colour={colour} />
    </button>
  );
}

/** The status bar (DESIGN-SPEC §4.9.1): connection, gateway, room left, running, then the usage ring and version. */
export function StatusBar(p: Props) {
  const [usageExpanded, setUsageExpanded] = useState(true);
  const usageRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!usageExpanded || p.open === "usage") return;
    let timer: number;
    const arm = () => { timer = window.setTimeout(() => usageRef.current?.matches(":hover") ? arm() : setUsageExpanded(false), 5000); };
    arm();
    return () => window.clearTimeout(timer);
  }, [usageExpanded, p.open]);
  const connectionWord = WORDS[p.connection] || "Online";
  // The computer's name lives in the top bar's switcher; here the label says only the state.
  const connectionLabel = p.connection === "connected" ? "Online · you are here" : connectionWord;
  const connectionColour = p.connection === "connected" ? "var(--ok)" : p.connection === "connecting" ? "var(--warn)" : "var(--bad)";
  const left = p.roomUsed === null ? null : Math.max(0, Math.round((1 - p.roomUsed) * 100));
  const roomTip = left === null ? "Context" : `Context: ${left}% left. The room this conversation has for new messages. Click for details.`;
  const item = (id: StatusItem) => ({ "aria-expanded": p.open === id, "aria-haspopup": "dialog" as const, onClick: (e: MouseEvent<HTMLElement>) => p.onItem(id, e) });
  const usageLine = p.usage ? `${p.usage.name} · ${p.usage.left}% left${p.usage.reset ? ` · ${p.usage.reset}` : ""}` : "Usage";
  const usageLabel = p.usage ? `${usageLine}. Enter opens every account.` : "Usage · no account limits yet. Enter opens every account.";
  const openUsage = (e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    setUsageExpanded(true);
    p.onItem("usage", e as MouseEvent<HTMLElement>);
  };
  const onUsageClick = (e: MouseEvent<HTMLElement>) => {
    if (!usageExpanded) {
      setUsageExpanded(true);
      return;
    }
    openUsage(e);
  };
  return (
    <footer className="statusbar" data-testid="statusbar">
      <button type="button" className="sb status-symbol" title={`${p.machineName} · ${connectionWord}`} aria-label={`${p.machineName} · ${connectionWord}`} data-testid="sb-connection" data-state={p.connection} {...item("connection")}>
        <StatusGlyph kind="computer" colour={connectionColour} />
        <span className="status-label">{connectionLabel}</span>
      </button>
      {p.gatewayShown === false ? null : <GatewayStatus gateway={p.gateway} open={p.open} onItem={p.onItem} />}
      {left !== null && p.roomUsed !== null ? (
        <button type="button" className="sb status-symbol sb-room" title={roomTip} aria-label={roomTip} data-testid="sb-room" {...item("room")}>
          <span className="status-label">Context</span>
          <span className="ctx-meter" aria-hidden="true"><span className="ctx-meter-fill" style={{ width: `${left}%`, background: roomColour(p.roomUsed) }} /></span>
          <span className="status-number">{left}% left</span>
        </button>
      ) : null}
      <button type="button" className="sb status-symbol" title={p.running ? `${p.running} running` : "Nothing running"} aria-label={p.running ? `${p.running} running` : "Nothing running"} data-testid="sb-running" {...item("running")}>
        <StatusGlyph kind="running" colour={p.running ? "var(--ok)" : "currentColor"} value={p.running} />
        <span className="status-number">{p.running}</span>
      </button>
      {p.extras?.left}
      <span className="sb-spacer" />
      {p.extras?.gfx}
      {p.usageShown === false ? null : (
        <button ref={usageRef} type="button" className={`sb usage status-ring useT5 glyphT5${p.usage?.low ? " low" : ""}${usageExpanded ? "" : " collapsedT5"}`} title="Click for every account" aria-label={usageLabel} aria-expanded={p.open === "usage"} aria-haspopup="dialog" data-testid="sb-usage" data-hide="usage" onPointerEnter={() => setUsageExpanded(true)} onClick={onUsageClick} onKeyDown={(e) => { if (e.key !== "Enter") return; e.preventDefault(); e.stopPropagation(); openUsage(e); }}>
          <UsageRing left={p.usage?.left ?? null} />
          <span className="useTxtT5 status-ring-label">{usageLine}</span>
        </button>
      )}
      {p.version ? (
        <button type="button" className="sb status-symbol" title={BRANCH_VERSION_TIP} aria-label={`${branchVersionLabel(p.version)}${p.readyVersion ? ` · ${branchVersionDetail(p.readyVersion)} ready` : ""}`} data-testid="sb-version" {...item("version")}>
          <StatusGlyph kind="update" />
          <span className="status-label">{branchVersionLabel(p.version)}</span>
        </button>
      ) : null}
    </footer>
  );
}
