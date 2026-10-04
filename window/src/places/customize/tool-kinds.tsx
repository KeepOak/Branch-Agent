// Tools › Command-line tools, Agents and Toolsets (preview 40-places.js TOOLS9, 42-placesbp.js cza*).
// Command-line tools: the programs the skills need (skills.status requirements), with the commands
// exec.approvals allows. Agents: the coding agents the engine can hand work to (acpx.agents.list), switched
// in config. Toolsets: the engine's tool groups (tools.catalog) and starting set (tools.profile).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { Dialog } from "../../shell/Dialog";
import { Switch } from "../../shell/Popover";
import { useResource } from "../library/data";
import { Status } from "../library/ui";
import { agentEntry, denyList, denyPatch, Dot, Grey, list, PermRow, Pill, rec, Sec, Seg, str, WhoChips, withItem } from "./common";
import { Glyph } from "./glyphs";
import type { ToolsCtx } from "./tools";

// ---- Command-line tools ----
type Bin = { name: string; present: boolean; skills: string[] };
export function readBins(result: unknown): Bin[] {
  const bins = new Map<string, Bin>();
  for (const s of list(rec(result).skills)) {
    const req = rec(s.requirements), miss = rec(s.missing);
    const names = [...(Array.isArray(req.bins) ? req.bins : []), ...(Array.isArray(req.anyBins) ? req.anyBins : [])].filter((b): b is string => typeof b === "string");
    const missing = new Set([...(Array.isArray(miss.bins) ? miss.bins : []), ...(Array.isArray(miss.anyBins) ? miss.anyBins : [])]);
    for (const n of names) {
      const bin = bins.get(n) ?? { name: n, present: !missing.has(n), skills: [] };
      if (missing.has(n)) bin.present = false;
      bin.skills.push(str(s.name));
      bins.set(n, bin);
    }
  }
  return [...bins.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function cliCount(ctx: ToolsCtx): number | null {
  return ctx.skills.data ? readBins(ctx.skills.data).filter(b => b.present).length : null;
}
const ASKS: Record<string, string> = { off: "Nothing", "on-miss": "Anything not allowed", always: "Every command" };

export function Clis({ ctx }: { ctx: ToolsCtx }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const bins = readBins(ctx.skills.data);
  const bin = bins.find(b => b.name === chosen) ?? bins[0];
  return <>
    <div className="t9-list"><Status {...ctx.skills} />
      {ctx.skills.data != null && !bins.length && <EmptyLine icon={<Glyph name="terminal" size={22} />}>No command-line tools yet.</EmptyLine>}
      {bins.map(b => <button key={b.name} type="button" className="t9-item" aria-current={b.name === bin?.name} onClick={() => setChosen(b.name)}>
        <span className="cz-tile"><Glyph name="terminal" size={16} /></span><span className="grow"><b>{b.name}</b><small>{b.present ? "Used by " : "Not on this computer · needed by "}{b.skills.join(", ")}</small></span>
        {b.present ? <Dot on /> : <Pill tone="bad">Not found</Pill>}
      </button>)}
    </div>
    {bin ? <CliDetail key={bin.name} ctx={ctx} bin={bin} /> : <div className="t9-detail cz-empty-detail" />}
  </>;
}

function CliDetail({ ctx, bin }: { ctx: ToolsCtx; bin: Bin }) {
  const approvals = useResource<unknown>(ctx.engine, "exec.approvals.get");
  const file = rec(rec(approvals.data).file);
  const agents = rec(file.agents);
  const scopeKey = ctx.whose ?? "*";
  const allowed = list(rec(agents[scopeKey]).allowlist).map(a => str(a.pattern)).filter(p => p.split(/[\\/]/).pop()?.split(/\s/)[0]?.replace(/\.exe$/i, "") === bin.name);
  const ask = str(rec(agents[scopeKey]).ask) || str(rec(rec(approvals.data).resolvedDefaults).ask);
  return <div className="t9-detail" data-testid="cli-detail">
    <div className="t9-dh"><span className="cz-tile big"><Glyph name="terminal" /></span><span className="grow"><b>{bin.name}</b><small>{bin.present ? "On this computer" : "Not found on this computer"}</small></span></div>
    <Sec title="Commands"><Status {...approvals} />{approvals.data != null && <dl className="cz-kv cz-box"><dt>Allowed</dt><dd>{allowed.length ? allowed.map(a => <code key={a}>{a}</code>) : "None yet"}</dd><dt>Asks first</dt><dd>{ASKS[ask] ?? "As the conversation’s mode says"}</dd></dl>}</Sec>
    <div className="cz-line"><span>Ask before each command<small>The conversation’s mode still applies.</small></span><button type="button" role="switch" aria-checked={false} aria-label="Ask before each command" className="switch" disabled title="Needs a per-program ask setting in the engine." /></div>
    <Sec title="Used by"><p className="cz-hint">{bin.skills.join(", ")}</p></Sec>
  </div>;
}

export function AddTool({ ctx, close }: { ctx: ToolsCtx; close: () => void }) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const allow = async () => {
    setBusy(true); setError(null);
    try {
      const current = rec(await ctx.engine.request("exec.approvals.get", {}));
      const file = rec(current.file), agents = rec(file.agents), key = ctx.whose ?? "*", entry = rec(agents[key]);
      const allowlist = [...list(entry.allowlist), { pattern: path.trim() }];
      await ctx.engine.request("exec.approvals.set", { file: { ...file, version: 1, agents: { ...agents, [key]: { ...entry, allowlist } } }, ...(str(current.hash) ? { baseHash: str(current.hash) } : {}) });
      setAdded(a => [...a, path.trim()]); setPath("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="Add a command-line tool" onClose={close} footer={<button type="button" className="btn pri" onClick={close}>Done</button>}>
    <p className="dlg-p">Found on this computer. Allow one and choose what it may run without asking.</p>
    <p className="cz-hint" title="The engine lists this computer's programs only to its own computers.">Finding programs needs the engine’s program list for this window.</p>
    <label className="cz-field"><span>Or add one by its path</span><span className="cz-row"><input className="inp" value={path} onChange={e => setPath(e.target.value)} placeholder="/usr/local/bin/gh" /><button type="button" className="btn sm" disabled={busy || !path.trim()} onClick={() => void allow()}>Allow</button></span></label>
    {added.map(a => <p key={a} role="status" className="cz-hint">{a} is allowed.</p>)}
    {error && <p role="alert" className="cz-error">{error}</p>}
  </Dialog>;
}

// ---- Agents ----
type Agent = { id: string; name: string; runtimeId: string; installation: string; enabled: boolean };
function readAgents(result: unknown): Agent[] {
  return list(rec(result).agents).map(a => ({ id: str(a.id), name: str(a.name) || str(a.id), runtimeId: str(a.runtimeId), installation: str(a.installation), enabled: a.enabled !== false }));
}
export function agentCount(ctx: ToolsCtx): number | null {
  return ctx.agents.data ? readAgents(ctx.agents.data).filter(a => a.enabled).length : null;
}
export function Agents({ ctx }: { ctx: ToolsCtx }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const agents = readAgents(ctx.agents.data);
  const agent = agents.find(a => a.id === chosen) ?? agents[0];
  return <>
    <div className="t9-list"><Status {...ctx.agents} />
      {ctx.agents.data != null && !agents.length && <EmptyLine icon={<Glyph name="people" size={22} />}>No agents yet.</EmptyLine>}
      {agents.map(a => <button key={a.id} type="button" className="t9-item" aria-current={a.id === agent?.id} onClick={() => setChosen(a.id)}>
        <span className="cz-tile"><Glyph name="terminal" size={16} /></span><span className="grow"><b>{a.name}</b><small>ACP · {a.runtimeId}</small></span>
        {a.installation === "missing" ? <Pill tone="warn">Not installed</Pill> : <Dot on={a.enabled} />}
      </button>)}
    </div>
    {agent ? <div className="t9-detail" data-testid="agent-detail">
      <div className="t9-dh"><span className="cz-tile big"><Glyph name="terminal" /></span><span className="grow"><b>{agent.name}</b><small>ACP · {agent.runtimeId}{agent.installation === "missing" ? " · not installed on this computer" : ""}</small></span>
        <Switch label={`${agent.name} on or off`} on={agent.enabled} onChange={on => { void ctx.config.patch({ plugins: { entries: { acpx: { config: { nativeAgents: { [agent.id]: on } } } } } }).then(ok => ok && ctx.agents.reload()); }} /></div>
      {ctx.config.writeError && <p role="alert" className="cz-error">{ctx.config.writeError}</p>}
      <Sec title="Rules"><dl className="cz-kv cz-box"><dt>Runs as</dt><dd><code>{agent.runtimeId}</code></dd></dl></Sec>
      <div className="cz-acts"><Grey reason="Needs the engine's agent test method.">Test it</Grey><Grey reason="Needs the engine's agent update check.">Check for updates</Grey></div>
    </div> : <div className="t9-detail cz-empty-detail" />}
  </>;
}
export function AddAgent({ close }: { close: () => void }) {
  return <Dialog title="Connect another agent" onClose={close} footer={<button type="button" className="btn ghost" onClick={close}>Cancel</button>}>
    <div className="cz-provs">
      <div className="cz-prov"><b>An agent with an A2A card</b><small>Paste the address of its card.</small><Grey reason="Needs the engine's A2A connection method.">Connect</Grey></div>
      <div className="cz-prov"><b>Branch on another computer</b><small>Its Trunks answer here.</small><Grey reason="Needs the engine's link to another Branch.">Connect</Grey></div>
      <div className="cz-prov"><b>An agent on your KeepOak computer</b><small>Runs in the cloud, answers here.</small><Grey reason="Needs keepoak.com sign-in in the engine.">Connect</Grey></div>
    </div>
  </Dialog>;
}

// ---- Toolsets ----
type Group = { id: string; label: string; tools: { id: string; profiles: string[] }[] };
function readGroups(result: unknown): Group[] {
  return list(rec(result).groups).filter(g => str(g.source) === "core").map(g => ({ id: str(g.id), label: str(g.label), tools: list(g.tools).map(t => ({ id: str(t.id), profiles: Array.isArray(t.defaultProfiles) ? t.defaultProfiles.map(String) : [] })) }));
}
function profileOf(ctx: ToolsCtx): { value: string; by: string } {
  const file = ctx.config.data?.file ?? {};
  const own = ctx.whose ? str(rec(agentEntry(file, ctx.whose).tools).profile) : "";
  if (own) return { value: own, by: "this Trunk" };
  const every = str(rec(file.tools).profile);
  return every ? { value: every, by: "every Trunk" } : { value: "full", by: "built in" };
}
const groupKey = (g: Group) => `group:${g.id}`;
function groupOn(ctx: ToolsCtx, g: Group, agentId: string | null) {
  const file = ctx.config.data?.file ?? {};
  return !denyList(file, null).includes(groupKey(g)) && (!agentId || !denyList(file, agentId).includes(groupKey(g)));
}
export function toolsetCount(ctx: ToolsCtx): number | null {
  return ctx.catalog.data && ctx.config.data ? readGroups(ctx.catalog.data).filter(g => groupOn(ctx, g, ctx.whose)).length : null;
}

export function Toolsets({ ctx }: { ctx: ToolsCtx }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const groups = readGroups(ctx.catalog.data);
  const group = groups.find(g => g.id === chosen) ?? groups[0];
  const profile = profileOf(ctx);
  const file = ctx.config.data?.file ?? {};
  const deny = denyList(file, ctx.whose);
  const toolOn = (t: { id: string; profiles: string[] }, g: Group) => groupOn(ctx, g, ctx.whose) && !deny.includes(t.id) && (profile.value === "full" || t.profiles.includes(profile.value));
  const total = groups.reduce((n, g) => n + g.tools.length, 0);
  const on = groups.reduce((n, g) => n + g.tools.filter(t => toolOn(t, g)).length, 0);
  const setProfile = (v: string) => { const value = v === "same" ? null : v; void ctx.config.patch(ctx.whose ? { agents: { list: [{ id: ctx.whose, tools: { profile: value } }] } } : { tools: { profile: value } }); };
  const setAll = (enable: boolean) => { const next = deny.filter(d => !groups.some(g => groupKey(g) === d)); const p = denyPatch(ctx.whose, enable ? next : [...next, ...groups.map(groupKey)]); void ctx.config.patch(p.raw, p.replacePaths); };
  const options = [{ id: "minimal", name: "Minimal" }, { id: "coding", name: "Coding" }, { id: "messaging", name: "Messaging" }, { id: "full", name: "Full" }, ...(ctx.whose ? [{ id: "same", name: "Same as every Trunk" }] : [])];
  return <>
    <div className="t9-list">
      <div className="cz-toolset-head"><b>Starting set</b>
        <Seg label="Starting set" value={ctx.whose && profile.by !== "this Trunk" ? "same" : profile.value} change={setProfile} options={options} disabled={ctx.config.busy || !ctx.config.data ? "Loading settings" : undefined} />
        <small>Full gives every tool; it doesn’t give Full access permission.</small>
        <small>Set by: {profile.by} · {on} of {total} tools on</small>
        <span className="cz-acts"><button type="button" className="btn ghost sm" disabled={ctx.config.busy} onClick={() => setAll(true)}>Turn all on</button><button type="button" className="btn ghost sm" disabled={ctx.config.busy} onClick={() => setAll(false)}>Turn all off</button></span>
      </div>
      {ctx.config.writeError && <p role="alert" className="cz-error">{ctx.config.writeError}</p>}
      <Status {...ctx.catalog} />
      {ctx.catalog.data != null && !groups.length && <EmptyLine icon={<Glyph name="grid" size={22} />}>No toolsets yet.</EmptyLine>}
      {groups.map(g => <button key={g.id} type="button" className="t9-item" aria-current={g.id === group?.id} onClick={() => setChosen(g.id)}>
        <span className="cz-tile"><Glyph name="grid" size={16} /></span><span className="grow"><b>{g.label}</b><small>{g.tools.length} tools: {g.tools.slice(0, 4).map(t => t.id).join(", ")}{g.tools.length > 4 ? "…" : ""}</small></span><Dot on={groupOn(ctx, g, ctx.whose)} />
      </button>)}
    </div>
    {group ? <ToolsetDetail key={group.id} ctx={ctx} group={group} /> : <div className="t9-detail cz-empty-detail" />}
  </>;
}

function ToolsetDetail({ ctx, group }: { ctx: ToolsCtx; group: Group }) {
  const file = ctx.config.data?.file ?? {};
  const setGroup = (agentId: string | null, on: boolean) => { const p = denyPatch(agentId, withItem(denyList(file, agentId), groupKey(group), !on)); void ctx.config.patch(p.raw, p.replacePaths); };
  const deny = denyList(file, ctx.whose);
  const setTool = (tool: string, never: boolean) => { const p = denyPatch(ctx.whose, withItem(deny, tool, never)); void ctx.config.patch(p.raw, p.replacePaths); };
  return <div className="t9-detail" data-testid="toolset-detail">
    <div className="t9-dh"><span className="cz-tile big"><Glyph name="grid" /></span><span className="grow"><b>{group.label}</b><small>Comes with Branch · {group.tools.length} tools</small></span>
      <Switch label={`${group.label} on or off`} on={groupOn(ctx, group, ctx.whose)} onChange={on => setGroup(ctx.whose, on)} /></div>
    {ctx.config.writeError && <p role="alert" className="cz-error">{ctx.config.writeError}</p>}
    {!ctx.whose && <Sec title="Which Trunks may use it"><WhoChips trunks={ctx.trunks} may={id => groupOn(ctx, group, id)} toggle={ctx.config.busy ? undefined : (id, on) => setGroup(id, on)} reason="Saving…" /></Sec>}
    <Sec title="In this toolset">{group.tools.map(t => <PermRow key={t.id} name={t.id} value={deny.includes(t.id) ? "never" : "allowed"} disabled={ctx.config.busy} change={v => setTool(t.id, v === "never")} />)}</Sec>
  </div>;
}
