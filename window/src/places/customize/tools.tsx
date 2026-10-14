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

export function ToolsTab({ engine, level, trunks, kind, setKind, getting, setGetting, openConversation, variant = "classic", usePrompt, query = "", toCommunity }: {
  engine: WindowEngine; level: Level; trunks: Trunk[]; kind: Kind; setKind: (k: Kind) => void; getting: boolean; setGetting: (getting: boolean) => void;
  openConversation: (key: string) => void; variant?: ToolsVariant; usePrompt?: PromptHandoff; query?: string; toCommunity?: (kind?: CommunityKind) => void;
}) {
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
  const body = kind === "Connectors" ? <Connectors ctx={ctx} /> : kind === "Skills" ? <Skills ctx={ctx} /> : kind === "Plugins" ? <Plugins ctx={ctx} />
    : kind === "Command-line tools" ? <Clis ctx={ctx} /> : kind === "Agents" ? <Agents ctx={ctx} /> : kind === "Prompts" ? <Prompts ctx={ctx} /> : <Toolsets ctx={ctx} />;
  const r1 = variant === "r1";
  return <div className="cz-tools" data-testid="tools-root">
    {r1 ? <FacesRow trunks={trunks} whose={whose} change={setWhose} /> : <ClassicWhose trunks={trunks} whose={whose} change={setWhose} />}
    <div className="t9" data-testid="tools">
      <nav className="t9-nav" aria-label="Kinds of tools">
        {KIND_LIST.map(k => <button key={k.id} type="button" className="t9-kind" data-kind={k.id} aria-current={k.id === kind} onClick={() => setKind(k.id)}>
          <span>{k.label}</span>{counts[k.id] !== null && <em>{counts[k.id]}</em>}
        </button>)}
        {!r1 && <button type="button" className="btn ghost t9-addbtn" onClick={() => setGetting(true)}>Get capabilities</button>}
      </nav>
      {body}
    </div>
    {r1 && level === "technical" && <div className="cz-defaults"><TrunkDefaults engine={engine} /></div>}
    {adding === "Connectors" && <AddConnector ctx={ctx} close={close} />}
    {adding === "Skills" && <AddSkill ctx={ctx} close={close} />}
    {adding === "Plugins" && <AddPlugin ctx={ctx} close={close} />}
    {adding === "Command-line tools" && <AddTool ctx={ctx} close={close} />}
    {adding === "Agents" && <AddAgent ctx={ctx} close={close} />}
    {!r1 && getting && <GetCapabilitiesDialog engine={engine} scope={scope} close={() => setGetting(false)} done={() => { ctx.plugins.reload(); ctx.skills.reload(); }} />}
  </div>;
}

/** Classic's Whose tools chips (R1 draws the faces row instead). */
function ClassicWhose({ trunks, whose, change }: { trunks: Trunk[]; whose: string | null; change: (id: string | null) => void }) {
  return <div className="cz-whose"><span className="cz-lh">Whose tools</span>
    <div className="cz-chips">{[{ id: null, name: "Every Trunk" }, ...trunks.map(t => ({ id: t.id as string | null, name: trunkName(t) }))].map(o =>
      <button key={o.id ?? "*"} type="button" className="cz-chip" aria-pressed={whose === o.id} onClick={() => change(o.id)}>{o.name}</button>)}</div>
  </div>;
}
