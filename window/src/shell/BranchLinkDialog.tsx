import { useEffect, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { Dialog } from "./Dialog";

type Code = { setupId: string; value: string; qr: string; expiresAtMs: number };
type Join = { pending: boolean; requestId?: string; link?: { url: string; name: string } };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const errorText = (value: unknown) => value instanceof Error ? value.message : String(value);

/** Pair two Branch installs as teammates: issue an invite here, or join an invite issued there. */
export function BranchLinkDialog({ engine, onClose, onLinked }: { engine: WindowEngine; onClose: () => void; onLinked?: () => void }) {
  const [mode, setMode] = useState<"invite" | "join">("invite");
  const [code, setCode] = useState<Code | null>(null);
  const [incoming, setIncoming] = useState("");
  const [name, setName] = useState("");
  const [join, setJoin] = useState<Join | null>(null);
  const [paired, setPaired] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const invite = async () => {
    setBusy(true); setError(""); setPaired("");
    try {
      const result = record(await engine.request("device.pair.setupCode", { includeQr: true }));
      setCode({ setupId: String(result.setupId ?? ""), value: String(result.setupCode ?? ""), qr: String(result.qrDataUrl ?? ""), expiresAtMs: Number(result.expiresAtMs ?? 0) });
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const tryJoin = async () => {
    setBusy(true); setError("");
    try {
      const result = record(await engine.request("graft.join", { code: incoming.trim(), ...(name.trim() ? { name: name.trim() } : {}) }));
      const next: Join = { pending: result.pending === true, requestId: typeof result.requestId === "string" ? result.requestId : undefined,
        link: result.link && typeof result.link === "object" ? record(result.link) as Join["link"] : undefined };
      setJoin(next);
      if (!next.pending) onLinked?.();
    } catch (cause) { setJoin(null); setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!code?.setupId || paired) return;
    let live = true;
    const timer = setInterval(() => {
      void engine.request("device.pair.setupStatus", { setupId: code.setupId }).then((result) => {
        if (!live) return;
        const completion = record(record(result).completion);
        if (completion.deviceId) { setPaired(String(completion.deviceName || "Another Branch")); onLinked?.(); }
      }).catch(() => undefined);
    }, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [engine, code?.setupId, paired, onLinked]);
  useEffect(() => {
    if (!join?.pending || busy) return;
    const timer = setTimeout(() => void tryJoin(), 3000);
    return () => clearTimeout(timer);
  }, [join, busy]);
  return <Dialog title="Link another Branch" onClose={onClose} testid="branch-link"
    footer={<><button type="button" className="btn ghost" onClick={onClose}>{join && !join.pending || paired ? "Done" : "Cancel"}</button>
      {mode === "invite" ? <button type="button" className="btn pri" disabled={busy} onClick={() => void invite()}>{code ? "Make a new code" : "Make a code"}</button>
        : join?.pending === false ? null : <button type="button" className="btn pri" disabled={busy || !incoming.trim()} onClick={() => void tryJoin()}>{join?.pending ? "Check again" : "Link this Branch"}</button>}</>}>
    <div className="branch-link-modes" role="group" aria-label="Link direction">
      <button type="button" className="btn sm" aria-pressed={mode === "invite"} onClick={() => (setMode("invite"), setError(""))}>Invite a teammate</button>
      <button type="button" className="btn sm" aria-pressed={mode === "join"} onClick={() => (setMode("join"), setError(""))}>Use their code</button>
    </div>
    {mode === "invite" ? <div className="cz-pair">
      <p>Give this one-time invitation to the person at the other Branch. They can paste it in Branch › Link another Branch. The QR carries the same invitation.</p>
      {code && <><div className="branch-link-code"><code data-testid="branch-invite-code">{code.value}</code>
        <button type="button" className="btn sm" onClick={() => {
          if (!navigator.clipboard?.writeText) { setError("Clipboard unavailable. Select the code to copy it."); return; }
          void navigator.clipboard.writeText(code.value).catch(cause => setError(errorText(cause)));
        }}>Copy code</button></div>
        {code.qr && <img src={code.qr} alt="QR code to link another Branch" width={180} height={180} />}
        <p className="cz-hint">Works once, until {new Date(code.expiresAtMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. You approve the other Branch's access here if asked.</p></>}
      {paired && <p role="status" className="cz-ok">Paired with {paired}. Its Trunks appear in Grafts.</p>}
    </div> : <div className="cz-pair">
      <p>Get a code from the other Branch through a way you trust. This Branch and its Trunks will appear to that teammate after they approve it.</p>
      <label className="cz-field"><span>Setup code</span><textarea className="inp" aria-label="Setup code" value={incoming} onChange={event => setIncoming(event.target.value)} /></label>
      <label className="cz-field"><span>Name on the other Branch (optional)</span><input className="inp" value={name} onChange={event => setName(event.target.value)} /></label>
      {join?.pending && <p role="status">Waiting for approval on the other Branch. Request {join.requestId}.</p>}
      {join && !join.pending && <p role="status" className="cz-ok">Linked to {join.link?.url}. Your Trunks are now available there.</p>}
    </div>}
    {error && <p role="alert" className="cz-error">{error}</p>}
  </Dialog>;
}
