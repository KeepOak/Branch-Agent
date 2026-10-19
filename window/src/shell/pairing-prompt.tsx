// When a phone scans the pairing QR, the engine broadcasts device.pair.requested. The phone then
// shows pairingCheckCode(requestId) and asks whether the computer shows the same code. This overlay
// is that computer prompt: it opens itself, brings the window forward, and shows the matching code.
import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { pairingCheckCode } from "../shared/pairing-check-code";
import { Dialog } from "./Dialog";
import { notify, noticesHereOn } from "./notify";
import { plainError } from "./plain-error";
import "./pairing-prompt.css";

export const PAIRING_PROMPT_ARM_MS = 1500;

export type PairingRequest = {
  requestId: string;
  displayName: string;
  deviceId: string;
  platform: string;
  role: string;
  deviceFamily: string;
  scopes: string[];
  isRepair: boolean;
  ts?: number;
};

const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string => typeof value === "string" ? value : "";
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const SCOPE_WORDS: Record<string, string> = {
  "operator.read": "See your Trunks and conversations",
  "operator.write": "Send messages to your Trunks",
  "operator.approvals": "Answer approvals",
  "operator.questions": "Answer your Trunks’ questions",
  "operator.pairing": "Let other devices connect",
  "operator.admin": "Needs an owner’s yes: change settings",
  "operator.talk": "Talk to your Trunks by voice",
};

export function canAnswerPairing(engine: Pick<WindowEngine, "scopes">): boolean {
  return engine.scopes.includes("operator.admin") || engine.scopes.includes("operator.pairing");
}

export function readPairingRequest(value: unknown): PairingRequest | null {
  const row = rec(value);
  const requestId = str(row.requestId);
  if (!requestId) return null;
  const scopes = Array.isArray(row.scopes) ? row.scopes.map(str).filter(Boolean) : [];
  const ts = typeof row.ts === "number" && Number.isFinite(row.ts) ? row.ts : undefined;
  return {
    requestId,
    displayName: str(row.displayName),
    deviceId: str(row.deviceId),
    platform: str(row.platform),
    role: str(row.role),
    deviceFamily: str(row.deviceFamily),
    scopes,
    isRepair: row.isRepair === true,
    ...(ts !== undefined ? { ts } : {}),
  };
}

export function pairingPromptCheckCode(requestId: string): string {
  return pairingCheckCode(requestId);
}

export function pairingPromptNotice(request: PairingRequest): { title: string; body: string } {
  const name = request.displayName || "A phone";
  return { title: `${name} wants to connect`, body: `Check code ${pairingCheckCode(request.requestId)}` };
}

type DesktopBridge = { showWindow?: () => Promise<void> | void };

export function desktopPairingBridge(): DesktopBridge | undefined {
  return (window as unknown as { branchDesktop?: DesktopBridge }).branchDesktop;
}

/** Bring the Branch window (or its tray notice) forward so the check code is visible. */
export function raisePairingWindow(bridge: DesktopBridge | undefined = desktopPairingBridge()): void {
  window.focus();
  void bridge?.showWindow?.();
}

export function announcePairingRequest(
  request: PairingRequest,
  env: {
    hidden?: boolean;
    permission?: NotificationPermission;
    notify?: (title: string, opts: NotificationOptions) => { close: () => void; onclick: ((this: Notification, ev: Event) => unknown) | null };
    raise?: () => void;
  } = {},
): void {
  const hidden = env.hidden ?? (typeof document !== "undefined" && document.hidden);
  const raise = env.raise ?? (() => raisePairingWindow());
  raise();
  const permission = env.permission ?? (typeof Notification === "undefined" ? "default" : Notification.permission);
  if (!hidden || permission !== "granted" || !noticesHereOn()) return;
  const notice = pairingPromptNotice(request);
  const shown = (env.notify ?? ((title, opts) => new Notification(title, opts)))(notice.title, { body: notice.body, tag: `pair:${request.requestId}` });
  shown.onclick = () => {
    raise();
    shown.close();
  };
}

function pickLatest(pending: PairingRequest[]): PairingRequest | null {
  if (!pending.length) return null;
  return [...pending].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))[0] ?? null;
}

export function PairingCheckCode({ requestId }: { requestId: string }) {
  const code = pairingCheckCode(requestId);
  return (
    <div className="pair-check" data-testid="pair-check-code">
      <p className="pair-check-label">Check code</p>
      <p className="pair-check-value" aria-label={`Check code ${code.split("").join(" ")}`}>{code}</p>
      <p className="pair-check-hint">Your phone shows the same code. Choose Allow only if they match.</p>
    </div>
  );
}

export function PairingPrompt({ engine, ready }: { engine: WindowEngine; ready: boolean }) {
  const [request, setRequest] = useState<PairingRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const dismissed = useRef(new Set<string>());
  const shownId = useRef<string | null>(null);

  const open = (next: PairingRequest | null) => {
    if (!next || dismissed.current.has(next.requestId)) return;
    setRequest((current) => current?.requestId === next.requestId ? current : next);
  };

  useEffect(() => {
    if (!ready || !canAnswerPairing(engine)) {
      setRequest(null);
      return;
    }
    let live = true;
    const load = async () => {
      try {
        const listed = rec(await engine.request("device.pair.list", {}));
        if (!live) return;
        const pending = rows(listed.pending).map(readPairingRequest).filter((row): row is PairingRequest => row !== null)
          .filter((row) => !dismissed.current.has(row.requestId));
        open(pickLatest(pending));
      } catch { /* the prompt waits for the next event */ }
    };
    void load();
    const off = engine.onEvent(({ event, payload }) => {
      if (event === "device.pair.requested") {
        const next = readPairingRequest(payload);
        if (next) open(next);
        return;
      }
      if (event === "device.pair.resolved") {
        const id = str(rec(payload).requestId);
        if (id) {
          dismissed.current.delete(id);
          setRequest((current) => current?.requestId === id ? null : current);
        }
      }
    });
    return () => { live = false; off(); };
  }, [engine, ready]);

  useEffect(() => {
    if (!request) {
      shownId.current = null;
      setArmed(false);
      return;
    }
    const timer = setTimeout(() => setArmed(true), PAIRING_PROMPT_ARM_MS);
    if (shownId.current !== request.requestId) {
      shownId.current = request.requestId;
      announcePairingRequest(request);
    }
    return () => clearTimeout(timer);
  }, [request]);

  if (!request) return null;
  const name = request.displayName || request.deviceId || "New device";
  const asks = request.scopes.map((scope) => SCOPE_WORDS[scope] || scope).filter(Boolean);
  const decide = async (method: "device.pair.approve" | "device.pair.reject", message: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await engine.request(method, { requestId: request.requestId });
      notify(message);
      setRequest(null);
    } catch (error) {
      notify(plainError(error), { tone: "bad" });
    } finally {
      setBusy(false);
    }
  };
  const later = () => {
    dismissed.current.add(request.requestId);
    setRequest(null);
  };

  return (
    <Dialog wide title="Allow this device?" onClose={later} testid="pairing-prompt" footer={<>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void decide("device.pair.reject", "Not allowed. The device can ask again.")}>Don’t allow</button>
      <button type="button" className="btn ghost" onClick={later}>Later</button>
      <button type="button" className="btn pri" disabled={!armed || busy} onClick={() => void decide("device.pair.approve", `${name} is connected.`)}>Allow</button>
    </>}>
      <p className="pair-check-who"><b>{name}</b> wants to connect{request.isRepair ? " again" : ""}{request.platform || request.role ? ` · ${[request.platform, request.role].filter(Boolean).join(" · ")}` : ""}.</p>
      <PairingCheckCode requestId={request.requestId} />
      {asks.length ? <ul className="pair-check-asks">{asks.map((line) => <li key={line}>{line}</li>)}</ul> : <p className="pair-check-hint">It asks for no access beyond connecting.</p>}
    </Dialog>
  );
}
