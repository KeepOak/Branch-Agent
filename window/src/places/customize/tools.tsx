// Customize › kinds (R1 and Classic). R1 draws the preview's frame: the "For:" faces row above, the kind nav with counts,
// the kind's list with its head and "Get more … in Community", and the detail on the right. Classic keeps its Whose tools
// chips and its own dialogs, so its screen does not change.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { trunkName, useResource, type Trunk } from "../library/data";
import { TrunkDefaults } from "../trunk/TrunkDefaults";
import { useConfig, type Config } from "./common";
import { Connectors, AddConnector, connectorCount } from "./connectors";
import { Skills, AddSkill, skillCount } from "./skills";
import { Plugins, AddPlugin, pluginCount } from "./plugins";
import { GetCapabilitiesDialog } from "./get-capabilities";
import { Clis, AddTool, cliCount, Agents, AddAgent, agentCount, Toolsets, toolsetCount } from "./tool-kinds";
import { Prompts, promptCount } from "./prompts";
import { FacesRow, KIND_LIST, type CommunityKind, type Kind } from "./kind-chrome";
import type { PromptHandoff } from "./r1-request";

export { KIND_LIST, type CommunityKind, type Kind } from "./kind-chrome";

/** What every kind's panes read: the engine, the Trunks, whose tools are shown, and the shared reads. */
export type ToolsCtx = {
  engine: WindowEngine;
  level: Level;
  trunks: Trunk[];
  /** null: Every Trunk; otherwise one Trunk's id. */
  whose: string | null;
  config: Config;
  skills: Res<unknown>;
  plugins: Res<unknown>;
  agents: Res<unknown>;
  catalog: Res<unknown>;
  /** Saved prompts (skills.library.list), read by the Prompts kind. */
  prompts: Res<unknown>;
  /** The search box's words: rows whose name or line does not contain them are hidden (R1). */
  query: string;
  openConversation: (key: string) => void;
  /** Drops text into a conversation's composer (R1); absent where the place cannot reach one. */
  usePrompt?: PromptHandoff;
  /** R1: opens Community, filtered to a kind (or its first page for Prompts). Absent in Classic, which keeps its dialogs. */
  toCommunity?: (kind?: CommunityKind) => void;
  /** Opens a kind's own "Add" dialog (Classic, and the Agents kind). */
  openAdd: (kind: Kind) => void;
};

export type Res<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void };
export type ToolsVariant = "classic" | "r1";

/** Settings › Customize draws this hub too, with the approved preview's kinds order, names and "For:" (czP17).
 *  `summary` is that card: the For chips and the kinds, without the place's add buttons and filter panes. */
type HubWords = { kinds?: Kind[]; names?: Partial<Record<Kind, string>>; whoseLabel?: string; everyLabel?: string; summary?: boolean };

/** The settings hub's right pane: which kind is open, and whose tools, with no extra buttons. */
function HubSummary({ kind, whose, trunks, everyLabel, names }: { kind: Kind; whose: string | null; trunks: Trunk[]; everyLabel: string; names?: Partial<Record<Kind, string>> }) {
  const spec = KIND_LIST.find((k) => k.id === kind);
  const title = names?.[kind] ?? spec?.label ?? kind;
  const who = whose ? trunkName(trunks.find((t) => t.id === whose) ?? { id: whose }) : everyLabel;
  return (
    <div className="t9-list" data-testid="hub-summary">
      <p className="cz-hint"><b>{title}</b> · {who}. {spec?.line}</p>
    </div>
  );
}

export function ToolsTab({ engine, level, trunks, kind, setKind, getting, setGetting, openConversation, variant = "classic", usePrompt, query = "", toCommunity, kinds, names, whoseLabel = "Whose tools", everyLabel = "Every Trunk", summary = false }: {
  engine: WindowEngine; level: Level; trunks: Trunk[]; kind: Kind; setKind: (k: Kind) => void; getting: boolean; setGetting: (getting: boolean) => void;
  openConversation: (key: string) => void; variant?: ToolsVariant; usePrompt?: PromptHandoff; query?: string; toCommunity?: (kind?: CommunityKind) => void;
} & HubWords) {
  const [whose, setWhose] = useState<string | null>(null);
  const [adding, setAdding] = useState<Kind | null>(null);
  const scope = whose ? { agentId: whose } : {};
  const ctx: ToolsCtx = {
    engine, level, trunks, whose, query, openConversation, usePrompt, toCommunity, openAdd: setAdding,
    config: useConfig(engine),
    skills: useResource<unknown>(engine, "skills.status", scope),
    plugins: useResource<unknown>(engine, "plugins.list"),
    agents: useResource<unknown>(engine, "acpx.agents.list"),
    catalog: useResource<unknown>(engine, "tools.catalog", scope),
    prompts: useResource<unknown>(engine, "skills.library.list", {}),
  };
  const counts: Record<Kind, number | null> = {
    Connectors: connectorCount(ctx), Skills: skillCount(ctx), Plugins: pluginCount(ctx),
    "Command-line tools": cliCount(ctx), Agents: agentCount(ctx), Toolsets: toolsetCount(ctx), Prompts: promptCount(ctx),
  };
  const close = () => setAdding(null);
  const body = summary ? <HubSummary kind={kind} whose={whose} trunks={trunks} everyLabel={everyLabel} names={names} />
    : kind === "Connectors" ? <Connectors ctx={ctx} /> : kind === "Skills" ? <Skills ctx={ctx} /> : kind === "Plugins" ? <Plugins ctx={ctx} />
    : kind === "Command-line tools" ? <Clis ctx={ctx} /> : kind === "Agents" ? <Agents ctx={ctx} /> : kind === "Prompts" ? <Prompts ctx={ctx} /> : <Toolsets ctx={ctx} />;
  const r1 = variant === "r1";
  return <div className="cz-tools" data-testid="tools-root">
    {r1 ? <FacesRow trunks={trunks} whose={whose} change={setWhose} /> : <ClassicWhose trunks={trunks} whose={whose} change={setWhose} label={whoseLabel} every={everyLabel} />}
    <div className="t9" data-testid="tools">
      <nav className="t9-nav" aria-label="Kinds of tools">
        {(kinds ? kinds.flatMap(id => KIND_LIST.filter(k => k.id === id)) : KIND_LIST).map(k => <button key={k.id} type="button" className="t9-kind" data-kind={k.id} aria-current={k.id === kind} aria-pressed={k.id === kind} onClick={() => setKind(k.id)}>
          <span>{summary ? <b>{names?.[k.id] ?? k.label}</b> : names?.[k.id] ?? k.label}</span>{counts[k.id] !== null && <em>{counts[k.id]}</em>}
        </button>)}
        {!r1 && !summary && <button type="button" className="btn ghost t9-addbtn" onClick={() => setGetting(true)}>Get capabilities</button>}
      </nav>
      {body}
    </div>
    {r1 && !summary && level === "technical" && <div className="cz-defaults"><TrunkDefaults engine={engine} /></div>}
    {!summary && adding === "Connectors" && <AddConnector ctx={ctx} close={close} />}
    {!summary && adding === "Skills" && <AddSkill ctx={ctx} close={close} />}
    {!summary && adding === "Plugins" && <AddPlugin ctx={ctx} close={close} />}
    {!summary && adding === "Command-line tools" && <AddTool ctx={ctx} close={close} />}
    {!summary && adding === "Agents" && <AddAgent ctx={ctx} close={close} />}
    {!r1 && !summary && getting && <GetCapabilitiesDialog engine={engine} scope={scope} close={() => setGetting(false)} done={() => { ctx.plugins.reload(); ctx.skills.reload(); }} />}
  </div>;
}

/** Classic's Whose tools chips, and Settings › Customize's "For:" chips (R1's place draws the faces row instead).
 *  One named choice group, so the chosen chip reads as already selected. */
function ClassicWhose({ trunks, whose, change, label, every }: { trunks: Trunk[]; whose: string | null; change: (id: string | null) => void; label: string; every: string }) {
  return <div className="cz-whose"><span className="cz-lh">{label}</span>
    <div className="cz-chips" role="group" aria-label={label}>{[{ id: null, name: every }, ...trunks.map(t => ({ id: t.id as string | null, name: trunkName(t) }))].map(o =>
      <button key={o.id ?? "*"} type="button" className="cz-chip" aria-pressed={whose === o.id} onClick={() => change(o.id)}>{o.name}</button>)}</div>
  </div>;
}
