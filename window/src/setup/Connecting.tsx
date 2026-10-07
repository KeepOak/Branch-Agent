import { useEffect, useState } from "react";
import { isLocalTarget, readTargetName } from "./pre-connect-state";

/** Before the first connection, the owner sees a status, not an implementation address. */
export function Connecting({ url, status }: { url: string; status: string }) {
  const [slow, setSlow] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, [url]);
  const remoteName = isLocalTarget(url) ? null : readTargetName(url);
  return <main className="connect" data-connection={status}>
    <span className="connect-progress" role="progressbar" aria-label="Connecting" />
    <h1>{remoteName ? `Connecting to ${remoteName}…` : isLocalTarget(url) ? "Starting Branch…" : "Connecting to another computer…"}</h1>
    {slow ? <>
      <p>This is taking longer than usual</p>
      <button type="button" className="link-k" onClick={() => setDetails(!details)} aria-expanded={details}>Details</button>
      {details ? <p className="connect-details">Gateway: {url}<br />Status: {status}</p> : null}
    </> : null}
  </main>;
}
