// Library › Memory › the Rings row and its diary (preview 42-placesbp ringsRowD18 / ringsDiaryD18), on
// doctor.memory.status (rings stats) and doctor.memory.dreamDiary / backfill / reset / dedupe.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { shows, type Level } from "../../places-nav/level";
import { Dialog } from "../../shell/Dialog";
import { optStr, rec, useOperation, useResource } from "./data";
import type { MemoryStatus } from "./memory-more";
import { Grey, IcoTile, when } from "./parts";

export const UNDO_NIGHT_REASON = "Needs the engine’s undo-last-night method for Rings.";
/** The reason the person sees on the greyed undo; UNDO_NIGHT_REASON stays on the button as the engine-lane note. */
const UNDO_NIGHT_WHY = "Undo isn’t available yet. See what it changed lists every change from last night.";
/** "Rings" is the internal name; the person reads what it does. */
const CLEANUP = "Overnight memory cleanup";

type Props = { engine: WindowEngine; level: Level; scope: string; status: { data: MemoryStatus | null }; openSettings?: (page: string) => void };

export function RingsRow({ engine, level, scope, status, openSettings }: Props) {
  const [diary, setDiary] = useState(false);
  const rings = status.data?.rings;
  if (!status.data) return null;
  if (!rings?.enabled) return <div className="lib-rows lib-rings" data-testid="rings-row">
    <div className="lib-row"><IcoTile icon="clock" /><span className="lib-grow">{rings?.enabled === false
      ? <><b>{CLEANUP}: off</b><small>Turn it on to tidy memory while you sleep.</small></>
      : <><b>{CLEANUP}: hasn’t run yet</b><small>It tidies memory while you sleep.</small></>}</span>
      {openSettings && <button type="button" className="link" onClick={() => openSettings("seasons")}>Seasons settings</button>}</div>
  </div>;
  const last = rings.lastPromotedAt ? Date.parse(rings.lastPromotedAt) : NaN;
  const lastWords = Number.isFinite(last) ? `last ran ${when(last)}` : "hasn’t run yet";
  const kept = rings.promotedToday ?? 0, waiting = rings.shortTermCount ?? 0;
  return <div className="lib-rows lib-rings" data-testid="rings-row">
    <div className="lib-row"><IcoTile icon="clock" />
      <span className="lib-grow"><b>{CLEANUP}: {lastWords}</b><small>{kept} kept for good today · {waiting} waiting to be sorted</small>
        {shows(level, "advanced") && <small className="lib-mono">Kept for good today {kept} · in all {rings.promotedTotal ?? 0} · waiting to be sorted {waiting} · signals {(rings.lightPhaseHitCount ?? 0) + (rings.remPhaseHitCount ?? 0)} (sort {rings.lightPhaseHitCount ?? 0}, reflect {rings.remPhaseHitCount ?? 0})</small>}</span>
      <button type="button" className="btn sm" onClick={() => setDiary(true)}>See what it changed</button>
      <Grey ghost label="Undo last night’s cleanup" reason={UNDO_NIGHT_REASON} why={UNDO_NIGHT_WHY} />
    </div>
    {diary && <Diary engine={engine} level={level} agentId={scope} onClose={() => setDiary(false)} />}
  </div>;
}

type DiaryPayload = { found: boolean; content?: string; updatedAtMs?: number };

function Diary({ engine, level, agentId, onClose }: { engine: WindowEngine; level: Level; agentId: string; onClose: () => void }) {
  const target = agentId ? { agentId } : {};
  const rawDiary = useResource<unknown>(engine, "doctor.memory.dreamDiary", target);
  const d = rec(rawDiary.data);
  const diary = { ...rawDiary, data: rawDiary.data === null ? null : { found: d.found === true, content: optStr(d.content) } as DiaryPayload };
  const op = useOperation(engine);
  const [done, setDone] = useState("");
  const act = (method: string, words: (r: Record<string, unknown>) => string) => void op.run<Record<string, unknown>>(method, target, r => { setDone(words(r)); diary.reload(); });
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const footer = <>
    {shows(level, "advanced") && <>
      <button type="button" className="btn ghost sm" disabled={op.busy} onClick={() => act("doctor.memory.backfillDreamDiary", r => `${n(r.written)} nights written from ${n(r.scannedFiles)} daily notes.`)}>Write past nights</button>
      <button type="button" className="btn ghost sm" disabled={op.busy} onClick={() => act("doctor.memory.resetDreamDiary", r => `${n(r.removedEntries)} written-back nights removed.`)}>Remove written-back nights</button>
      <button type="button" className="btn ghost sm" disabled={op.busy} onClick={() => act("doctor.memory.dedupeDreamDiary", r => `${n(r.removedEntries)} repeats removed.`)}>Remove repeats</button>
    </>}
  </>;
  return <Dialog title="What overnight cleanup changed" wide onClose={onClose} footer={footer} testid="rings-diary">
    {diary.loading && <p className="lib-hint" role="status">Loading…</p>}
    {diary.error && <p className="lib-bad" role="alert">{diary.error}</p>}
    {diary.data && (diary.data.found && diary.data.content ? <pre className="lib-pre">{diary.data.content}</pre> : <p className="lib-hint">Nothing yet. It writes down what it changed after its first night.</p>)}
    {done && <p role="status" className="lib-hint">{done}</p>}
    {op.error && <p className="lib-bad" role="alert">{op.error}</p>}
  </Dialog>;
}
