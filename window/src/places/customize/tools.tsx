// Customize › Tools: the preview's three panes (40-places.js t9, 42-placesbp.js, 93-g3p.js): Whose tools and the
// kinds on the left, the kind's items in the middle, the chosen item's detail on the right.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { Icon } from "../../shell/icons";
import { trunkName, useResource, type Trunk } from "../library/data";
import { useConfig, type Config } from "./common";
import { Glyph, type GlyphName } from "./glyphs";
import { Connectors, AddConnector, connectorCount } from "./connectors";
import { Skills, AddSkill, skillCount } from "./skills";
import { Plugins, AddPlugin, pluginCount } from "./plugins";
import { GetCapabilitiesDialog } from "./get-capabilities";
import { Clis, AddTool, cliCount, Agents, AddAgent, agentCount, Toolsets, toolsetCount } from "./tool-kinds";

export type Kind = "Connectors" | "Skills" | "Plugins" | "Command-line tools" | "Agents" | "Toolsets";
export const KIND_LIST: { id: Kind; glyph: GlyphName; line: string; add?: string }[] = [
  { id: "Connectors", glyph: "plug", line: "MCP servers: apps and data a Trunk can reach", add: "Add a server" },
  { id: "Skills", glyph: "bolt", line: "Step-by-step know-how, as SKILL.md", add: "Add a skill" },
  { id: "Plugins", glyph: "puzzle", line: "Packs of skills, servers and tools", add: "Add a plugin" },
  { id: "Command-line tools", glyph: "terminal", line: "Programs on this computer it may run", add: "Add a tool" },
  { id: "Agents", glyph: "people", line: "Other assistants over A2A, and Trunks on other computers", add: "Connect an agent" },
  { id: "Toolsets", glyph: "grid", line: "Groups of tools a Trunk gets together" },
];

export type Res<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void };
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
  openConversation: (key: string) => void;
};

export function ToolsTab({ engine, level, trunks, kind, setKind, openConversation }: { engine: WindowEngine; level: Level; trunks: Trunk[]; kind: Kind; setKind: (k: Kind) => void; openConversation: (key: string) => void }) {
  const [whose, setWhose] = useState<string | null>(null);
  const [adding, setAdding] = useState<Kind | null>(null);
  const [getting, setGetting] = useState(false);
  const scope = whose ? { agentId: whose } : {};
  const ctx: ToolsCtx = {
    engine, level, trunks, whose, openConversation,
    config: useConfig(engine),
    skills: useResource<unknown>(engine, "skills.status", scope),
    plugins: useResource<unknown>(engine, "plugins.list"),
    agents: useResource<unknown>(engine, "acpx.agents.list"),
    catalog: useResource<unknown>(engine, "tools.catalog", scope),
  };
  const counts: Record<Kind, number | null> = {
    Connectors: connectorCount(ctx), Skills: skillCount(ctx), Plugins: pluginCount(ctx),
    "Command-line tools": cliCount(ctx), Agents: agentCount(ctx), Toolsets: toolsetCount(ctx),
  };
  const current = KIND_LIST.find(k => k.id === kind)!;
  const close = () => setAdding(null);
  return <div className="t9" data-testid="tools">
    <nav className="t9-nav" aria-label="Kinds of tools">
      <div className="cz-whose"><span className="cz-lh">Whose tools</span>
        <div className="cz-chips">{[{ id: null, name: "Every Trunk" }, ...trunks.map(t => ({ id: t.id as string | null, name: trunkName(t) }))].map(o =>
          <button key={o.id ?? "*"} type="button" className="cz-chip" aria-pressed={whose === o.id} onClick={() => setWhose(o.id)}>{o.name}</button>)}</div>
      </div>
      {KIND_LIST.map(k => <button key={k.id} type="button" className="t9-kind" data-kind={k.id} aria-current={k.id === kind} onClick={() => setKind(k.id)}>
        <Glyph name={k.glyph} size={16} /><span><b>{k.id}</b><small>{k.line}</small></span>{counts[k.id] !== null && <em>{counts[k.id]}</em>}
      </button>)}
      {current.add && <button type="button" className="btn pri t9-addbtn" onClick={() => setAdding(kind)}><Icon name="plus" small />{current.add}</button>}
      <button type="button" className="btn ghost t9-addbtn" onClick={() => setGetting(true)}>Get capabilities</button>
    </nav>
    {kind === "Connectors" ? <Connectors ctx={ctx} /> : kind === "Skills" ? <Skills ctx={ctx} /> : kind === "Plugins" ? <Plugins ctx={ctx} />
      : kind === "Command-line tools" ? <Clis ctx={ctx} /> : kind === "Agents" ? <Agents ctx={ctx} /> : <Toolsets ctx={ctx} />}
    {adding === "Connectors" && <AddConnector ctx={ctx} close={close} />}
    {adding === "Skills" && <AddSkill ctx={ctx} close={close} />}
    {adding === "Plugins" && <AddPlugin ctx={ctx} close={close} />}
    {adding === "Command-line tools" && <AddTool ctx={ctx} close={close} />}
    {adding === "Agents" && <AddAgent ctx={ctx} close={close} />}
    {getting && <GetCapabilitiesDialog engine={engine} scope={scope} close={() => setGetting(false)} done={() => { ctx.plugins.reload(); ctx.skills.reload(); }} />}
  </div>;
}
