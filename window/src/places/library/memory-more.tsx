// Library › Memory, the sections under the list (preview 94-g4p secR418 + 42-placesbp "How it learns"):
// How it learns [A], Memory health, What to remember, About you, Waiting for your yes [T].
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import { downloadTranscript } from "../../transcript-export/ExportDialog";
import { shownWhy } from "../../shell/shown-why";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { fileOf, num, optStr, rec, useOperation, useResource, trunkName, type Trunk } from "./data";
import { aboutYouSummary } from "./memory-about";
import { inline } from "../../thread/markdown";
import { Grey, GreySwitch, plural, Row, Section, when } from "./parts";
import { BringInDialog } from "./memory-bring-dialog";
import { BRING_IN_WRITE_REASON } from "./memory-import";

export type MemoryStatus = {
  agentId?: string; provider?: string;
  embedding: { ok: boolean; error?: string; checked?: boolean; checkedAtMs?: number };
  rings?: { enabled: boolean; promotedToday?: number; promotedTotal?: number; shortTermCount?: number; lightPhaseHitCount?: number; remPhaseHitCount?: number; lastPromotedAt?: string };
};

/** doctor.memory.status read defensively: missing parts read as unknown, never a crash. */
export function statusOf(raw: unknown): MemoryStatus {
  const r = rec(raw), e = rec(r.embedding), rings = r.rings === undefined ? undefined : rec(r.rings);
  return {
    agentId: optStr(r.agentId), provider: optStr(r.provider),
    embedding: { ok: e.ok === true, error: optStr(e.error), checked: typeof e.checked === "boolean" ? e.checked : undefined, checkedAtMs: num(e.checkedAtMs) },
    rings: rings && { enabled: rings.enabled === true, promotedToday: num(rings.promotedToday), promotedTotal: num(rings.promotedTotal), shortTermCount: num(rings.shortTermCount), lightPhaseHitCount: num(rings.lightPhaseHitCount), remPhaseHitCount: num(rings.remPhaseHitCount), lastPromotedAt: optStr(rings.lastPromotedAt) },
  };
}

export const REASONS = {
  whatsapp: "Needs the engine’s chat-export import method.",
  rules: "Needs the engine’s what-to-remember rules.",
  interview: "Needs the engine’s interview flow for About you.",
  hold: "Needs the engine’s hold-for-my-yes setting and review list.",
  habits: "Needs the engine’s noticed-habits list.",
  timeline: "Needs the engine’s week-by-week learning timeline.",
  versions: "Needs the engine’s fact history.",
  forgetChat: "Needs the engine’s forget-one-conversation method.",
  checkpoints: "Needs the engine’s memory checkpoints.",
};

const LEARN_ROWS: [string, string, string, string][] = [
  ["Habits it noticed", "Patterns in how you work, offered as memories you keep or drop.", "See", REASONS.habits],
  ["What it learned, week by week", "A timeline of new facts, skills and habits, and where each came from.", "Open the timeline", REASONS.timeline],
  ["Earlier versions of a fact", "Every change to a fact is kept, so an older one can come back.", "See versions", REASONS.versions],
  ["Forget what one conversation taught", "Removes every fact that came from one conversation, and nothing else.", "Choose one", REASONS.forgetChat],
  ["Memory checkpoints", "A snapshot of memory and every skill version, to go back to all at once.", "See checkpoints", REASONS.checkpoints],
];

export function HowItLearns({ engine, trunks, scope, onApplied }: { engine: WindowEngine; trunks: Trunk[]; scope: string; onApplied?: () => void }) {
  const [learn, setLearn] = useState(false);
  const [bring, setBring] = useState(false);
  const owner = engine.scopes.includes("operator.admin");
  const agentId = scope || trunks[0]?.id || "";
  return <Section title="How it learns" testid="how-it-learns">
    <div className="lib-rows">
      {LEARN_ROWS.map(([title, line, label, reason]) => <Row key={title} icon="learn" title={title} line={line}><Grey label={label} reason={reason} /></Row>)}
      <Row icon="learn" title="Bring memories in" line="Memories from another assistant on this computer. Everything comes in as a copy.">
        {owner
          ? <button type="button" className="btn sm" data-testid="memory-bring-in" disabled={!agentId} onClick={() => setBring(true)}>Bring in</button>
          : <Grey label="Bring in" reason={BRING_IN_WRITE_REASON} />}
      </Row>
      <Row icon="learn" title="Learn from past conversations" line="Finds what earlier conversations taught and lets Rings keep the useful parts."><button type="button" className="btn sm" onClick={() => setLearn(true)}>Choose dates</button></Row>
    </div>
    {learn && <LearnDialog engine={engine} trunks={trunks} scope={scope} onClose={() => setLearn(false)} />}
    {bring && <BringInDialog engine={engine} agentId={agentId} onClose={() => setBring(false)} onApplied={onApplied} />}
  </Section>;
}

type Backfill = { days: number; candidates: number; staged?: number; truncated?: boolean };

function LearnDialog({ engine, trunks, scope, onClose }: { engine: WindowEngine; trunks: Trunk[]; scope: string; onClose: () => void }) {
  const [agentId, setAgentId] = useState(scope || trunks[0]?.id || "");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [found, setFound] = useState<Backfill | null>(null);
  const [kept, setKept] = useState<Backfill | null>(null);
  const op = useOperation(engine);
  const params = { agentId, ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const footer = <>
    <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
    {kept ? <button type="button" className="btn" disabled={op.busy} onClick={() => void op.run("memory.sessionBackfill.rollback", { agentId }, () => { setKept(null); setFound(null); })}>Undo</button>
      : found ? <button type="button" className="btn pri" disabled={op.busy || !num(found.candidates)} onClick={() => void op.run<Backfill>("memory.sessionBackfill.apply", params, setKept)}>Keep them</button>
      : <button type="button" className="btn pri" disabled={op.busy || !agentId} onClick={() => void op.run<Backfill>("memory.sessionBackfill.preview", params, setFound)}>Preview</button>}
  </>;
  return <Dialog title="Learn from past conversations" onClose={onClose} footer={footer} testid="learn-dialog">
    <label className="lib-fld"><span>Trunk</span><select className="inp" value={agentId} onChange={e => { setAgentId(e.target.value); setFound(null); }}>{trunks.map(t => <option key={t.id} value={t.id}>{trunkName(t)}</option>)}</select></label>
    <div className="lib-dates"><label className="lib-fld"><span>From</span><input className="inp" type="date" value={from} onChange={e => { setFrom(e.target.value); setFound(null); }} /></label>
      <label className="lib-fld"><span>To</span><input className="inp" type="date" value={to} onChange={e => { setTo(e.target.value); setFound(null); }} /></label></div>
    {found && !kept && <p role="status">{plural(num(found.candidates) ?? 0, "thing", "things")} worth keeping from {plural(num(found.days) ?? 0, "day", "days")}.{found.truncated ? " There are more after these; preview again to continue." : ""}</p>}
    {kept && <p role="status">{plural(num(kept.staged) ?? num(kept.candidates) ?? 0, "thing", "things")} handed to Rings to sort tonight.</p>}
    {op.error && <p className="lib-bad" role="alert">{op.error}</p>}
  </Dialog>;
}

export function MemoryHealth({ engine, agentId, status, check }: { engine: WindowEngine; agentId: string; status: { data: MemoryStatus | null; loading: boolean; error: string | null }; check: () => void }) {
  const op = useOperation(engine);
  const exportAll = () => void op.run<{ agentId: string; files: { path: string; content: string }[] }>("memory.export", { agentId }, result => {
    const markdown = result.files.map(file => `## ${file.path}\n\n${file.content.trimEnd()}\n`).join("\n");
    downloadTranscript(markdown, `${result.agentId}-memory-${new Date().toISOString().slice(0, 10)}`, "markdown");
  });
  const e = status.data?.embedding;
  const checked = e?.checked !== false && e?.checkedAtMs;
  const title = checked ? `Search index: checked ${when(e!.checkedAtMs)}` : "Search index: not checked yet";
  const line = !e ? "" : !checked ? "It checks itself in the background and rebuilds a damaged index." : e.ok ? "Nothing to repair. It checks itself in the background and rebuilds a damaged index." : e.error ?? "";
  return <Section title="Memory health" testid="memory-health">
    {status.error && <p className="lib-bad" role="alert">{status.error}</p>}
    <div className="lib-plain">
      {e && <Row icon="search" title={title} line={line}><button type="button" className="btn sm" disabled={status.loading} onClick={check}>Check now</button></Row>}
      <Row icon="clock" title="Loads when a conversation starts" line="What a Trunk learns now shows from its next conversation, so each one starts the same." />
    </div>
    {op.error && <p className="lib-bad" role="alert">{op.error}</p>}
    <div className="lib-acts"><button type="button" className="btn" disabled={op.busy || !agentId} onClick={exportAll}>Export everything</button><Grey ghost label="Bring in a WhatsApp export" reason={REASONS.whatsapp} /></div>
  </Section>;
}

export function WhatToRemember() {
  return <Section title="What to remember" testid="what-to-remember">
    <div className="lib-form"><input className="inp" disabled placeholder="Never remember my health details" aria-label="A rule about what to remember" title={shownWhy(REASONS.rules)} /><Grey label="Add" reason={REASONS.rules} /></div>
  </Section>;
}

export function AboutYou({ engine, agentId }: { engine: WindowEngine; agentId: string }) {
  const user = useResource<unknown>(engine, agentId ? "agents.files.get" : null, { agentId, name: "USER.md" });
  const file = user.data ? fileOf(user.data) : null;
  const text = !file || file.missing ? "" : aboutYouSummary(file.content ?? "");
  return <Section title="About you" hint="A short summary Trunks keep of you from what they remember. Edit it by changing the memories it comes from." testid="about-you">
    {user.loading && <p className="lib-hint" role="status">Loading…</p>}
    {user.error && <p className="lib-bad" role="alert">{user.error}</p>}
    {user.data !== null && (text ? <p className="lib-about">{inline(text)}</p> : <p className="lib-hint">Nothing written about you yet.</p>)}
    <div className="lib-acts"><Grey label="Let it interview you" reason={REASONS.interview} /></div>
  </Section>;
}

export function HoldForYes() {
  return <Section title="Waiting for your yes" testid="hold-for-yes">
    <div className="lib-ctl"><b>Hold changes for my yes</b><GreySwitch label="Hold changes for my yes" reason={REASONS.hold} /><small>Off: Trunks keep what’s worth keeping as they work. On makes them wait here first.</small></div>
  </Section>;
}
