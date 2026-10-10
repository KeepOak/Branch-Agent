// Tools › Skills (preview 42-placesbp.js czs*, 93-g3p.js): skills.status rows with filters, the Gardener
// (skills.gardener.status), Suggested and Drafts (skills.proposals.*), the detail with skills.update and
// skills.install, kept versions (skills.library.*), and "Add a skill" (skills.search / skills.install).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState, type ReactNode } from "react";
import { displayName, invocationName } from "../../display-names";
import { shownWhy } from "../../shell/shown-why";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { shows } from "../../places-nav/level";
import { Dialog } from "../../shell/Dialog";
import { Icon } from "../../shell/icons";
import { Switch } from "../../shell/Popover";
import { useOperation, useResource } from "../library/data";
import { Status } from "../library/ui";
import { ago, Dot, Grey, list, Pill, rec, Sec, Seg, str, type Rec } from "./common";
import { Glyph } from "./glyphs";
import type { ToolsCtx } from "./tools";

export type Skill = { key: string; name: string; rawName: string; description: string; source: string; disabled: boolean; eligible: boolean; missing: string[]; installs: { id: string; label: string }[]; always: boolean; userInvocable: boolean; filePath: string; registry: boolean; raw: Rec };
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
export function readSkillRows(result: unknown): Skill[] {
  return list(rec(result).skills).filter(s => s.modelVisible !== false || s.disabled === true).map(s => {
    const m = rec(s.missing);
    return {
      key: str(s.skillKey) || str(s.name), name: displayName(str(s.name)), rawName: str(s.name), description: str(s.description),
      source: s.bundled === true ? "Built in" : str(s.source) === "workspace" ? "In this Trunk’s folder" : "Installed",
      disabled: s.disabled === true, eligible: s.eligible !== false,
      missing: [...strings(m.bins).map(b => `the ${b} program`), ...strings(m.anyBins).map(b => `the ${b} program`), ...strings(m.env).map(e => `the ${e} key`), ...strings(m.config).map(c => `the ${c} setting`), ...strings(m.os).map(o => `${o}`)],
      installs: list(s.install).map(i => ({ id: str(i.id), label: str(i.label) || str(i.id) })).filter(i => i.id),
      always: s.always === true, userInvocable: s.userInvocable === true, filePath: str(s.filePath), registry: !!s.clawhub, raw: s,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
type St = "all" | "ready" | "setup" | "off";
const stOf = (s: Skill): St => (s.disabled ? "off" : s.eligible ? "ready" : "setup");
export function skillCount(ctx: ToolsCtx): number | null {
  return ctx.skills.data ? readSkillRows(ctx.skills.data).filter(s => stOf(s) === "ready").length : null;
}
type Proposal = { id: string; kind: string; status: string; title: string; description: string; skillName: string; revisionHash: string; createdAt: string };
function readProposals(result: unknown): Proposal[] {
  return list(rec(result).proposals).map(p => ({ id: str(p.id), kind: str(p.kind), status: str(p.status), title: str(p.title), description: str(p.description), skillName: str(p.skillName), revisionHash: str(p.revisionHash), createdAt: str(p.createdAt) }));
}
const scopeOf = (ctx: ToolsCtx) => (ctx.whose ? { agentId: ctx.whose } : {});
/** The engine gets the raw skill name; the display name is for people only. */
export function skillInstallParams(scope: Rec, skill: Skill, installId: string): Rec {
  return { ...scope, name: skill.rawName, installId };
}

export function Skills({ ctx }: { ctx: ToolsCtx }) {
  const [view, setView] = useState<"skills" | "drafts">("skills");
  const proposals = useResource<unknown>(ctx.engine, "skills.proposals.list", scopeOf(ctx));
  const all = readProposals(proposals.data);
  const waiting = all.filter(p => p.status === "pending");
  const rows = readSkillRows(ctx.skills.data);
  const head = <Seg label="Skills or drafts" value={view} change={setView} options={[{ id: "skills", name: `Skills (${rows.length})` }, { id: "drafts", name: `Drafts (${waiting.length} waiting)` }]} />;
  return view === "skills" ? <SkillList ctx={ctx} head={head} rows={rows} suggestion={waiting[0]} reloadProposals={proposals.reload} /> : <Drafts ctx={ctx} head={head} proposals={proposals} all={all} />;
}

function SkillList({ ctx, head, rows, suggestion, reloadProposals }: { ctx: ToolsCtx; head: ReactNode; rows: Skill[]; suggestion?: Proposal; reloadProposals: () => void }) {
  const [st, setSt] = useState<St>("all");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const count = (s: St) => (s === "all" ? rows.length : rows.filter(r => stOf(r) === s).length);
  const q = query.trim().toLowerCase();
  const shown = rows.filter(r => (st === "all" || stOf(r) === st) && (!q || (r.name + " " + r.description).toLowerCase().includes(q)));
  const skill = shown.find(r => r.key === chosen) ?? shown[0];
  return <>
    <div className="t9-list">{head}
    <div className="cz-chips" role="group" aria-label="Show">{([["all", "All"], ["ready", "Ready"], ["setup", "Needs setup"], ["off", "Off"]] as [St, string][]).map(([id, name]) =>
      <button key={id} type="button" className="cz-chip" aria-pressed={st === id} onClick={() => setSt(id)}>{name} <em>{count(id)}</em></button>)}</div>
    <div className="cz-filter"><label className="cz-search"><Icon name="search" small /><input type="search" aria-label="Filter skills" placeholder="Filter skills" value={query} onChange={e => setQuery(e.target.value)} /></label><small aria-live="polite">{shown.length} shown</small></div>
    <Gardener ctx={ctx} />
    {suggestion && <Suggested ctx={ctx} p={suggestion} reload={() => { reloadProposals(); ctx.skills.reload(); }} />}
    <Status {...ctx.skills} />
    {ctx.skills.data != null && !shown.length && <EmptyLine icon={<Glyph name="bolt" size={22} />}>No skills match.</EmptyLine>}
    {shown.map(r => <button key={r.key} type="button" className="t9-item" aria-current={r.key === skill?.key} onClick={() => setChosen(r.key)}>
      <span className="cz-tile"><Glyph name="bolt" size={16} /></span><span className="grow"><b>{r.name}</b><small>{r.source}{r.description ? " · " + r.description : ""}</small></span>
      {stOf(r) === "setup" ? <Pill tone="warn" title={r.missing.length ? "Needs " + r.missing.join(", ") : undefined}>Needs setup</Pill> : <Dot on={stOf(r) === "ready"} />}
    </button>)}
    </div>
    {skill ? <SkillDetail key={skill.key} ctx={ctx} skill={skill} /> : <div className="t9-detail cz-empty-detail" />}
  </>;
}

function Gardener({ ctx }: { ctx: ToolsCtx }) {
  const g = useResource<unknown>(ctx.engine, "skills.gardener.status");
  if (!g.data) return g.error ? <p className="cz-hint">{g.error}</p> : null;
  const d = rec(g.data), c = rec(d.counts);
  const kept = list(d.skills).filter(s => s.pinned === true).length;
  const looked = typeof d.lastSuccessAtMs === "number" ? `Gardener · looked ${ago(d.lastSuccessAtMs)}` : "Gardener · hasn’t looked yet";
  return <div className="cz-card cz-garden"><span className="cz-tile"><Glyph name="sparkle" size={16} /></span>
    <span className="grow"><b>{looked}</b><small>{Number(c.active ?? 0)} in use · {Number(c.stale ?? 0)} resting · {Number(c.archived ?? 0)} set aside · {kept} kept in use</small>{str(d.lastError) && <small className="cz-error">{str(d.lastError)}</small>}</span>
    <Grey reason="Needs the engine's gardener run method.">Look now</Grey></div>;
}

function Suggested({ ctx, p, reload }: { ctx: ToolsCtx; p: Proposal; reload: () => void }) {
  const op = useOperation(ctx.engine);
  const [tried, setTried] = useState(false);
  const base = { ...scopeOf(ctx), proposalId: p.id, expectedRevisionHash: p.revisionHash };
  const reason = p.revisionHash ? undefined : "The engine did not supply a revision for a safe change.";
  return <div className="cz-card" data-testid="suggested"><div className="cz-card-h"><b>{p.kind === "update" ? `A better version of “${p.skillName}”` : p.title || `A new skill: “${p.skillName}”`}</b><Pill tone="work">Suggested</Pill></div>
    <p>{p.description}</p>{op.error && <p role="alert" className="cz-error">{op.error}</p>}
    <div className="cz-acts"><button type="button" className="btn sm" disabled={op.busy || !!reason} title={shownWhy(reason)} onClick={() => void op.run("skills.proposals.evaluate", base, () => { setTried(true); reload(); })}>{tried ? "Try again" : "Practice run on recent tasks"}</button>
      <button type="button" className="btn pri sm" disabled={op.busy || !!reason} title={shownWhy(reason)} onClick={() => void op.run("skills.proposals.apply", base, reload)}>Keep it</button>
      <button type="button" className="btn ghost sm" disabled={op.busy || !!reason} title={shownWhy(reason)} onClick={() => void op.run("skills.proposals.reject", base, reload)}>Throw it away</button></div>
  </div>;
}

function SkillDetail({ ctx, skill }: { ctx: ToolsCtx; skill: Skill }) {
  const op = useOperation(ctx.engine);
  return <div className="t9-detail" data-testid="skill-detail">
    <div className="t9-dh"><span className="cz-tile big"><Glyph name="bolt" /></span><span className="grow"><b>{skill.name}</b><small>{skill.source}{skill.description ? " · " + skill.description : ""}</small></span>
      <Switch label={`${skill.name} on or off`} on={!skill.disabled} onChange={on => void op.run("skills.update", { skillKey: skill.key, enabled: on }, ctx.skills.reload)} /></div>
    {op.error && <p role="alert" className="cz-error">{op.error}</p>}
    {stOf(skill) === "setup" && <div className="cz-card warn"><b>Needs setting up</b><small>It needs {skill.missing.join(", ") || "something this computer lacks"}.</small>
      {skill.installs.length > 0 && <div className="cz-acts">{skill.installs.map(i => <button key={i.id} type="button" className="btn sm" disabled={op.busy} onClick={() => void op.run("skills.install", skillInstallParams(scopeOf(ctx), skill, i.id), ctx.skills.reload)}>{i.label}</button>)}</div>}</div>}
    {skill.raw.blockedByAgentFilter === true && <p className="cz-hint">This Trunk’s skill list leaves it out.</p>}
    <Sec title="How it’s used"><dl className="cz-kv"><dt>Where it came from</dt><dd>{skill.source}</dd><dt>Use</dt><dd>{skill.userInvocable ? `/${invocationName(skill.rawName)} in a conversation, or when a Trunk needs it` : "When a Trunk needs it"}</dd><dt>Always load it</dt><dd>{skill.always ? "Yes" : "No"}</dd>
      {shows(ctx.level, "technical") && skill.filePath && <><dt>File</dt><dd><code>{skill.filePath}</code></dd></>}</dl></Sec>
    {shows(ctx.level, "advanced") && <KeptVersions ctx={ctx} skill={skill} />}
    <div className="cz-acts">{skill.registry ? <button type="button" className="btn sm" disabled={op.busy} onClick={() => void op.run("skills.update", { ...scopeOf(ctx), source: "clawhub", slug: skill.key }, ctx.skills.reload)}>Check for updates</button> : <Grey reason="Only skills from the skill library can be checked for updates.">Check for updates</Grey>}
      <span className="cz-grow" /><Grey className="btn ghost sm" reason="Needs the engine's skill remove method.">Remove</Grey></div>
  </div>;
}

/** [A] Kept versions: a skill in your library keeps each saved revision (skills.library.list / read). */
function KeptVersions({ ctx, skill }: { ctx: ToolsCtx; skill: Skill }) {
  const library = useResource<unknown>(ctx.engine, "skills.library.list", {});
  const entry = list(rec(library.data).entries).find(e => str(e.slug) === skill.key || str(e.name) === skill.rawName);
  const read = useResource<unknown>(ctx.engine, entry ? "skills.library.read" : null, { skillId: str(entry?.skillId) });
  const revisions = list(rec(read.data).revisions);
  return <Sec title="Kept versions"><Status {...library} />
    {library.data != null && !entry && <p className="cz-hint">Only skills in your library keep versions.</p>}
    {revisions.map((r, i) => <div key={str(r.revision)} className="cz-line"><span>{i === 0 ? "In use" : "Earlier"} · saved {str(r.createdAt) ? new Date(str(r.createdAt)).toLocaleDateString() : ""}</span><code>{str(r.revision).slice(0, 8)}</code></div>)}
  </Sec>;
}

function Drafts({ ctx, head, proposals, all }: { ctx: ToolsCtx; head: ReactNode; proposals: { data: unknown; loading: boolean; error: string | null; reload: () => void }; all: Proposal[] }) {
  const [st, setSt] = useState("pending");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const shown = all.filter(p => (st === "all" || p.status === st) && (!q || (p.title + " " + p.skillName + " " + p.description).toLowerCase().includes(q)));
  const draft = shown.find(p => p.id === chosen) ?? shown[0];
  const words: Record<string, string> = { pending: "Waiting", applied: "Added", rejected: "Turned down", all: "All" };
  return <>
    <div className="t9-list">{head}
    <div className="cz-chips" role="group" aria-label="Drafts">{Object.entries(words).map(([id, name]) => <button key={id} type="button" className="cz-chip" aria-pressed={st === id} onClick={() => setSt(id)}>{name} <em>{id === "all" ? all.length : all.filter(p => p.status === id).length}</em></button>)}</div>
    <label className="cz-search"><Icon name="search" small /><input type="search" aria-label="Search drafts" placeholder="Search drafts" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <Status {...proposals} />
    {proposals.data != null && !shown.length && <EmptyLine icon={<Glyph name="bolt" size={22} />}>{q ? "No drafts match." : "No drafts waiting."}</EmptyLine>}
    {shown.map(p => <button key={p.id} type="button" className="t9-item" aria-current={p.id === draft?.id} onClick={() => setChosen(p.id)}>
      <span className="cz-tile"><Glyph name="bolt" size={16} /></span><span className="grow"><b>{p.skillName || p.title}</b><small>{p.description}{p.createdAt ? " · " + ago(Date.parse(p.createdAt)) : ""}</small></span><Pill tone={p.status === "pending" ? "work" : "idle"}>{words[p.status] ?? p.status}</Pill>
    </button>)}
    </div>
    {draft ? <DraftDetail key={draft.id} ctx={ctx} p={draft} reload={() => { proposals.reload(); ctx.skills.reload(); }} /> : <div className="t9-detail cz-empty-detail" />}
  </>;
}

function DraftDetail({ ctx, p, reload }: { ctx: ToolsCtx; p: Proposal; reload: () => void }) {
  const inspect = useResource<unknown>(ctx.engine, "skills.proposals.inspect", { ...scopeOf(ctx), proposalId: p.id });
  const op = useOperation(ctx.engine);
  const hash = str(rec(inspect.data).revisionHash) || p.revisionHash;
  const base = { ...scopeOf(ctx), proposalId: p.id, expectedRevisionHash: hash };
  const off = op.busy || !hash || p.status !== "pending";
  return <div className="t9-detail" data-testid="draft-detail">
    <div className="t9-dh"><span className="cz-tile big"><Glyph name="bolt" /></span><span className="grow"><b>{p.skillName || p.title}</b><small>{p.title}</small></span></div>
    {op.error && <p role="alert" className="cz-error">{op.error}</p>}
    <div className="cz-acts"><button type="button" className="btn sm" disabled={off} onClick={() => void op.run("skills.proposals.evaluate", base, reload)}>Check it</button>
      <button type="button" className="btn pri sm" disabled={off} onClick={() => void op.run("skills.proposals.apply", base, reload)}>Add it</button>
      <button type="button" className="btn ghost sm" disabled={off} onClick={() => void op.run("skills.proposals.reject", base, reload)}>Turn it down</button></div>
    <Sec title="SKILL.md"><Status {...inspect} />{inspect.data != null && <pre className="cz-pre">{str(rec(inspect.data).content)}</pre>}</Sec>
  </div>;
}

export function AddSkill({ ctx, close }: { ctx: ToolsCtx; close: () => void }) {
  const [library, setLibrary] = useState(false);
  if (library) return <SkillSearch ctx={ctx} back={() => setLibrary(false)} close={close} />;
  return <Dialog wide title="Add a skill" onClose={close} footer={<button type="button" className="btn ghost" onClick={close}>Cancel</button>}>
    <div className="cz-provs">
      <button type="button" className="cz-prov" onClick={() => setLibrary(true)}><b>From the skill library</b><small>Search skills others have shared and install one.</small></button>
      <div className="cz-prov" title={shownWhy("Needs the engine's skill upload from this window.")}><b>From a file</b><small>A SKILL.md or a folder.</small><Grey reason="Needs the engine's skill upload from this window.">Choose a file</Grey></div>
      <div className="cz-prov"><b>From GitHub</b><small>A repository with a SKILL.md.</small><Grey reason="Needs the engine's install from a GitHub address.">Add from GitHub</Grey></div>
      <div className="cz-prov"><b>Write one with Branch</b><small>Say what it should know how to do.</small><Grey reason="Needs the engine's skill drafting method.">Draft it</Grey></div>
    </div>
  </Dialog>;
}

function SkillSearch({ ctx, back, close }: { ctx: ToolsCtx; back: () => void; close: () => void }) {
  const [query, setQuery] = useState("");
  const results = useResource<unknown>(ctx.engine, "skills.search", { ...(query.trim() ? { query: query.trim() } : {}), limit: 30 });
  const op = useOperation(ctx.engine);
  const [added, setAdded] = useState<string[]>([]);
  const rows = list(rec(results.data).results);
  return <Dialog wide title="The skill library" onClose={close} footer={<button type="button" className="btn ghost" onClick={back}>Back</button>}>
    <label className="cz-search"><Icon name="search" small /><input type="search" aria-label="Search skills" placeholder="Search skills" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <Status {...results} />{op.error && <p role="alert" className="cz-error">{op.error}</p>}
    {results.data != null && !rows.length && <EmptyLine icon={<Icon name="search" />}>No skills found.</EmptyLine>}
    <div className="cz-provs">{rows.map(r => { const slug = str(r.installRef) || str(r.slug); return <div key={slug} className="cz-prov">
      <b>{str(r.displayName) || slug}</b><small>{str(r.summary)}</small>
      {added.includes(slug) ? <span className="cz-state">Added</span> : <button type="button" className="btn sm" disabled={op.busy} onClick={() => void op.run("skills.install", { ...scopeOf(ctx), source: "clawhub", slug }, () => { setAdded(a => [...a, slug]); ctx.skills.reload(); })}>Install</button>}
    </div>; })}</div>
  </Dialog>;
}
