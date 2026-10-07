import { useEffect, useState } from "react";
import { readTargetName } from "./pre-connect-state";

export function isLocalGateway(url: string): boolean {
  try { return ["127.0.0.1", "localhost", "::1"].includes(new URL(url).hostname); }
  catch { return false; }
}

/** Before the first connection, the owner sees a status, not an implementation address. */
export function Connecting({ url, status }: { url: string; status: string }) {
  const [slow, setSlow] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, [url]);
  const remoteName = isLocalGateway(url) ? null : readTargetName(url);
  return <main className="connect" data-connection={status}>
    <span className="connect-progress" aria-hidden="true" />
    <h1>{remoteName ? `Connecting to ${remoteName}…` : isLocalGateway(url) ? "Starting Branch…" : "Connecting to another computer…"}</h1>
    {slow ? <>
      <p>This is taking longer than usual</p>
      <button type="button" className="link-k" onClick={() => setDetails(!details)} aria-expanded={details}>Details</button>
      {details ? <p className="connect-details">Gateway: {url}<br />Last status: {status}</p> : null}
    </> : null}
  </main>;
}
