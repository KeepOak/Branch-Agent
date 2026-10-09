import { useEffect, useState } from "react";
import { isLocalTarget, readTargetName } from "./pre-connect-state";

/** Before the first connection, the owner sees a status, not an implementation address. */
export function Connecting({ url, status, error, onRetry }: { url: string; status: string; error?: string; onRetry: () => void }) {
  const [slow, setSlow] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    setSlow(false);
    setDetails(false);
    const timer = setTimeout(() => setSlow(true), 8_000);
    return () => clearTimeout(timer);
  }, [url]);
  const remoteName = isLocalTarget(url) ? null : readTargetName(url);
  return <main className="connect" data-connection={status}>
    {!slow && <span className="connect-progress" role="progressbar" aria-label="Connecting" />}
    <h1>{slow ? isLocalTarget(url) ? "Can't reach Branch on this computer." : `Can't reach Branch on ${remoteName || "that computer"}.` : remoteName ? `Connecting to ${remoteName}…` : isLocalTarget(url) ? "Starting Branch…" : "Connecting to another computer…"}</h1>
    {slow ? <>
      <p>Check the token, the gateway address, and that the gateway service is running.</p>
      <button type="button" className="btn pri" onClick={onRetry}>Try again</button>
      <button type="button" className="btn ghost" onClick={() => setDetails(!details)} aria-expanded={details}>Show details</button>
      {details ? <p className="connect-details">Gateway: {url}<br />Status: {status}{error ? <><br />{error}</> : null}</p> : null}
    </> : null}
  </main>;
}
