// Check-ins (§4.6.3.4, preview 40-places p40-auto-other + 94-g4p): Check now and a note on `wake`, the last
// check-in from `last-heartbeat`, How often / Which hours on the heartbeat config (every, activeHours) through
// config.patch, and "What it checks" as the Trunk's HEARTBEAT.md through agents.files.get/set.
// Heartbeat fields from engine/src/config/zod-schema.agent-runtime.ts; only the edited fields are patched.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useCallback, useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Segmented } from "../../shell/Popover";
import { shows, type Level } from "../../places-nav/level";
import { useAct } from "./act";
import { loadTrunks } from "./data";
import { Glyph } from "./glyphs";
import { SwitchRow } from "./Proposal";
import { Section, ToolRow } from "./Sections";
import { errorText, rec, str, usePlaceData, type Row } from "./runtime";
import { shownWhy } from "../../shell/shown-why";
import { stepLabel } from "../../thread/format";
import { readTextToolCall, stepFromTextToolCall } from "../../thread/text-tool-call";

export type CheckinSnapshot = { hash: string; valid: boolean; defaults: Row; entries: { id: string; name: string; heartbeat: Row }[] };
export async function loadCheckins(engine: WindowEngine): Promise<CheckinSnapshot> {
  const snapshot = rec(await engine.request("config.get", {}));
  const agents = rec(rec(snapshot.config).agents);
  return { hash: str(snapshot.hash), valid: snapshot.valid !== false, defaults: rec(rec(agents.defaults).heartbeat), entries: Object.entries(rec(agents.entries)).filter(([, entry]) => rec(entry).heartbeat !== undefined).map(([id, value]) => ({ id, name: str(rec(value).name) || id, heartbeat: rec(rec(value).heartbeat) })) };
}
function guard(snapshot: CheckinSnapshot, target: string) {
  if (!snapshot.hash) throw new Error("The engine did not provide a configuration revision. Refresh before saving.");
  if (!snapshot.valid) throw new Error("The engine configuration is invalid. Resolve its validation errors before saving.");
  if (target && !snapshot.entries.some(entry => entry.id === target)) throw new Error("This Trunk’s check-in settings changed. Refresh before saving.");
}
async function patchHeartbeat(engine: WindowEngine, snapshot: CheckinSnapshot, target: string, heartbeat: Row) {
  guard(snapshot, target);
  const patch = target ? { agents: { entries: { [target]: { heartbeat } } } } : { agents: { defaults: { heartbeat } } };
  const result = rec(await engine.request("config.patch", { baseHash: snapshot.hash, raw: JSON.stringify(patch) }));
  if (result.ok !== true) throw new Error(str(result.error) || "The engine did not confirm the check-in settings were saved.");
  return result;
}
export async function saveCheckins(engine: WindowEngine, snapshot: CheckinSnapshot, target: string, fields: { every: string; prompt: string }) {
  guard(snapshot, target);
  return patchHeartbeat(engine, snapshot, target, { every: fields.every.trim() || null, prompt: fields.prompt.trim() || null });
}
/** How often / Which hours: one heartbeat field at a time (every, or activeHours; null = the source default). */
export const saveHeartbeatField = (engine: WindowEngine, snapshot: CheckinSnapshot, target: string, field: Row) => patchHeartbeat(engine, snapshot, target, field);

const EVERY = [["15m", "Every 15 min"], ["30m", "Every 30 min"], ["1h", "Every hour"], ["other", "Other…"], ["0m", "Off"]] as const;
const HOURS = [["day", "8 AM – 8 PM", "08:00", "20:00"], ["always", "Always", "", ""], ["work", "Work hours", "09:00", "17:00"], ["other", "Other…", "", ""]] as const;
const SOURCE_EVERY = "30m"; // engine/src/auto-reply/heartbeat.ts DEFAULT_HEARTBEAT_EVERY
export function everyChoice(every: string): string {
  const v = (every || SOURCE_EVERY).trim().toLowerCase();
  if (/^0+\s*[a-z]*$/.test(v)) return "0m";
  if (v === "15m" || v === "15") return "15m";
  if (v === "30m" || v === "30") return "30m";
  if (v === "1h" || v === "60m" || v === "60") return "1h";
  return "other";
}
export function hoursChoice(active: Row): string {
  if (!active.start && !active.end) return "always";
  return HOURS.find(h => h[2] === str(active.start) && h[3] === str(active.end))?.[0] ?? "other";
}

/** HEARTBEAT.md's list lines ("- …"), kept apart from any other text in the file. */
export function checkItems(content: string): string[] {
  return content.split(/\r?\n/).map(l => /^\s*[-*]\s+(?:\[[ x]\]\s+)?(.*\S)\s*$/i.exec(l)?.[1] ?? "").filter(Boolean);
}
export function withoutItem(content: string, index: number): string {
  let n = -1;
  return content.split(/\r?\n/).filter(l => !(/^\s*[-*]\s+\S/.test(l) && ++n === index)).join("\n");
}
export function withItem(content: string, item: string): string {
  const body = content.replace(/\s+$/, "");
  return `${body ? `${body}\n` : ""}- ${item.trim()}\n`;
}

type File = { content: string; hash: string; missing: boolean };
function useHeartbeatFile(engine: WindowEngine, agentId: string) {
  const [file, setFile] = useState<File | null>(null), [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!agentId) return;
    try { const f = rec(rec(await engine.request("agents.files.get", { agentId, name: "HEARTBEAT.md" })).file); setFile({ content: str(f.content), hash: str(f.hash), missing: f.missing === true }); setError(""); }
    catch (e) { setError(errorText(e)); }
  }, [engine, agentId]);
  useEffect(() => { void reload(); }, [reload]);
  const write = async (content: string) => {
    if (!file) throw new Error("HEARTBEAT.md hasn’t been read yet.");
    if (!file.missing && !file.hash) throw new Error("The engine did not provide a document revision. Reload before saving.");
    const r = rec(await engine.request("agents.files.set", { agentId, name: "HEARTBEAT.md", content, ...(file.missing ? { expectedMissing: true } : { expectedHash: file.hash }) }));
    if (r.ok !== true) throw new Error("It changed while you were editing. Reload it first.");
    await reload();
    return r;
  };
  return { file, error, reload, write };
}

function WhatItChecks({ engine, agentId, trunk, level, canWrite }: { engine: WindowEngine; agentId: string; trunk: string; level: Level; canWrite: boolean }) {
  const hb = useHeartbeatFile(engine, agentId), { busy, run } = useAct(hb.reload);
  const [item, setItem] = useState(""), [text, setText] = useState<string | null>(null);
  const content = hb.file?.content ?? "", items = checkItems(content);
  const why = canWrite ? undefined : "Needs an owner";
  return <div className="au-checks">
    <h3 className="au-sub">What it checks</h3>
    {hb.error && <p className="au-error" role="alert">{hb.error}</p>}
    {items.map((it, i) => <div className="au-check" key={`${i}-${it}`}><span className="au-tile"><Glyph name="pulse" /></span><span className="au-grow">{it}</span><button type="button" className="ib" aria-label={`Take out “${it}”`} title={shownWhy(why)} disabled={!canWrite || busy} onClick={() => void run(() => hb.write(withoutItem(content, i)), "Taken out of the list.")}><Glyph name="x" /></button></div>)}
    {hb.file && !items.length && <p className="au-hint">The list is empty, so check-ins are skipped.</p>}
    <form className="au-describe" onSubmit={e => { e.preventDefault(); if (item.trim()) void run(() => hb.write(withItem(content, item)), "Added to the list.").then(ok => ok && setItem("")); }}>
      <input className="inp" aria-label="Add something to check" placeholder="Add something to check: “a reply from the landlord”" value={item} disabled={!canWrite || !hb.file} title={shownWhy(why)} onChange={e => setItem(e.target.value)} />
      <button type="submit" className="btn sm" disabled={!canWrite || busy || !item.trim()}>Add</button>
    </form>
    <p className="au-hint">{trunk} may rewrite this list itself during a check-in; each change shows in Last check-ins.</p>
    {shows(level, "technical") && (text === null
      ? <button type="button" className="btn ghost sm" disabled={!hb.file} onClick={() => setText(content)}>Edit as text</button>
      : <div className="au-field"><textarea className="inp au-text" aria-label="HEARTBEAT.md" value={text} onChange={e => setText(e.target.value)} /><div className="au-actions"><button type="button" className="btn ghost sm" onClick={() => setText(null)}>Cancel</button><button type="button" className="btn pri sm" disabled={!canWrite || busy} title={shownWhy(why)} onClick={() => void run(() => hb.write(text), "Saved the list.").then(ok => ok && setText(null))}>Save</button></div></div>)}
  </div>;
}

const LAST_WORDS: Record<string, string> = { sent: "Told you.", "ok-empty": "Nothing new.", "ok-token": "Nothing new.", skipped: "Skipped.", failed: "It didn’t finish." };

/** Whole-reply tool-call JSON as the preview's step words (AGENT-LOOP-0088 / stepRowPB18). */
function wordsForTextToolCall(text: string, key: string): string | null {
  const call = readTextToolCall(text);
  if (!call) return null;
  const step = stepFromTextToolCall(call, key);
  return [stepLabel(step), step.title].filter(Boolean).join(" · ");
}

/** Last check-in's line: status words, or the preview's step words when the preview is a tool-call JSON. */
export function lastCheckinWords(last: Row): string {
  const preview = str(last.preview);
  if (preview) return wordsForTextToolCall(preview, "checkin") ?? preview;
  const message = str(last.message);
  const fromMessage = wordsForTextToolCall(message, "checkin");
  if (fromMessage) return fromMessage;
  return [LAST_WORDS[str(last.status)], message].filter(Boolean).join(" ");
}

function LastCheckins({ last }: { last: Row | null }) {
  return <div className="au-checks">
    <h3 className="au-sub">Last check-ins</h3>
    {last && last.ts ? <div className="au-last"><Glyph name="pulse" size={14} /><span className="au-grow">{lastCheckinWords(last)}</span><time className="au-time">{new Date(Number(last.ts)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div> : <p className="au-hint">No check-ins since Branch started.</p>}
  </div>;
}

function Note({ engine, trunk, agentId, canWake, run }: { engine: WindowEngine; trunk: string; agentId: string; canWake: boolean; run: ReturnType<typeof useAct>["run"] }) {
  const [text, setText] = useState(""), [mode, setMode] = useState<"now" | "next-heartbeat">("next-heartbeat");
  return <div className="au-checks">
    <h3 className="au-sub">Leave a note for the next check-in</h3>
    <form className="au-describe" onSubmit={e => { e.preventDefault(); if (text.trim()) void run(() => engine.request("wake", { mode, text: text.trim(), ...(agentId ? { agentId } : {}) }), `Added. ${trunk} reads it ${mode === "now" ? "now" : "at its next check-in"}.`).then(ok => ok && setText("")); }}>
      <input className="inp" aria-label="Leave a note for the next check-in" placeholder="Leave a note for the next check-in" value={text} onChange={e => setText(e.target.value)} disabled={!canWake} />
      <Segmented label="When it’s read" value={mode} options={[{ id: "now", name: "Now" }, { id: "next-heartbeat", name: "Next check-in" }]} onChange={setMode} />
      <button type="submit" className="btn sm" disabled={!canWake || !text.trim()}>Add</button>
    </form>
  </div>;
}

type Data = { snap: CheckinSnapshot; trunks: { id: string; name: string }[]; defaultId: string; last: Row | null };
const load = async (engine: WindowEngine): Promise<Data> => {
  const [snap, trunks, last] = await Promise.all([loadCheckins(engine), loadTrunks(engine).catch(() => ({ trunks: [], defaultId: engine.agentId ?? "" })), engine.request("last-heartbeat", {}).then(r => (r ? rec(r) : null), () => null)]);
  return { snap, ...trunks, last };
};

export function Checkins({ engine, level }: { engine: WindowEngine; level: Level }) {
  const state = usePlaceData(engine, load), { busy, run } = useAct(state.refresh);
  const [target, setTarget] = useState(""), [otherEvery, setOtherEvery] = useState<string | null>(null), [otherHours, setOtherHours] = useState<{ start: string; end: string } | null>(null);
  const data = state.data, admin = engine.scopes.includes("operator.admin"), canWake = admin || engine.scopes.includes("operator.write");
  const hb = data ? (target ? data.snap.entries.find(e => e.id === target)?.heartbeat ?? {} : data.snap.defaults) : {};
  const every = str(hb.every) || (target ? str(data?.snap.defaults.every) : ""), active = rec(hb.activeHours ?? (target ? data?.snap.defaults.activeHours : undefined));
  const agentId = target || data?.defaultId || "", trunk = data?.trunks.find(t => t.id === agentId)?.name || "Your Trunk";
  const save = (field: Row, message: string) => data && void run(() => saveHeartbeatField(engine, data.snap, target, field), message);
  const why = admin ? undefined : "Needs an owner";
  return <div className="au-tab">
    {state.error && <p className="au-error" role="alert">{state.error}</p>}
    <section className="au-card">
      <div className="au-card-h"><b>Check in on its own</b><button type="button" className="btn ghost sm" disabled={!canWake || busy} onClick={() => void run(() => engine.request("wake", { mode: "now", text: "Check in now.", ...(agentId ? { agentId } : {}) }), "Checking in now.")}>Check now</button></div>
      <p className="au-hint">Branch looks at the list below every so often and speaks up only when there’s news. It’s HEARTBEAT.md, in plain words.</p>
      {shows(level, "advanced") && data && data.snap.entries.length > 0 && <label className="au-field"><span className="au-flabel">Who checks in</span><select className="inp" value={target} onChange={e => setTarget(e.target.value)}><option value="">Every Trunk (the usual settings)</option>{data.snap.entries.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}
      <div className={admin ? "au-setrow" : "au-setrow au-off"} title={shownWhy(why)}><span><b>How often</b><small>Quiet background work: no news, no message.</small></span><Segmented label="How often" value={otherEvery !== null ? "other" : everyChoice(every)} options={EVERY.map(([id, name]) => ({ id, name }))} onChange={v => { if (!admin) return; if (v === "other") setOtherEvery(every); else { setOtherEvery(null); save({ every: v }, v === "0m" ? "Check-ins are off." : "Saved how often it checks in."); } }} /></div>
      {otherEvery !== null && <form className="au-describe" onSubmit={e => { e.preventDefault(); save({ every: otherEvery.trim() || null }, "Saved how often it checks in."); setOtherEvery(null); }}><input className="inp" aria-label="Every" placeholder="45m, 2h…" value={otherEvery} onChange={e => setOtherEvery(e.target.value)} /><button type="submit" className="btn sm" disabled={!admin}>Save</button></form>}
      <div className={admin ? "au-setrow" : "au-setrow au-off"} title={shownWhy(why)}><span><b>Which hours</b><small>Outside these hours it waits.</small></span><Segmented label="Which hours" value={otherHours ? "other" : hoursChoice(active)} options={HOURS.map(([id, name]) => ({ id, name }))} onChange={v => { if (!admin) return; const h = HOURS.find(x => x[0] === v)!; if (v === "other") setOtherHours({ start: str(active.start) || "08:00", end: str(active.end) || "20:00" }); else { setOtherHours(null); save({ activeHours: v === "always" ? null : { start: h[2], end: h[3] } }, "Saved which hours it checks in."); } }} /></div>
      {otherHours && <form className="au-describe" onSubmit={e => { e.preventDefault(); save({ activeHours: { start: otherHours.start, end: otherHours.end } }, "Saved which hours it checks in."); setOtherHours(null); }}><input className="inp" type="time" aria-label="From" value={otherHours.start} onChange={e => setOtherHours({ ...otherHours, start: e.target.value })} /><input className="inp" type="time" aria-label="Until" value={otherHours.end} onChange={e => setOtherHours({ ...otherHours, end: e.target.value })} /><button type="submit" className="btn sm" disabled={!admin}>Save</button></form>}
      <SwitchRow title="Quiet on weekends" sub="It still tells you if a Trunk is stuck." on={false} change={() => undefined} disabled="Needs a days-of-the-week setting in the engine’s check-in hours." />
      {agentId && <WhatItChecks engine={engine} agentId={agentId} trunk={trunk} level={level} canWrite={admin} />}
      {shows(level, "advanced") && <Note engine={engine} trunk={trunk} agentId={agentId} canWake={canWake} run={run} />}
      <LastCheckins last={data?.last ?? null} />
    </section>
    <Section title="Long goals" hint={`Goals for a quarter, a year or longer. ${trunk} asks how it’s going on its schedule and keeps your answers.`}>
      <ToolRow icon="target" title="A goal for this year" sub="Each goal has its own check-in schedule." button="Add" reason="Needs the engine’s long-goals store." />
    </Section>
  </div>;
}
