// Job names and descriptions copied from the authoritative preview's templates array.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { WindowEngine } from "../../connect/engine";
import { RequestGeneration, errorText } from "../library/data";
import { JOBS, createJob } from "./jobs-data";
import { NewTrunkPreview, type TrunkChoice } from "../trunk/NewTrunkPreview";
import { creationProblem, readRoster, type Roster } from "../trunk/model";
/** What a failed job reads as. The engine's words and the new Trunk's id go to the log, never into the line
 *  (Private #1089). */
function jobProblem(job: typeof JOBS[number], error: unknown): string {
  console.warn("job setup failed:", errorText(error));
  return /but its job instructions were not saved/i.test(errorText(error))
    ? `${job.name} was created, but its job instructions weren’t saved. Open Edit to finish setting it up.`
    : creationProblem(error);
}
export function Jobs({ engine, reload }: { engine: WindowEngine; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [choiceJob, setChoiceJob] = useState<typeof JOBS[number] | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const pending = useRef(false);
  const generation = useRef(new RequestGeneration());
  useEffect(() => {
    const guard = generation.current, current = guard.next();
    pending.current = false;
    queueMicrotask(() => { if (current()) { setBusy(null); setError(null); setReceipt(null); } });
    return () => { guard.retire(); pending.current = false; };
  }, [engine]);
  async function createFromJob(job: typeof JOBS[number], choice: TrunkChoice) {
    if (pending.current) return;
    pending.current = true; setBusy(job.name); setError(null); setReceipt(null);
    const current = generation.current.next();
    try { await createJob(engine, job, current, choice.avatar, choice.name); if (current()) { setChoiceJob(null); setReceipt(`${job.name} is ready. ${choice.name} is your new Trunk.`); reload(); } }
    catch (error) { if (current()) { setError(jobProblem(job, error)); reload(); } }
    finally { if (current()) { pending.current = false; setBusy(null); } }
  }
  return <section><h2 className="kp-section-title">Start from a job</h2>{error && <p role="alert" className="kp-error">{error}</p>}{receipt && <p role="status">{receipt}</p>}<div className="kp-jobs">{JOBS.map(job => <section className="kp-tile" key={job.name}><div className="kp-tile-heading"><JobPebble color={job.color} shape={job.shape} /><b>{job.name}</b></div><p>{job.description}</p><button type="button" className="btn sm" aria-label={"Use this job: " + job.name} disabled={busy !== null} onClick={() => { const current = generation.current.next(); void engine.request("agents.list", {}).then((value) => { if (current()) { setRoster(readRoster(value)); setChoiceJob(job); } }, (reason) => { if (current()) { console.warn("agents.list failed:", errorText(reason)); setError("Couldn’t read your Trunks. Try again."); } }); }}>{busy === job.name ? "Creating…" : "Use this job"}</button></section>)}</div>{choiceJob && roster && <NewTrunkPreview roster={roster} busy={busy !== null} onClose={() => setChoiceJob(null)} onConfirm={(choice) => void createFromJob(choiceJob, choice)} />}</section>;
}

/** A job's pebble (preview .av.pbl18 on the job tiles): its colour in its shape, two eyes. It is not a Trunk yet. */
function JobPebble({ color, shape }: { color: string; shape: string }) {
  return <span className="kp-jobpeb" style={{ "--c": color, "--r": shape } as CSSProperties} aria-hidden="true"><span className="peb" /><i className="eye l" /><i className="eye r" /></span>;
}
