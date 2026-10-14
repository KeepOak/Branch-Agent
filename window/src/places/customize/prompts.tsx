// Customize › Prompts (R1, preview 44908 and 44977): the saved prompts. A saved prompt is a skill in the library with a
// slash name (skills.library.list, the list Settings › Instructions reads). Use puts its command into the composer.
import { useState } from "react";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { Status } from "../library/ui";
import { Grey, list, rec, str } from "./common";
import { Glyph } from "./glyphs";
import type { ToolsCtx } from "./tools";

export type SavedPrompt = { slug: string; description: string };
export function savedPrompts(result: unknown): SavedPrompt[] {
  return list(rec(result).entries).filter(e => e.removed !== true && str(e.slug)).map(e => ({ slug: str(e.slug), description: str(e.description) }));
}
export function promptCount(ctx: ToolsCtx): number | null {
  return ctx.prompts.data ? savedPrompts(ctx.prompts.data).length : null;
}

export function Prompts({ ctx }: { ctx: ToolsCtx }) {
  const prompts = savedPrompts(ctx.prompts.data);
  const [copied, setCopied] = useState("");
  const copy = (slug: string) => { void navigator.clipboard?.writeText(`/${slug}`).then(() => setCopied(slug), () => setCopied("")); };
  return <div className="t9-list" data-testid="prompts">
    <div className="cz-head-row"><b>{prompts.length} saved</b><Grey className="btn pri sm" reason="Saving a new prompt from here comes in a later update.">＋ Add</Grey></div>
    <Status {...ctx.prompts} />
    {ctx.prompts.data != null && !prompts.length && <EmptyLine icon={<Glyph name="sparkle" size={22} />}>No saved prompts yet.</EmptyLine>}
    {prompts.map(p => <div key={p.slug} className="t9-item cz-prompt">
      <span className="cz-tile"><Glyph name="sparkle" size={16} /></span>
      <span className="grow"><b>/{p.slug}</b><small>{p.description || "A saved prompt"}</small></span>
      <button type="button" className="btn ghost sm" aria-label={`Copy /${p.slug}`} onClick={() => copy(p.slug)}>{copied === p.slug ? "Copied" : "Copy"}</button>
      {ctx.usePrompt && <button type="button" className="btn sm" onClick={() => ctx.usePrompt?.(`/${p.slug} `)}>Use</button>}
    </div>)}
  </div>;
}
