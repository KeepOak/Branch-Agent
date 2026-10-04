// "Pair a phone" (preview 61-journeysp.js): device.pair.setupCode makes a one-time code and QR; while the dialog
// is open, device.pair.setupStatus says when a device used it.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { errorText } from "../library/data";
import { rec, str } from "./common";

type Access = "full" | "limited" | "node";
const ACCESS: { id: Access; name: string; line: string }[] = [
  { id: "full", name: "Everything (recommended)", line: "Its abilities plus all of Branch's controls, including settings and updates." },
  { id: "limited", name: "Chat and approvals", line: "Its abilities, chat and approvals, without settings or updates." },
  { id: "node", name: "A computer that runs tasks", line: "Connect a computer as a place Trunks can run commands and use its abilities." },
];
type Code = { setupId: string; setupCode: string; qr: string; joinUrl: string; expiresAtMs: number | null; downgraded: boolean };

export function PairDialog({ engine, close }: { engine: WindowEngine; close: () => void }) {
  const [access, setAccess] = useState<Access>("full");
  const [code, setCode] = useState<Code | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<string | null>(null);
  const make = async () => {
    setBusy(true); setError(null); setPaired(null); setCode(null);
    try {
      const r = rec(await engine.request("device.pair.setupCode", { includeQr: true, ...(access === "full" ? {} : { bootstrapProfile: access }), ...(access === "node" ? { joinUrl: true } : {}) }));
      setCode({ setupId: str(r.setupId), setupCode: str(r.setupCode), qr: str(r.qrDataUrl), joinUrl: str(r.joinUrl), expiresAtMs: typeof r.expiresAtMs === "number" ? r.expiresAtMs : null, downgraded: r.accessDowngraded === true });
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  usePairStatus(engine, code?.setupId ?? "", paired === null, setPaired);
  return <Dialog title="Pair a phone" onClose={close} testid="pair"
    footer={code ? <><button type="button" className="btn ghost" disabled={busy} onClick={() => void make()}>Make a new code</button><button type="button" className="btn pri" onClick={close}>Done</button></>
      : <><button type="button" className="btn ghost" onClick={close}>Cancel</button><button type="button" className="btn pri" disabled={busy} onClick={() => void make()}>Make the code</button></>}>
    {!code ? <div className="cz-radios" role="radiogroup" aria-label="What it may do"><b>What it may do</b>{ACCESS.map(a => <label key={a.id} className="cz-radio"><input type="radio" name="pair-access" disabled={busy} checked={access === a.id} onChange={() => setAccess(a.id)} /><span><b>{a.name}</b><small>{a.line}</small></span></label>)}</div>
      : <div className="cz-pair">
        {code.qr && <img src={code.qr} alt="Pairing code" width={180} height={180} />}
        <ol><li>Open the Branch app on your phone.</li><li>Tap <b>Pair with a computer</b>.</li><li>Point the camera at this code.</li><li>Check that both screens show <b>{code.setupCode}</b>.</li></ol>
        {code.joinUrl && <p className="cz-hint">Or open this link on that computer: <code>{code.joinUrl}</code></p>}
        <p className="cz-hint">The Branch app connects by itself once it scans the code.{code.expiresAtMs ? ` The code works once and expires at ${new Date(code.expiresAtMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""}</p>
        {code.downgraded && <p className="cz-hint">Limited for safety: this address isn't private, so the code gives chat and approvals only.</p>}
        {paired && <p role="status" className="cz-ok">Paired with {paired}.</p>}
      </div>}
    {error && <p role="alert" className="cz-error">{error}</p>}
  </Dialog>;
}

/** Asks the engine every few seconds whether the open code was used; stops once it was or the dialog closes. */
function usePairStatus(engine: WindowEngine, setupId: string, waiting: boolean, done: (name: string) => void) {
  useEffect(() => {
    if (!setupId || !waiting) return;
    let live = true;
    const tick = async () => {
      try {
        const r = rec(await engine.request("device.pair.setupStatus", { setupId }));
        const c = rec(r.completion ?? r.deliveryUncertain);
        if (live && str(c.deviceId)) done(str(c.deviceName) || "a new device");
      } catch (e) { if (live) console.warn("pair status", errorText(e)); }
    };
    const timer = setInterval(() => void tick(), 3000);
    return () => { live = false; clearInterval(timer); };
  }, [engine, setupId, waiting, done]);
}
