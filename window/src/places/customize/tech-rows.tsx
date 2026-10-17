// The Technical rows at the foot of a kind's list (preview 27136-27150, the TECH table in the Customize renderer). They
// draw at Technical only; each "Open" is Coming until the engine offers that screen (Grey hides it below Technical).
import type { ReactNode } from "react";
import { shows } from "../../places-nav/level";
import { Grey } from "./common";
import type { Kind } from "./kind-chrome";
import type { ToolsCtx } from "./tools";

type Row = [label: string, line: string];
const TECH: Partial<Record<Kind, Row[]>> = {
  Skills: [["Pinned skills", "Load these in every conversation, before any others."], ["Signed packages only", "Refuse skills whose package isn’t signed."], ["Search back end", "Local index (default) · or your own search server."]],
  Plugins: [["Signed packages only", "Refuse plugins whose package isn’t signed."], ["Search back end", "Where plugin search looks: the catalogue, or your own index."]],
  Connectors: [["OpenAPI tools", "Turn an OpenAPI description into connector tools."], ["Scripts and WebAssembly", "Small local tools written as scripts."], ["WebSocket tools", "Tools that stream over a WebSocket."], ["Playground", "Call any tool by hand and see the raw reply."]],
};

/** Renders the kind's Technical rows; nothing below Technical. */
export function TechRows({ ctx, kind }: { ctx: ToolsCtx; kind: Kind }): ReactNode {
  const rows = TECH[kind];
  if (!rows || !shows(ctx.level, "technical")) return null;
  return <div className="cz-tech" data-tech={kind}><p className="cz-grp">Technical</p>
    {rows.map(([label, line]) => <div key={label} className="ctl"><b>{label}</b><span className="right">
      <Grey reason={`${label} comes in a later update.`}>Open</Grey></span><small>{line}</small></div>)}
  </div>;
}
