// Setup's Trunk and Ready steps (DESIGN-SPEC §4.8.1.4 and §4.8.1.11). The Trunk step names the default Trunk and picks
// its starting jobs; the Ready step runs the health check on its own and says what is still missing.
import { useEffect, useId, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { KeeperMark } from "../brand/KeeperMark";
import { Icon } from "../shell/icons";
import { JOBS, type Check } from "./setup-model";

function DefaultTrunkCard({ engine, id, initialName }: { engine: WindowEngine; id: string; initialName: string }) {
  const nameId = useId();
  const [name, setName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setName(initialName); setDraft(initialName); }, [initialName]);
  const save = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true); setError("");
    try {
      if (draft.trim() !== name) {
        const result = await engine.request<{ ok?: boolean; error?: string }>("agents.update", { agentId: id, name: draft.trim() });
        if (result.ok === false) throw new Error("Couldn’t rename this Trunk.");
        setName(draft.trim());
      }
      setEditing(false);
    } catch { setError("Couldn’t rename this Trunk. Try again."); } finally { setBusy(false); }
  };
  return <div className="ob-default-trunk">
    <KeeperMark size={36} />
    <span className="grow">
      {editing ? <label className="fld" htmlFor={nameId}><span>Name your Trunk</span><input id={nameId} className="inp" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} /></label> : <b>{name} <small>default Trunk · Chief of Staff</small></b>}
      <small>Answers anything not sent to another Trunk and routes jobs.</small>
      {error ? <small role="alert">{error}</small> : null}
    </span>
    {editing ? <span className="acts"><button type="button" className="btn sm" disabled={busy} onClick={() => { setDraft(name); setEditing(false); setError(""); }}>Cancel</button><button type="button" className="btn pri sm" disabled={!draft.trim() || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button></span> : <button type="button" className="btn sm" onClick={() => setEditing(true)}>Edit</button>}
  </div>;
}

export function TrunksBody({ jobs, onJob, engine, defaultAgentId, defaultName }: { jobs: number[]; onJob: (i: number) => void; engine: WindowEngine; defaultAgentId: string | null; defaultName: string }) {
  return (
    <>
      {defaultAgentId ? <DefaultTrunkCard engine={engine} id={defaultAgentId} initialName={defaultName} /> : null}
      <div className="ob-tr">
        {JOBS.map((j, i) => (
          <button key={j.name} type="button" className="ob-tpl" aria-pressed={jobs.includes(i)} data-testid={`setup-job-${i}`} onClick={() => onJob(i)}>
            <span className="ob-dot" style={{ background: j.colour }} />
            <b>{j.name}</b>
            <small>{j.line}</small>
          </button>
        ))}
      </div>
    </>
  );
}

/** "Getting this computer ready" (§4.8.1.11 parity add): the steps the Branch app runs to set this computer up, read
 *  from the same answers as the health check, since this window only exists once they ran. */
export function readySteps(checks: Check[]): { name: string; state: Check["state"]; line: string }[] {
  const of = (name: string) => checks.find((c) => c.name === name);
  const step = (name: string, from: Check | undefined) => ({ name, state: from?.state ?? "checking", line: !from || from.state === "checking" ? "checking…" : from.state === "ok" ? "Done" : from.line });
  const disk = of("Disk");
  const engine = of("The engine");
  const gateway = of("The gateway");
  return [step("Check this computer", disk), step("Set up the engine", engine), step("Prepare the gateway", gateway), step("Start the gateway", gateway)];
}

function CheckIcon({ state }: { state: Check["state"] }) {
  return state === "checking" ? <Icon name="spin" small /> : state === "ok" ? <Icon name="check" small /> : <Icon name="x" small />;
}

export function CheckBody({ checks, onFix }: { checks: Check[]; onFix: (step: number) => void }) {
  const ready = readySteps(checks);
  const engine = checks.find((c) => c.name === "The engine");
  return (
    <>
      <div className="readyPF18">
        <h3>Getting this computer ready</h3>
        <ol className="tl ob-checks" data-testid="setup-ready">
          {ready.map((r) => (
            <li key={r.name} className={r.state === "ok" ? "ok" : r.state === "bad" ? "badF18" : "waitPF18"}>
              <CheckIcon state={r.state} />
              <span>
                {r.name}
                <small>{r.line}</small>
              </span>
            </li>
          ))}
        </ol>
        <p className="hint ob-ready-hint">Runs in the Branch app on your computer.</p>
        <details className="foldPF18">
          <summary>Show what it’s doing</summary>
          <p className="hint ob-ready-hint">{engine?.state === "ok" ? `The engine is ${engine.line}; nothing else is running.` : "Nothing has answered yet."}</p>
        </details>
      </div>
      <h3 className="checks-hPF18">Health check</h3>
      {checks.some((c) => c.name === "The model" && c.state === "bad") ? <p role="status">Trunks can’t answer until a model is connected.</p> : null}
      <ol className="tl ob-checks" data-testid="setup-checks">
        {checks.map((c) => (
          <li key={c.name} className={c.state === "ok" ? "ok" : c.state === "bad" ? "badF18" : ""}>
            <CheckIcon state={c.state} />
            <span>
              {c.name}
              <small>
                {c.state === "checking" ? "checking…" : c.line}
                {c.state === "bad" && c.fix !== undefined ? (
                  <>
                    {" · "}
                    <button type="button" className="link" onClick={() => onFix(c.fix as number)}>
                      Fix it
                    </button>
                  </>
                ) : null}
              </small>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
