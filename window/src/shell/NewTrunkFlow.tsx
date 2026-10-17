// + new › New Trunk (the preview's newTrunkC18 and ADD_Q1_C18): Branch makes the Trunk, opens a conversation with it and
// asks, in a card above its message box, what it should take on first and how careful it should be, then which model
// and which tools. The job is saved as identity.theme (config.patch), the care as this conversation's permissionMode
// (sessions.patch), and a chosen model with agents.update. Tools stay on their usual setting unless details is opened.
import { useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { readModels } from "../composer/model";
import { patchConfig, readConfig, readRoster } from "../places/trunk/model";
import { nextTrunkChoice } from "../places/trunk/NewTrunkPreview";
import { trunkAppearance } from "../face/appearance";
import { CharacterFace } from "../face/CharacterFace";
import { Face } from "../face/Face";
import "../thread/questions.css";

export type NewTrunk = { agentId: string; sessionKey: string; name: string; avatar?: string; colour?: string; shape?: string };
type Opt = { label: string; line?: string };

export const FIRST_JOB: Opt[] = [
  { label: "Inbox & calendar", line: "Outlook, Gmail, Google Calendar" },
  { label: "Money & receipts", line: "Card statements, spreadsheets, receipts" },
  { label: "Research", line: "The web, PDFs, your notes" },
  { label: "Files on this computer", line: "Downloads, Documents, the desktop" },
  { label: "Something else", line: "Tell me in your own words" },
];
const FOLLOW = [
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

/** The greeting the preview gives a new Trunk (preview.html:41518), with the name it has now. */
const greeting = (name: string) => `Hi, I’m ${name}. Keep me as I am, or shuffle for another character and name. What should I take on first?`;

type Ask = { label: string; line?: string };

export function NewTrunkCard({ engine, flow, onDone, onChangeLook }: { engine: WindowEngine; flow: NewTrunk; onDone: (name: string) => void; onChangeLook?: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [models, setModels] = useState<{ ref: string; name: string }[]>([]);
  const [readyName, setReadyName] = useState(flow.name);
  const [made, setMade] = useState({ name: flow.name, avatar: flow.avatar ?? "" });
  const [line, setLine] = useState(greeting(flow.name));
  const appearance = trunkAppearance(made.avatar || undefined, made.name);
  // Shuffle: a new unused name and look, saved on the Trunk (agents.update), and the greeting follows it.
  const shuffle = () => run(async () => {
    const next = nextTrunkChoice(readRoster(await engine.request("agents.list", {})), { name: made.name, avatar: made.avatar });
    ok(await engine.request("agents.update", { agentId: flow.agentId, name: next.name, avatar: next.avatar }));
    setMade({ name: next.name, avatar: next.avatar });
    setLine(greeting(next.name));
  });
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
    setReadyName(roster.agents.find((a) => a.id === flow.agentId)?.name ?? made.name);
    let choices: { ref: string; name: string }[] = [];
    try { choices = readModels(await engine.request("models.list", {})).filter((model) => model.available).slice(0, 3); }
    catch { choices = []; }
    setModels(choices);
    setLine(choices.length ? "The job is saved." : "No model is set up yet. Add one in Settings.");
    setStep(choices.length ? 3 : 4);
  });
  const pickModel = (ref: string) => run(async () => {
    if (ref) ok(await engine.request("agents.update", { agentId: flow.agentId, model: ref }));
    setLine(ref ? "That model is set for me." : "I’ll keep the usual model.");
    setStep(4);
  });
  const modelAsks: Ask[] = [{ label: "The usual model", line: "Whatever Branch already uses" }, ...models.map((model) => ({ label: model.name, line: "This Trunk only" }))];
  const toolAsks: Ask[] = [
    { label: "The usual tools", line: "The same tools as your other Trunks" },
    ...(onChangeLook ? [{ label: "Choose tools in details", line: "Files, the browser and the rest" }] : []),
  ];
  const question = step === 1 ? "What should I take on first?" : step === 2 ? "How careful should I be?" : step === 3 ? "Which model should I think with?" : "Which tools should I start with?";
  const hint = step === 1 ? "Pick one for now. You can add more later." : step === 2 ? "Lockdown still stops me, whatever you pick." : step === 3 ? "You can change it later in details or Settings." : "Nothing turns off. The full list stays in details and Settings.";
  const opts: Ask[] = step === 1 ? FIRST_JOB : step === 2 ? CARE : step === 3 ? modelAsks : toolAsks;
  const choose = (index: number) => {
    if (step === 1) void job(index);
    else if (step === 2) void care(index);
    else if (step === 3) void pickModel(index === 0 ? "" : models[index - 1]?.ref ?? "");
    else if (index === 1) { onChangeLook?.(); onDone(readyName); }
    else onDone(readyName);
  };
  return (
    <div className="dock-q talk-setup" data-testid="new-trunk-card">
      <div className="card choice q-card" aria-busy={busy}>
        <div className="meet">
          {appearance ? <CharacterFace appearance={appearance} size={56} label={made.name} /> : flow.colour ? <Face size={56} label={made.name} pebbleLook={{ colour: flow.colour, shape: flow.shape, eyes: "Round" }} /> : null}
          <span className="grow"><b>{made.name}</b><small>Model, instructions and tools stay in details and Settings.</small></span>
          <button type="button" className="btn sm" disabled={busy} onClick={() => void shuffle()}>Shuffle</button>
          <button type="button" className="btn ghost sm" disabled={busy || !onChangeLook} onClick={() => onChangeLook?.()}>Change the look</button>
        </div>
        <p className="talk-done">{line}</p>
        <div className="q">{question}</div>
        <div className="sub">{hint}</div>
        <div className="opts" role="radiogroup" aria-label={question}>
          {opts.map((o, j) => (
            <button key={o.label} type="button" className="opt" role="radio" aria-checked={false} disabled={busy} onClick={() => choose(j)}>
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
