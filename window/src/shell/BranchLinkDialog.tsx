import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { pairingCheckCode } from "../shared/pairing-check-code";
import { Dialog } from "./Dialog";

type Code = { setupId: string; value: string; qr: string; expiresAtMs: number; access: string };
type Join = { pending: boolean; requestId?: string; link?: { url: string; name: string } };
type SavedLink = { url: string; name: string };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const errorText = (value: unknown) => value instanceof Error ? value.message : String(value);
const isUnreachableGateway = (value: unknown) => /Gateway is only bound to loopback|PAIRING_GATEWAY_LOOPBACK_ERROR/i.test(errorText(value));

/** Pair two Branch installs as teammates: issue an invite here, or join an invite issued there. */
export function BranchLinkDialog({ engine, onClose, onLinked, onOpenGatewaySettings }: { engine: WindowEngine; onClose: () => void; onLinked?: () => void; onOpenGatewaySettings?: () => void }) {
  const [mode, setMode] = useState<"invite" | "join">("invite");
  const [code, setCode] = useState<Code | null>(null);
  const [incoming, setIncoming] = useState("");
  const [name, setName] = useState("");
  const [join, setJoin] = useState<Join | null>(null);
  const [paired, setPaired] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unreachable, setUnreachable] = useState(false);
  const [savedLinks, setSavedLinks] = useState<SavedLink[]>([]);
  const onLinkedRef = useRef(onLinked);
  onLinkedRef.current = onLinked;
  useEffect(() => {
    let live = true;
    void engine.request("graft.links.list", {}).then((result) => {
      const rows = record(result).links;
      if (live && Array.isArray(rows)) setSavedLinks(rows.filter((row): row is SavedLink =>
        !!row && typeof row.url === "string" && typeof row.name === "string"));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [engine]);
  const forget = async (url: string) => {
    setBusy(true); setError("");
    try {
      await engine.request("graft.links.forget", { url });
      setSavedLinks((rows) => rows.filter((row) => row.url !== url));
      onLinkedRef.current?.();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const invite = async () => {
    setBusy(true); setError(""); setUnreachable(false); setPaired(""); setCode(null);
    try {
      const result = record(await engine.request("device.pair.setupCode", { includeQr: true, bootstrapProfile: "limited" }));
      setCode({ setupId: String(result.setupId ?? ""), value: String(result.setupCode ?? ""), qr: String(result.qrDataUrl ?? ""), expiresAtMs: Number(result.expiresAtMs ?? 0), access: String(result.access ?? "limited") });
    } catch (cause) { if (isUnreachableGateway(cause)) setUnreachable(true); else setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const tryJoin = async () => {
    setBusy(true); setError("");
    try {
      const result = record(await engine.request("graft.join", { code: incoming.trim(), ...(name.trim() ? { name: name.trim() } : {}) }));
      const next: Join = { pending: result.pending === true, requestId: typeof result.requestId === "string" ? result.requestId : undefined,
        link: result.link && typeof result.link === "object" ? record(result.link) as Join["link"] : undefined };
      setJoin(next);
      if (!next.pending) {
        if (next.link) setSavedLinks((rows) => [next.link!, ...rows.filter((row) => row.url !== next.link?.url)]);
        onLinkedRef.current?.();
      }
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
        if (completion.deviceId) { setPaired(String(completion.deviceName || "Another Branch")); onLinkedRef.current?.(); }
      }).catch(() => undefined);
    }, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [engine, code?.setupId, paired]);
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
        <p className="cz-hint">Works once, until {new Date(code.expiresAtMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Approve the other Branch here before it connects.</p>
        <p>What it may do: {code.access === "limited" ? "limited, non-administrator access, including conversations and approval requests" : code.access}. Review its exact permissions and check code in the approval request before letting it in.</p></>}
      {unreachable && <div role="alert"><p>This computer can’t be reached by another computer yet. In Gateway settings, choose “My network” or “Tailscale” under “Who can reach the Gateway”, then make a new code.</p>
        {onOpenGatewaySettings && <button type="button" className="btn sm" onClick={onOpenGatewaySettings}>Open Gateway settings</button>}</div>}
      {paired && <p role="status" className="cz-ok">Paired with {paired}. Its Trunks appear in Connected agents.</p>}
    </div> : <div className="cz-pair">
      <p>Get a code from the other Branch through a way you trust. This Branch and its Trunks will appear to that teammate after they approve it. Check the device name on both Branches before approval.</p>
      <label className="cz-field"><span>Setup code</span><textarea className="inp" aria-label="Setup code" value={incoming} onChange={event => setIncoming(event.target.value)} /></label>
      <label className="cz-field"><span>Name on the other Branch (optional)</span><input className="inp" value={name} onChange={event => setName(event.target.value)} /></label>
      {join?.pending && <p role="status">Waiting for approval on the other Branch. {join.requestId ? <>Compare check code <strong>{pairingCheckCode(join.requestId)}</strong> with the “Allow this device?” request there before approving.</> : null}</p>}
      {join && !join.pending && <p role="status" className="cz-ok">Linked to {join.link?.url}. Your Trunks are now available there.</p>}
    </div>}
    {savedLinks.length > 0 && <section aria-label="Linked Branches"><h3>Linked Branches</h3>
      {savedLinks.map((link) => <div key={link.url} className="branch-link-code"><span>{link.name}</span>
        <button type="button" className="btn sm" disabled={busy} onClick={() => void forget(link.url)}>Forget link</button></div>)}
      <p className="cz-hint">Forgetting stops this Branch from connecting there. To remove its access on the other Branch too, disconnect this device there.</p>
    </section>}
    {error && <p role="alert" className="cz-error">{error}</p>}
  </Dialog>;
}
