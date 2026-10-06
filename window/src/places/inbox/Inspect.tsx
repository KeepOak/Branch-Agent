// [T] "Who ran this, and with what right" (preview 41-placesap inspectPD18), read from audit.run.inspect:
// the run's identity facts, what is missing, and each recorded decision. A record only: nothing here acts.
import { useCallback, useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { clock, dayWord } from "../overview/format";
import { errorText, num, rec, rows, str, type Row } from "./data";

const STATE: Record<string, string> = { present: "Recorded", absent: "Not recorded", unknown: "Unknown", unsupported: "Not supported" };
const COVER: Record<string, [string, string, string]> = {
  enforced: ["ok", "Checked against rules", "A decision was recorded for this run."],
  "attribution-only": ["idle", "Recorded only", "Who ran it was recorded; no rule decision was."],
  unattributed: ["idle", "No one recorded", "Nothing about who ran it was recorded."],
  unknown: ["idle", "Unknown", "The record can’t say."],
  unsupported: ["idle", "Not supported", "This kind of run doesn’t keep a record."],
};
const OUTCOME: Record<string, [string, string]> = { allowed: ["ok", "Allowed"], denied: ["no", "Refused"], "not-applicable": ["idle", "Didn’t apply"], unknown: ["idle", "Unknown"] };
const words = (s: string) => s.replace(/[-_.]/g, " ");
const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const label = (p: Row) => str(p.displayLabel) || str(p.principalRef);

/** The eleven facts, each with what was recorded and whether it was. */
export function facts(context: Row): [string, string, string][] {
  const fact = (name: string, part: Row, value: string): [string, string, string] => [name, value, STATE[str(part.state)] ?? "Not recorded"];
  const invoker = rec(context.invoker), ingress = rec(context.ingress), rep = rec(context.representedSubject), sponsor = rec(context.sponsor);
  const def = rec(context.agentDefinition), runtime = rec(context.runtimeInstance), grants = rows(context.applicableGrants), proof = rows(context.assurance);
  return [
    fact("Gateway", rec(context.trustDomain), str(rec(context.trustDomain).domainRef)),
    fact("Came in through", ingress, words(str(ingress.kind))),
    fact("Started by", invoker, label(rec(invoker.principal))),
    fact("On behalf of", rep, label(rec(rep.principal))),
    fact("Sponsor", sponsor, label(rec(sponsor.principal))),
    [ "Trunk identity", label(rec(context.agentPrincipal)), "Recorded" ],
    fact("Trunk version", def, str(def.revisionRef) || str(def.definitionRef)),
    fact("Running copy", runtime, words(str(runtime.kind))),
    [ "Permissions that applied", grants.length ? String(grants.length) : "", grants.length ? "Recorded" : "Not recorded" ],
    [ "Proof of identity", proof.map(p => words(str(p.kind))).join(", "), proof.length ? "Recorded" : "Not recorded" ],
    fact("Started from", ingress, str(ingress.sourceRef)),
  ];
}

function Decision({ d }: { d: Row }) {
  const action = rec(d.action), decision = rec(d.decision), enforcement = rec(d.enforcement), at = num(d.occurredAt);
  const [, word] = OUTCOME[str(decision.outcome)] ?? OUTCOME.unknown, asked = str(action.summary) || `${words(str(action.family))} ${words(str(action.operation))}`;
  return <dl className="ib-kv">
    <dt>What was asked</dt><dd>{asked}</dd><dt>Outcome</dt><dd>{word}</dd>
    <dt>Reason recorded</dt><dd>{words(str(decision.reasonCode))}</dd>
    {at !== undefined ? <><dt>Recorded at</dt><dd>{clock(new Date(at))}</dd></> : null}
    <dt>Facts it used</dt><dd>{strs(enforcement.contextFieldsUsed).join(", ") || "No facts were recorded as used."}</dd>
    <dt>Rules used: {num(enforcement.policyCount) ?? 0}</dt><dd /><dt>Permissions used: {num(enforcement.grantCount) ?? 0}</dt><dd />
  </dl>;
}

function Body({ result, pick, setPick }: { result: Row; pick: number | null; setPick: (i: number) => void }) {
  const identity = rec(result.identity), context = rec(identity.context), coverage = rec(result.coverage);
  const [tone, title, line] = COVER[str(coverage.state)] ?? COVER.unknown;
  const missing = [...new Set([...strs(identity.missingEvidence), ...strs(coverage.missingEvidence)])];
  const decisions = rows(result.decisionDisplays);
  return <>
    <p className="ib-p"><span className={`ib-pill ${tone}`}>{title}</span> <small className="ib-hint">{line}</small></p>
    {identity.state === "present" ? <dl className="ib-kv">{facts(context).map(([name, value, state]) => <div key={name} className="ib-kv-row"><dt>{name}</dt><dd>{value ? `${value} · ` : ""}<span className={state === "Recorded" ? "ib-ok" : ""}>{state}</span></dd></div>)}</dl>
      : <p className="ib-hint">{str(identity.state) === "ambiguous" ? "More than one record matches this run." : `Who ran it wasn’t recorded (${words(str(identity.reasonCode))}).`}</p>}
    <h3 className="ib-h3">Missing</h3>{missing.length ? <ul className="ib-asks">{missing.map(m => <li key={m}>Nothing was recorded for {words(m)}.</li>)}</ul> : <p className="ib-hint">Nothing is missing.</p>}
    <h3 className="ib-h3">Decisions</h3>
    {decisions.length ? <div className="ib-list">{decisions.map((d, i) => { const [cls, word] = OUTCOME[str(rec(d.decision).outcome)] ?? OUTCOME.unknown; return <button key={str(d.selectorId) || i} type="button" className={pick === i ? "ib-row ib-dec on" : "ib-row ib-dec"} aria-pressed={pick === i} onClick={() => setPick(i)}><span className="ib-grow"><b>{str(rec(d.action).summary) || words(str(rec(d.action).operation))} · {word}</b></span><span className={`ib-pill ${cls}`}>{word}</span></button>; })}</div> : <p className="ib-hint">No decisions were recorded for this run.</p>}
    {pick !== null && decisions[pick] ? <><Decision d={decisions[pick]} /><p className="ib-hint">A record only. Nothing here can approve, change or repeat an action.</p></> : null}
  </>;
}

export function Inspect({ engine, title, at, runId, close }: { engine: WindowEngine; title: string; at: Date; runId: string; close: () => void }) {
  const [result, setResult] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [pick, setPick] = useState<number | null>(null);
  const load = useCallback(() => {
    let live = true;
    setResult(null); setError(""); setPick(null);
    engine.request("audit.run.inspect", { runId }).then(r => { if (live) setResult(rec(r)); }, e => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [engine, runId]);
  useEffect(load, [load]);
  return <Dialog wide title="Who ran this, and with what right" onClose={close} footer={<><button type="button" className="btn ghost" onClick={() => load()}>Start again</button></>}>
    <p className="ib-p"><b>{title}</b> · {dayWord(at)}</p>
    <p className="ib-hint">Kept by the Gateway for 30 days. A missing record doesn’t prove the run didn’t happen.</p>
    {error ? <p className="ib-err" role="alert">{error}</p> : !result ? <p className="ib-hint" role="status">Reading the record…</p> : <Body result={result} pick={pick} setPick={setPick} />}
  </Dialog>;
}
