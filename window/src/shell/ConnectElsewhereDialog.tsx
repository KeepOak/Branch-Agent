// Connect to a Branch elsewhere (preview ACTS.elsewherePA18 / elseBodyPA18 / elssavePA18): a dialog over the
// running window. Address or a readable setup code saves with the existing target helpers and switches; SSH,
// Test and a QR image stay disabled with the preview's off18 reasons.
import { useState } from "react";
import { saveTargetName } from "../setup/pre-connect-state";
import { shownWhy } from "./shown-why";
import { Dialog } from "./Dialog";
import "./connect-elsewhere.css";

const HINT = "Get the address or setup code from whoever runs that Branch, through a way you trust. A computer found nearby isn’t proof of who owns it. Your current connection stays until you save.";
const ADDR_HINT = "A setup code brings the address and its certificate details with it.";
const KEY_HINT = "Leave both empty only if this computer is already paired or needs no shared key. Changing where it points clears them.";
const ADDR_TECH = "Use wss:// for public addresses; ws:// works for this computer, your network, .local and Tailscale addresses.";
const EXPIRED = "This setup code has expired. Ask for a new one.";
const UNREADABLE = "This isn’t a setup code Branch can read.";
const EMPTY = "Type the address or paste a setup code.";
const SSH_OFF = "Starts an SSH tunnel from the Branch app on your computer.";
const TEST_OFF = "Tests the connection from the Branch app on your computer.";
const QR_OFF = "Reads the code from a picture in the Branch app on your computer.";

type SetupCode = { url: string; key: boolean } | { expired: true } | { bad: true };

/** Preview setupCodePA18: a pasted setup code, or null when the field is an address. */
export function readSetupCode(v: string): SetupCode | null {
  const trimmed = (v || "").trim();
  if (!trimmed || /^wss?:\/\//i.test(trimmed) || (/^[\w.-]+(:\d+)?$/.test(trimmed) && trimmed.length < 20)) return null;
  try {
    const j = JSON.parse(atob(trimmed.replace(/-/g, "+").replace(/_/g, "/"))) as { url?: unknown; exp?: unknown; token?: unknown; password?: unknown };
    if (!j.url) return { bad: true };
    if (j.exp && Number(j.exp) * 1000 < Date.now()) return { expired: true };
    return { url: String(j.url), key: !!(j.token || j.password) };
  } catch {
    return trimmed.length > 24 ? { bad: true } : null;
  }
}

function gatewayUrl(raw: string): string | null {
  const v = raw.trim();
  if (/^wss?:\/\/\S+$/.test(v)) return v;
  if (/^[\w.-]+(:\d+)?$/.test(v)) return `wss://${v}`;
  return null;
}

function hostOf(target: string): string {
  return target.replace(/^wss?:\/\//, "").replace(/^[^@]*@/, "").replace(/[:/].*$/, "");
}

type Props = { onClose: () => void };

export function ConnectElsewhereDialog({ onClose }: Props) {
  const [addr, setAddr] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const code = readSetupCode(addr);
  const save = () => {
    if (code && "expired" in code) { setError(EXPIRED); return; }
    if (code && "bad" in code) { setError(UNREADABLE); return; }
    const target = ((code && "url" in code ? code.url : addr) || "").trim();
    const url = gatewayUrl(target);
    if (!target || !url) { setError(EMPTY); return; }
    const host = hostOf(target);
    if (host) saveTargetName(url, host);
    window.dispatchEvent(new CustomEvent("branch:switch-computer", { detail: { url, ...(key.trim() ? { key: key.trim() } : {}) } }));
    onClose();
  };
  const line = error || (code && "expired" in code ? EXPIRED : code && "bad" in code ? UNREADABLE : "");
  return (
    <Dialog title="Connect to a Branch elsewhere" onClose={onClose} testid="connect-elsewhere" footer={
      <>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn ghost" disabled title={shownWhy(TEST_OFF)}>Test</button>
        <button type="button" className="btn pri" onClick={save}>Save connection</button>
      </>
    }>
      <p className="hint">{HINT}</p>
      <div className="field">
        <span className="field-label">Connect by</span>
        <span className="seg" role="group" aria-label="Connect by">
          <button type="button" aria-pressed="true">Address or setup code</button>
          <button type="button" aria-pressed="false" disabled title={shownWhy(SSH_OFF)}>SSH tunnel</button>
        </span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="elsaPA18">Address or setup code</label>
        <input id="elsaPA18" className="inp" value={addr} placeholder="wss://branch.example" autoComplete="off" aria-label="Address or setup code" onChange={(e) => { setAddr(e.target.value); setError(""); }} />
        <p className="hint">{ADDR_HINT}</p>
      </div>
      {code && "url" in code ? (
        <div className="status els-code">
          <p>Gateway: {code.url}</p>
          <p>Key: {code.key ? "included" : "not included"}</p>
        </div>
      ) : null}
      <button type="button" className="btn ghost sm" disabled title={shownWhy(QR_OFF)}>Use a QR image…</button>
      <div className="field">
        <label className="field-label" htmlFor="elsk-keyPA18">Gateway key</label>
        <input id="elsk-keyPA18" className="inp" type="password" value={key} placeholder="Paste it once" autoComplete="off" aria-label="Gateway key: paste it once" onChange={(e) => setKey(e.target.value)} />
      </div>
      <p className="hint">{KEY_HINT}</p>
      <p className="hint">{ADDR_TECH}</p>
      {line ? <p className="field-error" role="alert">{line}</p> : null}
    </Dialog>
  );
}
