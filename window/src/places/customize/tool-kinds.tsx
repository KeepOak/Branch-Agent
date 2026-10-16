// Tools › Command-line tools, Agents and Toolsets (preview 40-places.js TOOLS9, 42-placesbp.js cza*).
// Command-line tools: the programs the skills need (skills.status requirements), with the commands
// exec.approvals allows. Agents: the coding agents the engine can hand work to (acpx.agents.list), switched
// in config. Toolsets: the engine's tool groups (tools.catalog) and starting set (tools.profile).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { shows } from "../../places-nav/level";
import { Dialog } from "../../shell/Dialog";
import { BranchLinkDialog } from "../../shell/BranchLinkDialog";
import { Switch } from "../../shell/Popover";
import { useResource } from "../library/data";
import { Status } from "../library/ui";
import { agentEntry, denyList, denyPatch, Dot, Grey, list, PermRow, Pill, rec, Sec, Seg, str, WhoChips, withItem } from "./common";
import { Glyph } from "./glyphs";
import { KindHead, TechnicalOnly } from "./kind-chrome";
import { AgentsTeamwork } from "./agent-teamwork";
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
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bins = readBins(ctx.skills.data);
  const q = ctx.query.trim().toLowerCase();
  const shown = bins.filter(b => !q || b.name.toLowerCase().includes(q));
  const bin = shown.find(b => b.name === chosen) ?? shown[0];
  const add = async () => {
    setBusy(true); setError(null);
    try { await allowCommand(ctx, path.trim()); setPath(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <>
    <KindHead ctx={ctx} kind="Command-line tools" count={`${bins.filter(b => b.present).length} of ${bins.length} on`}>
      <TechnicalOnly><div className="cz-found"><b>Found on this computer</b><Grey reason="Finding programs on this computer comes in a later update.">Allow</Grey></div></TechnicalOnly>
      <div className="cz-path"><input id="cz-clis-path" className="inp" value={path} onChange={e => setPath(e.target.value)} placeholder="Or add one by its path, like /usr/local/bin/rg" aria-label="Add a command-line tool by its path" />
        <button type="button" className="btn sm" disabled={busy || !path.trim()} onClick={() => void add()}>Add</button></div>
      {error && <p role="alert" className="cz-error">{error}</p>}
      <Status {...ctx.skills} />
      {ctx.skills.data != null && !shown.length && <EmptyLine icon={<Glyph name="terminal" size={22} />}>Nothing here for this Trunk.</EmptyLine>}
      {shown.map(b => <button key={b.name} type="button" className="t9-item" aria-current={b.name === bin?.name} onClick={() => setChosen(b.name)}>
        <span className="cz-tile"><Glyph name="terminal" size={16} /></span><span className="grow"><b>{b.name}</b><small>{b.present ? "Used by " : "Not on this computer · needed by "}{b.skills.join(", ")}</small></span>
        {b.present ? <Dot on /> : <Pill tone="bad">Not found</Pill>}
      </button>)}
    </KindHead>
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
    <TechnicalOnly><Sec title="Who may use it"><div className="cz-line"><span>Which Trunks may use it</span><Grey reason="Choosing which Trunks may run a command comes in a later update.">Choose</Grey></div></Sec></TechnicalOnly>
    <Sec title="What it may do"><h3 className="cz-h3">Commands</h3><Status {...approvals} />{approvals.data != null && <dl className="cz-kv cz-box"><dt>Allowed</dt><dd>{allowed.length ? allowed.map(a => <code key={a}>{a}</code>) : "None yet"}</dd><dt>Asks first</dt><dd>{ASKS[ask] ?? "As the conversation"}</dd></dl>}
      <TechnicalOnly><div className="cz-line"><span>Ask before each command<small>The conversation’s mode still applies.</small></span><Grey className="switch" reason="Asking before each command comes in a later update."><span /></Grey></div></TechnicalOnly></Sec>
    <Sec title="Set it up"><h3 className="cz-h3">Used by</h3><p className="cz-hint">{bin.skills.join(", ")}</p></Sec>
    <Sec title="Safety check"><dl className="cz-kv"><dt>Preflight</dt><dd>Not checked yet</dd><dt>Malware scan</dt><dd>Not checked yet</dd><dt>Fingerprint</dt><dd>Not checked yet</dd><dt>Hidden instructions</dt><dd>Not checked yet</dd></dl></Sec>
    <Sec title="Version & updates"><dl className="cz-kv"><dt>Came from</dt><dd>This computer</dd></dl>
      <TechnicalOnly><div className="cz-acts"><Grey reason="Checking a program for updates comes in a later update.">Check for updates</Grey><Grey reason="Putting an older version back comes in a later update.">Put an older version back</Grey></div></TechnicalOnly></Sec>
    <TechnicalOnly><Sec title="Actions"><div className="cz-acts"><Grey reason="Copying a program’s seed comes in a later update.">Copy seed</Grey><Grey reason="Downloading a program comes in a later update.">Download</Grey><Grey reason="Copying a program to another Trunk comes in a later update.">Copy to another Trunk</Grey><Grey reason="Testing a program comes in a later update.">Test it</Grey></div></Sec></TechnicalOnly>
  </div>;
}

/** Allows one program by its path in the engine's exec approvals, for the Trunks this view is scoped to. */
async function allowCommand(ctx: ToolsCtx, path: string): Promise<void> {
  const current = rec(await ctx.engine.request("exec.approvals.get", {}));
  const file = rec(current.file), agents = rec(file.agents), key = ctx.whose ?? "*", entry = rec(agents[key]);
  const allowlist = [...list(entry.allowlist), { pattern: path }];
  await ctx.engine.request("exec.approvals.set", { file: { ...file, version: 1, agents: { ...agents, [key]: { ...entry, allowlist } } }, ...(str(current.hash) ? { baseHash: str(current.hash) } : {}) });
}

export function AddTool({ ctx, close }: { ctx: ToolsCtx; close: () => void }) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const allow = async () => {
    setBusy(true); setError(null);
    try { await allowCommand(ctx, path.trim()); setAdded(a => [...a, path.trim()]); setPath(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
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
  const q = ctx.query.trim().toLowerCase();
  const shown = agents.filter(a => !q || `${a.name} ${a.runtimeId}`.toLowerCase().includes(q));
  const agent = shown.find(a => a.id === chosen) ?? shown[0];
  return <>
    <KindHead ctx={ctx} kind="Agents" count={`${agents.filter(a => a.enabled).length} of ${agents.length} on`}>
      <Status {...ctx.agents} />
      <h3 className="cz-h3">Connected agents</h3>
      {ctx.agents.data != null && !shown.length && <EmptyLine icon={<Glyph name="people" size={22} />}>Nothing here for this Trunk.</EmptyLine>}
      {shown.map(a => <button key={a.id} type="button" className="t9-item" aria-current={a.id === agent?.id} onClick={() => setChosen(a.id)}>
        <span className="cz-tile"><Glyph name="terminal" size={16} /></span><span className="grow"><b>{a.name}</b><small>ACP · {a.runtimeId}</small></span>
        {a.installation === "missing" ? <Pill tone="warn">Not installed</Pill> : <Dot on={a.enabled} />}
      </button>)}
      <AgentsTeamwork ctx={ctx} />
      {shows(ctx.level, "technical") && <><h3 className="cz-h3">Use Branch as an MCP server <span className="cz-tag">Technical</span></h3>
        <div className="cz-line"><span>Other apps may call your Trunks over MCP</span><Grey className="switch" reason="Letting other apps call your Trunks over MCP comes in a later update."><span /></Grey></div></>}
    </KindHead>
    {agent ? <div className="t9-detail" data-testid="agent-detail">
      <div className="t9-dh"><span className="cz-tile big"><Glyph name="terminal" /></span><span className="grow"><b>{agent.name}</b><small>ACP · {agent.runtimeId}{agent.installation === "missing" ? " · not installed on this computer" : ""}</small></span>
        <Switch label={`${agent.name} on or off`} on={agent.enabled} onChange={on => { void ctx.config.patch({ plugins: { entries: { acpx: { config: { nativeAgents: { [agent.id]: on } } } } } }).then(ok => ok && ctx.agents.reload()); }} /></div>
      {ctx.config.writeError && <p role="alert" className="cz-error">{ctx.config.writeError}</p>}
      <TechnicalOnly><Sec title="Who may use it"><div className="cz-line"><span>Which Trunks may use it</span><Grey reason="Choosing which Trunks may talk to an agent comes in a later update.">Choose</Grey></div></Sec>
      <Sec title="What it may do"><div className="cz-line"><span>What it may be asked</span><Grey reason="Choosing what an agent may be asked comes in a later update.">Choose</Grey></div></Sec></TechnicalOnly>
      <Sec title="Set it up"><h3 className="cz-h3">Rules</h3><dl className="cz-kv cz-box"><dt>Runs as</dt><dd><code>{agent.runtimeId}</code></dd></dl>
        <TechnicalOnly><div className="cz-line"><span>Tasks it sends in</span><Grey reason="Choosing what an agent gets with its tasks comes in a later update.">Choose</Grey></div></TechnicalOnly></Sec>
      <Sec title="Safety check"><dl className="cz-kv"><dt>Preflight</dt><dd>Not checked yet</dd><dt>Malware scan</dt><dd>Not checked yet</dd><dt>Fingerprint</dt><dd>Not checked yet</dd><dt>Hidden instructions</dt><dd>Not checked yet</dd></dl></Sec>
      <TechnicalOnly><Sec title="Version & updates"><div className="cz-acts"><Grey reason="Checking an agent for updates comes in a later update.">Check for updates</Grey><Grey reason="Putting an older version back comes in a later update.">Put an older version back</Grey></div></Sec>
      <Sec title="Actions"><div className="cz-acts"><Grey reason="Copying an agent’s seed comes in a later update.">Copy seed</Grey><Grey reason="Downloading an agent comes in a later update.">Download</Grey><Grey reason="Copying an agent to another Trunk comes in a later update.">Copy to another Trunk</Grey><Grey reason="Testing an agent from here comes in a later update.">Test it</Grey></div></Sec></TechnicalOnly>
    </div> : <div className="t9-detail cz-empty-detail" />}
  </>;
}
export function AddAgent({ ctx, close }: { ctx: ToolsCtx; close: () => void }) {
  const [linkBranch, setLinkBranch] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [outboundToken, setOutboundToken] = useState("");
  const [error, setError] = useState("");
  const connect = async () => {
    const peerName = name.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(peerName)) { setError("Use a short name with letters, numbers, dots, dashes or underscores."); return; }
    let address: string;
    try {
      const parsed = new URL(url.trim());
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
      address = parsed.href;
    } catch { setError("Enter an HTTP or HTTPS address."); return; }
    const peers = rec(rec(rec(ctx.config.data?.file?.channels).a2a).peers);
    if (Object.hasOwn(peers, peerName)) { setError("That agent name is already connected."); return; }
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    const ok = await ctx.config.patch({ channels: { a2a: { enabled: true, peers: { [peerName]: {
      token, url: address, ...(outboundToken.trim() ? { outboundToken: outboundToken.trim() } : {}),
    } } } } });
    if (ok) { void ctx.engine.request("a2a.peers.refresh", {}).catch(() => undefined); close(); }
  };
  if (linkBranch) return <BranchLinkDialog engine={ctx.engine} onClose={close} />;
  return <Dialog title="Connect another agent" onClose={close} footer={<><button type="button" className="btn ghost" onClick={close}>Cancel</button><button type="button" className="btn pri" disabled={ctx.config.busy} onClick={() => void connect()}>Connect</button></>}>
    <div className="cz-provs">
      <div className="cz-prov"><b>An agent with an A2A card</b><small>Paste its address. Branch reads what it can do.</small>
        <label>Name<input aria-label="Agent name" value={name} onChange={event => setName(event.target.value)} /></label>
        <label>Address<input aria-label="Agent address" type="url" value={url} onChange={event => setUrl(event.target.value)} /></label>
        <label>Outbound token<input aria-label="Outbound token" type="password" value={outboundToken} onChange={event => setOutboundToken(event.target.value)} /></label>
        {(error || ctx.config.writeError) && <p role="alert" className="cz-error">{error || ctx.config.writeError}</p>}</div>
      <div className="cz-prov"><b>Branch on another computer</b><small>Pair → Let it in → Name it → What it may do, with a check code.</small><button type="button" className="btn sm" onClick={() => setLinkBranch(true)}>Connect</button></div>
      <TechnicalOnly><div className="cz-prov"><b>An agent on your KeepOak computer</b><small>Hermes Agent or another Branch.</small><Grey reason="Connecting to keepoak.com from here comes in a later update.">Connect</Grey></div></TechnicalOnly>
    </div>
  </Dialog>;
}

// ---- Toolsets ----
type Group = { id: string; label: string; tools: { id: string; profiles: string[] }[] };
/** Groups a Trunk made (the catalogue's non-core groups), listed under "Made by Trunks". */
function readMadeGroups(result: unknown): Group[] {
  return list(rec(result).groups).filter(g => str(g.source) !== "core" && str(g.source) !== "").map(g => ({ id: str(g.id), label: str(g.label), tools: list(g.tools).map(t => ({ id: str(t.id), profiles: Array.isArray(t.defaultProfiles) ? t.defaultProfiles.map(String) : [] })) }));
}
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
  const setProfile = (v: string) => { const value = v === "same" ? null : v; void ctx.config.patch(ctx.whose ? { agents: { entries: { [ctx.whose]: { tools: { profile: value } } } } } : { tools: { profile: value } }); };
  const setAll = (enable: boolean) => { const next = deny.filter(d => !groups.some(g => groupKey(g) === d)); const p = denyPatch(ctx.whose, enable ? next : [...next, ...groups.map(groupKey)]); void ctx.config.patch(p.raw, p.replacePaths); };
  const options = [{ id: "minimal", name: "Minimal" }, { id: "coding", name: "Coding" }, { id: "messaging", name: "Messaging" }, { id: "full", name: "Full" }, ...(ctx.whose ? [{ id: "same", name: "Same as every Trunk" }] : [])];
  const madeByTrunks = readMadeGroups(ctx.catalog.data).filter(g => !ctx.query.trim() || g.label.toLowerCase().includes(ctx.query.trim().toLowerCase()));
  return <>
    <KindHead ctx={ctx} kind="Toolsets" count={`${on} of ${total} on`}>
      <div className="cz-toolset-head"><b>Starting set</b>
        <Seg label="Starting set" value={ctx.whose && profile.by !== "this Trunk" ? "same" : profile.value} change={setProfile} options={options} disabled={ctx.config.busy || !ctx.config.data ? "Loading settings" : undefined} />
        <small>Full gives every tool; it doesn’t give Full access permission.</small>
        <small>Set by: {profile.by} · {on} of {total} tools on</small>
        <span className="cz-acts"><button type="button" className="btn ghost sm" disabled={ctx.config.busy} onClick={() => setAll(true)}>Turn all on</button><button type="button" className="btn ghost sm" disabled={ctx.config.busy} onClick={() => setAll(false)}>Turn all off</button></span>
      </div>
      {ctx.config.writeError && <p role="alert" className="cz-error">{ctx.config.writeError}</p>}
      <Status {...ctx.catalog} />
      {ctx.catalog.data != null && !groups.length && <EmptyLine icon={<Glyph name="grid" size={22} />}>No toolsets yet.</EmptyLine>}
      {madeByTrunks.length > 0 && <h3 className="cz-h3">Made by Trunks</h3>}
      {madeByTrunks.map(g => <button key={g.id} type="button" className="t9-item" aria-current={g.id === group?.id} onClick={() => setChosen(g.id)}>
        <span className="cz-tile"><Glyph name="grid" size={16} /></span><span className="grow"><b>{g.label}</b><small>{g.tools.length} {g.tools.length === 1 ? "tool" : "tools"}: {g.tools.slice(0, 4).map(t => t.id).join(", ")}</small></span>
      </button>)}
      {groups.map(g => <button key={g.id} type="button" className="t9-item" aria-current={g.id === group?.id} onClick={() => setChosen(g.id)}>
        <span className="cz-tile"><Glyph name="grid" size={16} /></span><span className="grow"><b>{g.label}</b><small>{g.tools.length} tools: {g.tools.slice(0, 4).map(t => t.id).join(", ")}{g.tools.length > 4 ? "…" : ""}</small></span><Dot on={groupOn(ctx, g, ctx.whose)} />
      </button>)}
    </KindHead>
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
