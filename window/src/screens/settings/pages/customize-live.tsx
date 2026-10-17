// Settings › Customize: what the R1 page draws itself (slots.ts cards and controls). The kinds hub is the R1 Customize
// place's own Tools hub (places/customize/tools.tsx) with the approved preview's kinds order and words (preview.html czP17);
// Saved prompts is the engine's skill library (Classic instructions-more.tsx); the connected-agents cards reuse Classic
// Connected agents' logic on the same calls (places/settings/set2/agents.tsx: contacts.outside.list / .set, each Trunk's
// agentToAgent deny list, the connect lines and the pairing dialog). The other controls are the rows of Classic
// Advanced that save more than one key (advanced*.tsx). Every control names the engine call it makes.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Coming } from "../../../glass/coming";
import { useResource as usePlaceResource, type Trunks } from "../../../places/library/data";
import { ToolsTab, type Kind } from "../../../places/customize/tools";
import { configStore, pathKeys, type ConfigPath } from "../../../places/settings/config-store";
import { list, record, text, visible, type RecordValue } from "../../../places/settings/adapter";
import { useResource } from "../../../places/settings/hooks";
import { KitProvider } from "../../../places/settings/kit";
import { SectionDialog, WebSearchDialog } from "../../../places/settings/set2/advanced-tech";
import type { Ctx } from "../../../places/settings/set2/advanced-more";
import { agentTitle, CONNECT_LINES, nextDeny, legacyOutsideId, readAgents, type OutsideAgentRow } from "../../../places/settings/set2/agents";
import { BranchLinkDialog } from "../../../shell/BranchLinkDialog";
import type { Level } from "../nav";
import type { Row } from "../rows";
import { Toggle } from "../RowView";
import { useLevel } from "../SettingsFrame";
import type { PageSlot, SlotControlProps, SlotPageProps } from "../slots";
import { Failed, Needs, useFailure } from "./appearance-live";
import { copyAndSay } from "../../../shell/clipboard";
import "../../../places/library/places.css";
import "../../../places/customize/customize.css";

const LEVEL_WORD = ["regular", "advanced", "technical"] as const;
/** Classic's windows report their saves through the kit; these report on their own lines. */
const QUIET = { saving: () => undefined, saved: () => undefined, failed: () => undefined };

/** The window's config (config.get), saved with config.patch, shared with every Settings row. */
function useConfigSnap(engine: WindowEngine) {
  const store = configStore(engine);
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
  const snap = useSyncExternalStore(subscribe, () => store.snap, () => store.snap);
  useEffect(() => { if (!store.snap) void store.load(); }, [store]);
  const get = (path: ConfigPath): unknown => pathKeys(path).reduce<unknown>((v, k) => record(v)[k], record(snap?.config));
  return { store, snap, get };
}

/* ---------- the kinds hub ---------- */

/** The preview's kinds, in its order and words (czP17: Toolsets, Connectors, Skills, Plugins, Command-line tools,
 *  Agents & specialists). Prompts, the preview's seventh kind, is the Saved prompts card below at Advanced. */
export const HUB_KINDS: Kind[] = ["Toolsets", "Connectors", "Skills", "Plugins", "Command-line tools", "Agents"];
export const HUB_NAMES: Partial<Record<Kind, string>> = { Agents: "Agents & specialists" };

/** "4 agents connected · 3 online": the line over the hub when agents are connected (contacts.outside.list). */
function AgentsLine({ engine }: { engine: WindowEngine }) {
  const live = useResource<unknown>(engine, "contacts.outside.list", {});
  const { agents } = readAgents(live.data);
  const shown = agents.filter((a) => !a.revoked && a.kind !== "trunk");
  if (!shown.length) return null;
  const online = shown.filter((a) => a.online).length;
  return (
    <div className="r1s-item r1s-lead" data-need="contacts.outside.list">
      <span className="r1s-dot" data-on={online ? "" : undefined} aria-hidden="true" />
      <span className="r1s-item-t g-label" data-lines>
        <b>{shown.length === 1 ? "1 agent connected" : `${shown.length} agents connected`} · {online} online</b>
        <small>They talk to your Trunks. You can revoke any of them here at any time.</small>
      </span>
    </div>
  );
}

/** The kinds hub: whose tools, each kind with its count, and the chosen kind's list, as the Customize place draws it. */
export function CustomizeHub({ engine }: SlotPageProps) {
  const [level] = useLevel(engine);
  const trunks = usePlaceResource<Trunks>(engine, "agents.list");
  const [kind, setKind] = useState<Kind>("Skills");
  const [getting, setGetting] = useState(false);
  return (
    <div className="r1s-hub" data-testid="customize-hub">
      <AgentsLine engine={engine} />
      <div className="cz">
        {/* The hub's panes never open a conversation (ToolsTab only passes it along). */}
        <ToolsTab engine={engine} level={LEVEL_WORD[level]} trunks={trunks.data?.agents ?? []} kind={kind} setKind={setKind} getting={getting} setGetting={setGetting}
          openConversation={() => undefined} kinds={HUB_KINDS} names={HUB_NAMES} whoseLabel="For:" everyLabel="All" summary />
      </div>
    </div>
  );
}

/* ---------- Saved prompts ---------- */

/** Saved prompts: the skills in the engine's library by their slash name, each with Try it (sent to the default Trunk). */
export function SavedPrompts({ engine, onAsk }: SlotPageProps) {
  const lib = useResource<RecordValue>(engine, "skills.library.list", {});
  const entries = list(lib.data?.entries).filter((e) => e.removed !== true);
  return (
    <div className="r1s-items" data-need="skills.library.list">
      {lib.loading ? <small className="r1s-msg g-label">Reading your saved prompts…</small> : null}
      {lib.error ? <small className="r1s-msg r1s-bad g-label" role="status">{visible(lib.error)}</small> : null}
      {!lib.loading && !lib.error && !entries.length ? <small className="r1s-msg g-label">No saved prompts yet.</small> : null}
      {entries.map((e) => {
        const slug = text(e.slug);
        const off = e.enabled === false ? "Turned off in the library." : onAsk ? undefined : "Needs a model set up first.";
        return (
          <div key={text(e.skillId) || slug} className="r1s-row" data-row={`customize.prompts.${slug}`}>
            <b className="g-label">/{visible(slug)}</b>
            {e.description ? <small className="g-label" data-lines>{visible(e.description)}</small> : null}
            <div className="r1s-ctl">
              <Coming engine={engine} need="chat.send" unwired={Boolean(off)} reason={off}>
                <button type="button" className="r1s-btn" onClick={() => onAsk?.(`/${slug}`)}>Try it</button>
              </Coming>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- connected agents ---------- */

type Trunk = { id: string; name: string };
function trunksOf(result: unknown): Trunk[] {
  return list(record(result).agents).filter((a) => text(a.id) && a.kind !== "system")
    .map((a) => ({ id: text(a.id), name: text(record(a.identity).name) || text(a.name) || text(a.id) }));
}

/** Let agents connect: the engine's switch for every connected agent (contacts.outside.set { enabled }). */
export function AgentsOn({ engine, row }: SlotControlProps) {
  const live = useResource<unknown>(engine, "contacts.outside.list", {});
  const [failed, run] = useFailure();
  const { enabled } = readAgents(live.data);
  const label = row.label ?? "Let agents connect";
  return <>
    <span className="r1s-own-ctl">
      <Coming engine={engine} need={["contacts.outside.list", "contacts.outside.set"]} reason={`${label} comes in a later update.`} where={label}>
        <Toggle label={label} on={enabled} disabled={live.loading || Boolean(live.error)} onChange={(on) => void run(async () => { await engine.request("contacts.outside.set", { enabled: on }); await live.reload(); })} />
      </Coming>
    </span>
    <Failed text={failed || (live.error ? visible(live.error) : "")} />
  </>;
}

/** One connected agent: who it is and when it was last seen, then what it may do: message each Trunk, use this window,
 *  and disconnect (or let it back). */
function AgentCard({ engine, agent, trunks, sessions, nested, reload }: { engine: WindowEngine; agent: OutsideAgentRow; trunks: Trunk[]; sessions: string[]; nested: OutsideAgentRow[]; reload: () => void }) {
  const { store, snap, get } = useConfigSnap(engine);
  const [failed, run] = useFailure();
  const [rights, setRights] = useState(false);
  const isBranch = agent.kind === "branch";
  const denyPath = (trunk: string) => ["agents", "entries", trunk, "agentToAgent", "deny"];
  const legacy = legacyOutsideId(agent.id);
  const denied = (trunk: string) => { const d = get(denyPath(trunk)); return Array.isArray(d) && (d.includes(`a2a:${agent.id}`) || (!!legacy && d.includes(`a2a:${legacy}`))); };
  const allow = (trunk: string, on: boolean) => {
    const d = get(denyPath(trunk));
    const current = Array.isArray(d) ? d.filter((v): v is string => typeof v === "string") : [];
    void run(() => store.set(denyPath(trunk), nextDeny(current, agent.id, on, sessions)));
  };
  const set = (change: RecordValue) => void run(async () => { await engine.request("contacts.outside.set", { id: agent.id, ...change }); reload(); });
  const seen = agent.revoked ? "Disconnected" : agent.online ? "Online now" : agent.lastSeenAt ? `Last seen ${new Date(agent.lastSeenAt).toLocaleString()}` : "Not seen yet";
  const mayTalk = trunks.filter((t) => !denied(t.id)).map((t) => t.name);
  return (
    <div className="r1s-agent" data-testid="connected-agent" data-agent={agent.id} data-kind={agent.kind}>
      <div className="r1s-item">
        <span className="r1s-av g-frost" aria-hidden="true">{agent.name.slice(0, 2).toUpperCase()}</span>
        <span className="r1s-item-t g-label" data-lines>
          <b>{agentTitle(agent)}{isBranch ? " · Branch" : ""}</b>
          <small>{[seen, agent.where, agent.activity, agent.version ? `version ${agent.version}` : ""].filter(Boolean).join(" · ")}</small>
          <small>{mayTalk.length ? `May talk to ${mayTalk.join(", ")}` : "May talk to no Trunk"}{agent.mayDriveWindow ? " · may use this window" : ""}</small>
        </span>
      </div>
      {nested.length ? <ul className="r1s-agent-trunks" aria-label={`${agent.name}'s Trunks`}>{nested.map((t) => <li key={t.id} data-agent={t.id}>{t.name} · {t.online && !agent.revoked ? "Online now" : "Not online"}</li>)}</ul> : null}
      <div className="r1s-acts">
        {/* The preview's seed and sharing buttons wait for the engine to describe a connected agent as a seed. */}
        {["Copy seed", "Download", "Share"].map((b) => (
          <Coming key={b} engine={engine} need="engine: a connected agent as a seed" unwired reason="Sharing a connected agent comes in a later update.">
            <button type="button" className="r1s-btn">{b}</button>
          </Coming>
        ))}
        <button type="button" className="r1s-btn" data-local="" aria-expanded={rights} onClick={() => setRights((v) => !v)}>Permissions</button>
        {isBranch && agent.revoked ? null : (
          <Needs engine={engine} need={["contacts.outside.set"]} where={`Disconnect ${agent.name}`}>
            <button type="button" className="r1s-btn" onClick={() => set({ revoked: isBranch ? true : !agent.revoked })}>{agent.revoked ? "Reconnect" : "Revoke"}</button>
          </Needs>
        )}
      </div>
      {rights ? <div className="r1s-agent-rights" role="group" aria-label={`What ${agent.name} may do`}>
      {trunks.map((t) => (
        <div key={t.id} className="r1s-row" data-row={`customize.agents.${agent.id}.${t.id}`}>
          <b className="g-label">May message {t.name}</b>
          <div className="r1s-ctl"><Needs engine={engine} need={["config.patch"]} where={`${agent.name} may message ${t.name}`}>
            <span className="r1s-own-ctl"><Toggle label={`${agent.name} may message ${t.name}`} on={!denied(t.id)} disabled={!snap} onChange={(on) => allow(t.id, on)} /></span>
          </Needs></div>
        </div>
      ))}
      <div className="r1s-row" data-row={`customize.agents.${agent.id}.window`}>
        <b className="g-label">May use your Branch window</b>
        <small className="g-label" data-lines>Also needs Let agents use this window, above.</small>
        <div className="r1s-ctl"><Needs engine={engine} need={["contacts.outside.set"]} where={`${agent.name} may use your Branch window`}>
          <span className="r1s-own-ctl"><Toggle label={`${agent.name} may use your Branch window`} on={agent.mayDriveWindow} onChange={(on) => set({ mayDriveWindow: on })} /></span>
        </Needs></div>
      </div>
      </div> : null}
      <Failed text={failed} />
    </div>
  );
}

/** Connected agents: every agent the engine knows (grafted Branches with their Trunks under them), or how to connect one. */
export function ConnectedAgents({ engine }: SlotPageProps) {
  const live = useResource<unknown>(engine, "contacts.outside.list", {});
  const roster = useResource<unknown>(engine, "agents.list", {});
  const { agents } = readAgents(live.data);
  const trunks = trunksOf(roster.data);
  const branches = new Set(agents.filter((a) => a.kind === "branch").map((a) => a.id));
  const isNested = (a: OutsideAgentRow) => a.kind === "trunk" && !!a.via && branches.has(a.via);
  const reload = () => void live.reload();
  if (live.loading) return <small className="r1s-msg g-label">Reading connected agents…</small>;
  if (live.error) return <small className="r1s-msg r1s-bad g-label" role="status">{visible(live.error)}</small>;
  if (!agents.length) return <small className="r1s-msg g-label" data-lines>No agent is connected yet. Paste one of the lines below into it.</small>;
  return (
    <div className="r1s-items" data-need="contacts.outside.list">
      {agents.filter((a) => !isNested(a)).map((a) => (
        <AgentCard key={a.id} engine={engine} agent={a} trunks={trunks} sessions={agents.map((x) => x.id)} reload={reload}
          nested={a.kind === "branch" ? agents.filter((t) => isNested(t) && t.via === a.id) : []} />
      ))}
    </div>
  );
}

/** Connect an agent: one row per line an agent's owner pastes once (Classic CONNECT_LINES), each with Copy. */
export const CONNECT_ROWS: Row[] = CONNECT_LINES.map(([title], i) => ({
  id: `customize.connect.line-${i + 1}`, page: "customize", card: "Connect an agent", label: title, level: 0, control: "custom",
  source: { kind: "slot", calls: [], reason: "Copying a connect line comes in a later update." },
}));
function ConnectLine({ row }: SlotControlProps) {
  const line = CONNECT_LINES.find(([title]) => title === row.label)?.[1] ?? "";
  const [copied, setCopied] = useState(false);
  const copy = () => void copyAndSay(line).then(setCopied);
  return (
    <span className="r1s-own-ctl r1s-codeline" data-local="">
      <code className="r1s-code">{line}</code>
      <button type="button" className="r1s-btn" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
    </span>
  );
}

/** Pair with Branch on another computer: Classic's pairing dialog (a one-time code or QR, or a code from the other one). */
export function PairBranch({ engine }: SlotControlProps) {
  const [open, setOpen] = useState(false);
  return <>
    <Needs engine={engine} need={["device.pair.setupCode", "graft.join"]} where="Show a pairing code">
      <button type="button" className="r1s-btn" onClick={() => setOpen(true)}>Show a pairing code</button>
    </Needs>
    {open ? <BranchLinkDialog engine={engine} onClose={() => setOpen(false)} /> : null}
  </>;
}

/* ---------- Classic Advanced rows that save more than one key ---------- */

/** Classic's windows want Classic's page context: this engine's config at Technical, for every Trunk. */
function useClassicCtx(engine: WindowEngine): Ctx {
  const { store, get } = useConfigSnap(engine);
  const config = { get, set: (path: ConfigPath, value: unknown) => store.set(path, value), loading: !store.snap } as unknown as Ctx["config"];
  return { engine, config, lv: 2, agent: "", plugins: [] } as unknown as Ctx;
}

/** Web search: the service it uses (webSearch.status lists them), Automatic when none is chosen. */
export function WebSearchPick({ engine, row }: SlotControlProps) {
  const { store, snap, get } = useConfigSnap(engine);
  const st = useResource<RecordValue>(engine, "webSearch.status", {});
  const [failed, run] = useFailure();
  const on = get("tools.web.search.enabled") !== false;
  const value = text(get("tools.web.search.provider"));
  const options = [{ v: "", label: "Automatic" }, ...list(st.data?.providers).map((p) => ({ v: text(p.id), label: text(p.label) || text(p.id) }))];
  const label = row.label ?? "Web search";
  return <>
    <Needs engine={engine} need={["webSearch.status", "config.patch"]} where={label}>
      <select className="r1s-inp" aria-label={label} value={value} disabled={!on || !snap} onChange={(e) => void run(() => store.set("tools.web.search.provider", e.target.value || null))}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </Needs>
    <Failed text={failed || (on ? "" : "Search is off.")} />
  </>;
}

/** Web search details: Classic's window (which search each model uses, setting one up, checking it). */
export function WebSearchDetails({ engine }: SlotControlProps) {
  const [open, setOpen] = useState(false);
  return <>
    <Needs engine={engine} need={["webSearch.status", "webSearch.test"]} where="Web search details">
      <button type="button" className="r1s-btn" onClick={() => setOpen(true)}>Open</button>
    </Needs>
    {open ? <KitProvider level={2} report={QUIET} scope={null}><WebSearchDialog engine={engine} agent="" onClose={() => setOpen(false)} /></KitProvider> : null}
  </>;
}

/** Helpers' model: the model a Trunk's helpers use (agents.defaults.subagents.model), or the Trunk's own. */
export function HelpersModel({ engine, row }: SlotControlProps) {
  const { store, snap, get } = useConfigSnap(engine);
  const models = useResource<RecordValue>(engine, "models.list", {});
  const [failed, run] = useFailure();
  const raw = get("agents.defaults.subagents.model");
  const value = typeof raw === "string" ? raw : text(record(raw).primary);
  const options = [{ v: "", label: "Same as the Trunk" }, ...list(models.data?.models).filter((m) => m.available !== false).map((m) => ({ v: `${text(m.provider)}/${text(m.id)}`, label: text(m.name) || text(m.id) }))];
  const label = row.label ?? "Helpers’ model";
  return <>
    <Needs engine={engine} need={["models.list", "config.patch"]} where={label}>
      <select className="r1s-inp" aria-label={label} value={value} disabled={!snap} onChange={(e) => void run(() => store.set("agents.defaults.subagents.model", e.target.value || null))}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** A plugin slot (memory or context engine): Branch's own, or a plugin of that kind (plugins.list). */
function slotPick(path: string, kind: string, base: { v: string; label: string }[], fallback: string) {
  return function SlotPick({ engine, row }: SlotControlProps) {
    const { store, snap, get } = useConfigSnap(engine);
    const plugins = useResource<RecordValue>(engine, "plugins.list", {});
    const [failed, run] = useFailure();
    const found = list(plugins.data?.plugins).filter((p) => Array.isArray(p.kind) && p.kind.map(String).includes(kind) && !base.some((b) => b.v === p.id));
    const options = [...base, ...found.map((p) => ({ v: text(p.id), label: text(p.name) || text(p.id) }))];
    const value = text(get(path)) || fallback;
    const label = row.label ?? path;
    return <>
      <Needs engine={engine} need={["plugins.list", "config.patch"]} where={label}>
        <select className="r1s-inp" aria-label={label} value={value} disabled={!snap} onChange={(e) => void run(() => store.set(path, e.target.value === fallback ? null : e.target.value))}>
          {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
      </Needs>
      <Failed text={failed} />
    </>;
  };
}
export const MemoryEngine = slotPick("plugins.slots.memory", "memory", [{ v: "memory-core", label: "Branch memory" }, { v: "none", label: "Off" }], "memory-core");
export const ContextEngine = slotPick("plugins.slots.contextEngine", "context-engine", [{ v: "legacy", label: "Branch’s own" }], "legacy");

/** A plugin's own switch (plugins.entries.<id>.enabled), read from plugins.list until it is saved. */
export function pluginSwitch(id: string) {
  return function PluginSwitch({ engine, row }: SlotControlProps) {
    const { store, snap, get } = useConfigSnap(engine);
    const plugins = useResource<RecordValue>(engine, "plugins.list", {});
    const [failed, run] = useFailure();
    const entry = list(plugins.data?.plugins).find((p) => p.id === id);
    const saved = get(["plugins", "entries", id, "enabled"]);
    const label = row.label ?? id;
    const missing = !plugins.loading && !entry && saved === undefined;
    return <>
      <Coming engine={engine} need={["plugins.list", "config.patch"]} unwired={missing} reason={missing ? "Its plugin isn’t installed in this engine." : undefined} where={label}>
        <span className="r1s-own-ctl"><Toggle label={label} on={typeof saved === "boolean" ? saved : entry?.enabled === true} disabled={!snap || missing} onChange={(on) => void run(() => store.set(["plugins", "entries", id, "enabled"], on))} /></span>
      </Coming>
      <Failed text={missing ? "Its plugin isn’t installed in this engine." : failed} />
    </>;
  };
}

/** A list of strings in one key (folders, plugin ids): each with ×, and an Add field. Empty saves nothing (the default). */
export function listControl(path: string, placeholder: string, addWord = "Add") {
  return function ListControl({ engine, row }: SlotControlProps) {
    const { store, snap, get } = useConfigSnap(engine);
    const [failed, run] = useFailure();
    const [draft, setDraft] = useState("");
    const raw = get(path);
    const saved: unknown[] = Array.isArray(raw) ? raw : [];
    const items = saved.map((x) => (typeof x === "string" ? x : text(record(x).path)));
    const put = (next: unknown[]) => void run(() => store.set(path, next.length ? next : null));
    const value = draft.trim();
    const ready = Boolean(snap) && value.length > 0 && !items.includes(value);
    const add = () => { if (!ready) return; put([...saved, value]); setDraft(""); };
    const label = row.label ?? path;
    const why = !snap ? undefined : !value ? "Type a name, then add it." : items.includes(value) ? "Already in the list." : undefined;
    return <>
      <Needs engine={engine} need={["config.patch"]} where={label}>
        <span className="r1s-own-ctl r1s-list">
          {items.length ? items.map((x, i) => <span key={`${x}-${i}`} className="r1s-chip g-frost">{x}<button type="button" className="r1s-link" aria-label={`Remove ${x}`} onClick={() => put(saved.filter((_, j) => j !== i))}>×</button></span>)
            : <small className="r1s-msg g-label">Nothing here yet.</small>}
          <input className="r1s-inp" aria-label={`${label}: new item`} placeholder={placeholder} value={draft} disabled={!snap} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && ready) add(); }} />
          <button type="button" className="r1s-btn" disabled={!ready} title={why} onClick={add}>{addWord}</button>
        </span>
      </Needs>
      <Failed text={failed} />
    </>;
  };
}

/** Edit: Classic's window that edits a whole settings section as JSON, with its fields' help. */
export function editSection(path: string, title: string) {
  return function EditSection({ engine }: SlotControlProps) {
    const [open, setOpen] = useState(false);
    const c = useClassicCtx(engine);
    return <>
      <Needs engine={engine} need={["config.get", "config.patch"]} where={title}>
        <button type="button" className="r1s-btn" onClick={() => setOpen(true)}>Edit</button>
      </Needs>
      {open ? <KitProvider level={2} report={QUIET} scope={null}><SectionDialog c={c} path={path} title={title} onClose={() => setOpen(false)} /></KitProvider> : null}
    </>;
  };
}

/** The Customize page's own cards and controls (plugged.ts). */
export const CUSTOMIZE_PAGE: PageSlot = {
  rows: CONNECT_ROWS,
  cards: {
    "": { component: CustomizeHub },
    "Saved prompts": { level: 1 as Level, component: SavedPrompts },
    "Connected agents": { component: ConnectedAgents },
  },
  controls: {
    "customize.tools.web-provider": WebSearchPick,
    "customize.tools.web-details": WebSearchDetails,
    "customize.skills.extra-dirs": listControl("skills.load.extraDirs", "D:\\Skills", "Add a folder"),
    "customize.skills.bundled": listControl("skills.allowBundled", "a skill name"),
    "customize.skills.every": editSection("skills", "Every skill setting"),
    "customize.plugins.allow": listControl("plugins.allow", "plugin id"),
    "customize.plugins.deny": listControl("plugins.deny", "plugin id"),
    "customize.plugins.paths": listControl("plugins.load.paths", "D:\\Plugins"),
    "customize.plugins.memory": MemoryEngine,
    "customize.plugins.context": ContextEngine,
    "customize.helpers.model": HelpersModel,
    "customize.helpers.protocol": pluginSwitch("a2a"),
    "customize.allow.connect": AgentsOn,
    "customize.another.pair": PairBranch,
    ...Object.fromEntries(CONNECT_ROWS.map((r) => [r.id, ConnectLine])),
  },
};
