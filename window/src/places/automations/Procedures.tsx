// Automations › Procedures (§4.6.3.2, preview p40-auto-other + 94-g4p). The engine has no procedure, flow or
// saved-prompt store, so those parts are greyed with their reason (the flow editor opens from a saved
// procedure, so it has nothing to open). [T] Commands, technical edits config `commands` (engine
// src/config/zod-schema.session.ts CommandsSchema) through config.patch.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import { shownWhy } from "../../shell/shown-why";
import type { WindowEngine } from "../../connect/engine";
import { Segmented } from "../../shell/Popover";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { shows, type Level } from "../../places-nav/level";
import { useAct } from "./act";
import { patchConfig } from "./data";
import { Glyph } from "./glyphs";
import { SwitchRow } from "./Proposal";
import { Section, ToolRow } from "./Sections";
import { rec, str, usePlaceData, type Row } from "./runtime";

export const PROCEDURE_NEEDS = {
  store: "Needs the engine’s procedure store.",
  prompts: "Needs the engine’s saved-prompts store.",
};

type Native = "auto" | "on" | "off";
const toNative = (v: unknown): Native => (v === true ? "on" : v === false ? "off" : "auto");
const fromNative = (v: Native): boolean | "auto" => (v === "on" ? true : v === "off" ? false : "auto");
/** The config.patch body for one commands field. */
export const commandsPatch = (field: string, value: unknown): Row => ({ commands: { [field]: value } });

const loadCommands = async (engine: WindowEngine) => rec(rec(rec(await engine.request("config.get", {})).config).commands);

function NativeRow({ title, value, change }: { title: string; value: Native; change: (v: Native) => void }) {
  return <div className="au-setrow"><span><b>{title}</b><small>Auto: shown where the app has a command menu.</small></span><Segmented label={title} value={value} options={[{ id: "auto", name: "Auto" }, { id: "on", name: "On" }, { id: "off", name: "Off" }]} onChange={change} /></div>;
}

function CommandsTechnical({ engine, canWrite }: { engine: WindowEngine; canWrite: boolean }) {
  const state = usePlaceData(engine, loadCommands), { busy, run } = useAct(state.refresh);
  const [owner, setOwner] = useState("");
  const c = state.data ?? {};
  const set = (field: string, value: unknown) => void run(() => patchConfig(engine, commandsPatch(field, value)), "Saved.");
  const owners = Array.isArray(c.ownerAllowFrom) ? c.ownerAllowFrom.map(String) : [];
  const off = canWrite ? undefined : "Needs an owner";
  const flag = (field: string, title: string, sub: string, dflt: boolean) => <SwitchRow key={field} title={title} sub={sub} on={typeof c[field] === "boolean" ? (c[field] as boolean) : dflt} change={v => set(field, v)} disabled={off} />;
  return <Section title="Commands, technical" aside={<button type="button" className="au-link" disabled={!canWrite} title={shownWhy(off)} onClick={() => void run(async () => { const r = rec(await engine.request("config.openFile", {})); if (r.ok !== true) throw new Error(str(r.error) || "The settings file couldn’t be opened."); return r; }, "Opened the settings file on the Gateway’s computer.")}>Edit as text</button>}>
    {state.error && <p className="au-error" role="alert">{state.error}</p>}
    <div className={canWrite && !busy ? "" : "au-off"} title={shownWhy(off)}>
      <NativeRow title="Commands in chat apps’ menus" value={toNative(c.native)} change={v => set("native", fromNative(v))} />
      <NativeRow title="Skills as commands in chat apps’ menus" value={toNative(c.nativeSkills)} change={v => set("nativeSkills", fromNative(v))} />
    </div>
    {flag("text", "Typed commands", "Messages that start with / run as commands.", true)}
    {flag("bash", "Run ! commands from chat apps", "Off until you choose: anyone who can message a Trunk could run commands on this computer.", false)}
    {c.bash === true && <label className="au-field"><span className="au-flabel">Wait before moving it to the background</span><span className="au-inline"><input className="inp au-num" type="number" min="0" max="30" aria-label="Wait before moving it to the background" defaultValue={typeof c.bashForegroundMs === "number" ? c.bashForegroundMs / 1000 : 2} disabled={!canWrite} onBlur={e => set("bashForegroundMs", Math.round(Math.min(30, Math.max(0, Number(e.target.value) || 0)) * 1000))} /><span>seconds</span></span></label>}
    {flag("config", "/config from chats", "Owner only.", false)}
    {flag("mcp", "/mcp from chats", "Owner only.", false)}
    {flag("plugins", "/plugins from chats", "Owner only.", false)}
    {flag("debug", "/debug from chats", "Owner only.", false)}
    {flag("restart", "/restart from chats", "Owner only.", true)}
    <div className="au-checks">
      <h3 className="au-sub">Command owners</h3>
      <p className="au-hint">People allowed owner-only commands.{owners.length ? "" : " None yet."}</p>
      {owners.map(o => <div className="au-check" key={o}><span className="au-grow au-mono">{o}</span><button type="button" className="ib" aria-label={`Take out ${o}`} disabled={!canWrite || busy} title={shownWhy(off)} onClick={() => set("ownerAllowFrom", owners.filter(x => x !== o))}><Glyph name="x" /></button></div>)}
      <form className="au-describe" onSubmit={e => { e.preventDefault(); if (owner.trim()) { set("ownerAllowFrom", [...owners, owner.trim()]); setOwner(""); } }}>
        <input className="inp" aria-label="Add a command owner" placeholder="A chat ID or phone number" value={owner} disabled={!canWrite} onChange={e => setOwner(e.target.value)} />
        <button type="submit" className="btn sm" disabled={!canWrite || busy || !owner.trim()}>Add</button>
      </form>
    </div>
  </Section>;
}

export function ProceduresTab({ engine, level }: { engine: WindowEngine; level: Level }) {
  const canWrite = engine.scopes.includes("operator.admin");
  return <div className="au-tab">
    <p className="au-hint">Saved steps a Trunk can run again.</p>
    <div className="au-actions"><button type="button" className="btn" disabled title={shownWhy(PROCEDURE_NEEDS.store)}><Glyph name="teach" size={14} />Show a Trunk how, once</button></div>
    <EmptyLine icon={<Glyph name="flow" size={22} />}>No procedures yet. Show a Trunk how once, and it saves the steps to run again.</EmptyLine>
    <Section title="Your saved prompts" hint="Things you ask for often. Each has its own command that works in the window, on the phone, in the terminal and in chat apps.">
      <ToolRow icon="star" title="New prompt" sub="A prompt with blanks to fill in, and its own command." button="New prompt" reason={PROCEDURE_NEEDS.prompts} />
    </Section>
    {shows(level, "technical") && <CommandsTechnical engine={engine} canWrite={canWrite} />}
    {shows(level, "technical") && <Section title="Recipes" hint="Shareable files with the steps, settings and what a procedure asks for.">
      <ToolRow icon="form" title="Save a procedure as a recipe…" sub="A recipe’s link opens it in Branch." button="Save" reason={PROCEDURE_NEEDS.store} />
    </Section>}
  </div>;
}
