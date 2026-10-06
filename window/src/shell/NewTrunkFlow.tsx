// + new › New Trunk (the preview's newTrunkC18 and ADD_Q1_C18): Branch makes the Trunk, opens a conversation with it and
// asks, in a card above its message box, what it should take on first and how careful it should be. Each answer is
// saved through the engine: the job as the Trunk's identity.theme (config.patch), the care as this conversation's
// permissionMode (sessions.patch), and at the end a proper name (agents.update). Nothing is sent to a model.
import { useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { patchConfig, readConfig, readRoster } from "../places/trunk/model";
import "../thread/questions.css";

export type NewTrunk = { agentId: string; sessionKey: string; name: string };
type Opt = { label: string; line?: string };

export const FIRST_JOB: Opt[] = [
  { label: "Inbox & calendar", line: "Outlook, Gmail, Google Calendar" },
  { label: "Money & receipts", line: "Card statements, spreadsheets, receipts" },
  { label: "Research", line: "The web, PDFs, your notes" },
  { label: "Files on this computer", line: "Downloads, Documents, the desktop" },
  { label: "Something else", line: "Tell me in your own words" },
];
export const FOLLOW = [
  "I’ll need to sign in to your mail and calendar. I’ll ask before I send or accept anything.",
  "I’ll read card statements and receipts. I’ll never pay or move money.",
  "I’ll use the web and the files you point me to.",
  "I’ll start with Downloads and Documents. I won’t delete anything without asking.",
  "Got it. I’ll ask a couple of questions as we go.",
];
export const CARE: (Opt & { mode: "guarded" | "workspace" | "full" })[] = [
  { label: "Ask me before everything", line: "Slowest, most control", mode: "guarded" },
  { label: "Ask before sending, deleting or spending", line: "Recommended", mode: "workspace" },
  { label: "Just do it", line: "I’ll still tell you what I did", mode: "full" },
];

/** "Trunk N": the first number past the Trunks there are that no Trunk is called yet (nextTrunkNumC18). */
export function nextTrunkName(names: string[]): string {
  const taken = new Set(names.map((n) => n.toLowerCase()));
  let n = Math.max(1, names.length);
  while (taken.has(`trunk ${n}`)) n++;
  return `Trunk ${n}`;
}

const ok = (r: unknown) => {
  const v = (r ?? {}) as { ok?: boolean; error?: { message?: string } | string };
  if (v.ok === false) throw new Error(typeof v.error === "string" ? v.error : v.error?.message || "The engine refused it.");
};

const KEYS = "ABCDE";

export function NewTrunkCard({ engine, flow, onDone }: { engine: WindowEngine; flow: NewTrunk; onDone: (name: string) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [line, setLine] = useState(`Hi, I’m ${flow.name}. What should I take on first?`);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const job = (i: number, own?: string) => run(async () => {
    const snap = readConfig(await engine.request("config.get", {}));
    await patchConfig(engine, snap, { [`agents.entries.${flow.agentId}.identity.theme`]: own?.trim() || FIRST_JOB[i].label });
    setLine(own ? FOLLOW[4] : FOLLOW[i]);
    setTyped("");
    setStep(2);
  });
  const care = (i: number) => run(async () => {
    ok(await engine.request("sessions.patch", { key: flow.sessionKey, permissionMode: CARE[i].mode }));
    const roster = readRoster(await engine.request("agents.list", {}));
    const name = roster.agents.find((a) => a.id === flow.agentId)?.name ?? flow.agentId;
    onDone(name);
  });
  const opts = step === 1 ? FIRST_JOB : CARE;
  return (
    <div className="dock-q talk-setup" data-testid="new-trunk-card">
      <div className="card choice q-card" aria-busy={busy}>
        <p className="talk-done">{line}</p>
        <div className="q">{step === 1 ? "What should I take on first?" : "How careful should I be?"}</div>
        <div className="sub">{step === 1 ? "Pick one for now. You can add more later." : "Lockdown still stops me, whatever you pick."}</div>
        <div className="opts" role="radiogroup" aria-label={step === 1 ? "What should I take on first?" : "How careful should I be?"}>
          {opts.map((o, j) => (
            <button key={o.label} type="button" className="opt" role="radio" aria-checked={false} disabled={busy} onClick={() => void (step === 1 ? job(j) : care(j))}>
              <kbd>{KEYS[j]}</kbd>
              <b>{o.label}</b>
              {o.line ? <small>{o.line}</small> : null}
            </button>
          ))}
        </div>
        {step === 1 ? (
          <form className="own" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) void job(4, typed); }}>
            <input className="inp" type="text" autoComplete="off" placeholder="Or type your own answer" aria-label="Your own answer" value={typed} disabled={busy} onChange={(e) => setTyped(e.target.value)} />
            <button className="btn sm" type="submit" disabled={busy || !typed.trim()}>Reply</button>
          </form>
        ) : null}
        {error ? <p className="field-error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}
