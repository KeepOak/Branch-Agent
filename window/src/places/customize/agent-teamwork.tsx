// Customize › Agents & specialists (R1, preview's Agents renderer): the Specialists, the Fleet line, How Trunks work
// together, Other coding agents, Built in, and Let specialists argue it out, with the preview's copy. Its patterns are
// the same ones Settings › Helpers draws (specialists.tsx PATTERNS); the copy here is the preview's own.
import { Fleet, PATTERNS } from "./specialists";
import { Grey } from "./common";
import { Glyph } from "./glyphs";
import { TechnicalOnly } from "./kind-chrome";
import type { ToolsCtx } from "./tools";

const BUILT_IN: [string, string][] = [
  ["General", "Any task, with the Trunk’s own tools"],
  ["Explore", "Searches code and files; reads only"],
  ["Plan", "Writes a plan and changes nothing"],
  ["Do", "Carries out a plan step by step"],
  ["Commands", "Runs commands in a terminal"],
  ["Branch help", "Answers questions about Branch from its own guide"],
];

export function AgentsTeamwork({ ctx }: { ctx: ToolsCtx }) {
  return <>
    <h3 className="cz-h3">Specialists</h3>
    <p className="cz-hint">Helpers a Trunk calls in for one job, then lets go.</p>
    <TechnicalOnly><div className="cz-acts"><Grey reason="Adding a specialist comes in a later update.">＋ Add</Grey></div></TechnicalOnly>
    <Fleet engine={ctx.engine} trunks={ctx.trunks} />

    <TechnicalOnly>
    <h3 className="cz-h3">How Trunks work together</h3>
    <p className="cz-hint">The pattern a room or a big task uses. Branch picks one; you can choose.</p>
    <div className="cz-pats">{PATTERNS.map(p => <Grey key={p.id} className="cz-pat" reason="Choosing how Trunks work together comes in a later update.">
      <svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true">{p.lines.map((l, i) => <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} />)}{p.dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3.5" />)}</svg>
      <b>{p.title}</b><small>{p.line}</small></Grey>)}</div>

    <h3 className="cz-h3">Other coding agents</h3>
    <div className="cz-line"><span>Hand coding to another agent<small>A Trunk can pass a coding job to Claude Code, Codex or Gemini CLI on this computer, then check the result.</small></span>
      <Grey reason="Showing how to hand coding to another agent comes in a later update.">See how</Grey></div>

    <h3 className="cz-h3">Built in</h3>
    <p className="cz-hint">Helpers every Trunk can call. Off: Trunks won’t offer that one.</p>
    {BUILT_IN.map(([name, line]) => <div key={name} className="cz-line"><span><Glyph name="sparkle" size={14} /> {name}<small>{line} · comes with Branch, can’t be edited</small></span>
      <Grey className="switch" reason={`Turning off ${name} comes in a later update.`}><span /></Grey></div>)}

    <h3 className="cz-h3">Let specialists argue it out</h3>
    <div className="cz-line"><span>Two or three specialists take sides on a question<small>Each answers the others in turn, then you get both sides and where they agree.</small></span>
      <Grey className="switch" reason="Letting specialists argue it out comes in a later update."><span /></Grey></div>
    </TechnicalOnly>
  </>;
}
