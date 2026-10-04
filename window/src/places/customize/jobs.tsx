// Job names and descriptions copied from the authoritative preview's templates array.
import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Face } from "../../face/Face";
import { RequestGeneration, errorText } from "../library/data";
import { JOBS, createJob } from "./jobs-data";
export function Jobs({ engine, reload }: { engine: WindowEngine; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const pending = useRef(false);
  const generation = useRef(new RequestGeneration());
  useEffect(() => {
    const guard = generation.current, current = guard.next();
    pending.current = false;
    queueMicrotask(() => { if (current()) { setBusy(null); setError(null); setReceipt(null); } });
    return () => { guard.retire(); pending.current = false; };
  }, [engine]);
  async function createFromJob(job: typeof JOBS[number]) {
    if (pending.current) return;
    pending.current = true; setBusy(job.name); setError(null); setReceipt(null);
    const current = generation.current.next();
    try { await createJob(engine, job, current); if (current()) { setReceipt(job.name + " is ready."); reload(); } }
    catch (error) { if (current()) { setError(errorText(error)); reload(); } }
    finally { if (current()) { pending.current = false; setBusy(null); } }
  }
  return <section><h2 className="kp-section-title">Start from a job</h2>{error && <p role="alert" className="kp-error">{error}</p>}{receipt && <p role="status">{receipt}</p>}<div className="kp-jobs">{JOBS.map(job => <section className="kp-tile" key={job.name}><div className="kp-tile-heading"><Face size={36} label={job.name} /><b>{job.name}</b></div><p>{job.description}</p><button type="button" className="btn sm" aria-label={"Use this job: " + job.name} disabled={busy !== null} onClick={() => { void createFromJob(job); }}>{busy === job.name ? "Creating…" : "Use this job"}</button></section>)}</div></section>;
}
