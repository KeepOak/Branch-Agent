// The chrome every Customize kind shares (R1), drawn as the preview draws it (preview.html 44908-45060): the kind's
// order and names, one kind head with its count and "＋ Add", the "＋ Get more … in Community →" link under the list,
// and the "For:" faces row above the kinds.
import { useContext, type ReactNode } from "react";
import { shows } from "../../places-nav/level";
import { TrunkFace } from "../trunk/TrunkFace";
import { trunkName, type Trunk } from "../library/data";
import { CustomizeLevelContext, Grey } from "./common";
import type { ToolsCtx } from "./tools";

export type Kind = "Toolsets" | "Connectors" | "Skills" | "Plugins" | "Command-line tools" | "Agents" | "Prompts";
/** The Seedbank kind a Customize kind opens in Community (preview MK_KIND). Prompts have none and open Community's first page. */
export type CommunityKind = "toolsets" | "mcp" | "skills" | "plugins" | "clis" | "agents";

export const KIND_LIST: { id: Kind; label: string; line: string; community?: CommunityKind }[] = [
  { id: "Toolsets", label: "Toolsets", line: "Groups of tools a Trunk gets together.", community: "toolsets" },
  { id: "Connectors", label: "Connectors", line: "Apps and data a Trunk can reach.", community: "mcp" },
  { id: "Skills", label: "Skills", line: "Step-by-step know-how a Trunk can follow.", community: "skills" },
  { id: "Plugins", label: "Plugins", line: "Packs of skills, servers and tools.", community: "plugins" },
  { id: "Command-line tools", label: "Command-line tools", line: "Programs on this computer it may run.", community: "clis" },
  { id: "Agents", label: "Agents & specialists", line: "Other assistants, helpers a Trunk calls in, and how they work together.", community: "agents" },
  { id: "Prompts", label: "Prompts", line: "Saved prompts you can drop into any conversation." },
];

/** The "＋ Add" in a kind's head. R1 sends Connectors, Skills and Plugins to Community; Classic keeps its dialogs. */
export function addControl(ctx: ToolsCtx, kind: Kind): ReactNode {
  const r1 = Boolean(ctx.toCommunity);
  const community = KIND_LIST.find(k => k.id === kind)?.community;
  const add = (onClick: () => void) => <button type="button" className="btn pri sm cz-add" onClick={onClick}>＋ Add</button>;
  if (kind === "Toolsets") return <Grey className="btn pri sm" reason="Making a new toolset from here comes in a later update.">＋ Add</Grey>;
  if (kind === "Prompts") return <Grey className="btn pri sm" reason="Saving a new prompt from here comes in a later update.">＋ Add</Grey>;
  if (kind === "Command-line tools") return add(() => (r1 ? document.getElementById("cz-clis-path")?.focus() : ctx.openAdd?.(kind)));
  if (kind === "Agents") return add(() => ctx.openAdd?.(kind));
  if (r1 && community) return add(() => ctx.toCommunity?.(community));
  return add(() => ctx.openAdd?.(kind));
}

/** The kind's head (name, one line on what it is, the count, "＋ Add") and the link under its list. */
export function KindHead({ ctx, kind, count, children }: { ctx: ToolsCtx; kind: Kind; count: string; children: ReactNode }) {
  const info = KIND_LIST.find(k => k.id === kind)!;
  return <div className="t9-list" data-kind-list={kind}>
    <div className="cz-kindhead"><div><h2>{info.label}</h2><p>{info.line}</p></div><span className="cz-count">{count}</span>{addControl(ctx, kind)}</div>
    {children}
    {ctx.toCommunity && <button type="button" className="cz-get" onClick={() => ctx.toCommunity?.(info.community)}>＋ Get more {info.label.toLowerCase()} in Community →</button>}
  </div>;
}

/** Rows and sections whose only controls are Coming ("… comes in a later update."): drawn at Technical only, so Regular
 *  and Advanced show only what works. Classic has no level and draws them, as before. */
export function TechnicalOnly({ children }: { children: ReactNode }) {
  const level = useContext(CustomizeLevelContext);
  return shows(level, "technical") ? <>{children}</> : null;
}

/** "For:" and a face per Trunk, plus All: whose tools the kinds show (preview 24129, the faces row). */
export function FacesRow({ trunks, whose, change }: { trunks: Trunk[]; whose: string | null; change: (id: string | null) => void }) {
  return <div className="cz-for"><span className="cz-for-l">For:</span><div className="cz-faces" role="group" aria-label="Whose tools">
    <button type="button" className="cz-face cz-face-all" aria-pressed={whose === null} data-tip="Every Trunk" onClick={() => change(null)}><span className="cz-all">All</span></button>
    {trunks.map(t => <button key={t.id} type="button" className="cz-face" aria-pressed={whose === t.id} data-tip={`${trunkName(t)}’s tools`} onClick={() => change(t.id)}>
      <TrunkFace name={trunkName(t)} look={t.identity?.theme ?? "classic"} emoji={t.identity?.emoji ?? ""} size={26} /><span>{trunkName(t)}</span>
    </button>)}
  </div></div>;
}
