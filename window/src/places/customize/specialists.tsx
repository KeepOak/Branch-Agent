// Customize › Specialists (preview 40-places.js, 94-g4p.js fleet15/pat15): defined specialists with Edit, the
// fleet line (agents.list, node.list and the shell's running count), and how Trunks work together. The engine
// has no specialist definitions or teamwork setting yet, so those parts are drawn greyed with the reason.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { Face } from "../../face/Face";
import { shownWhy } from "../../shell/shown-why";
import { EmptyLine, type PlaceProps } from "../../places-nav/PlaceFrame";
import { shows, type Level } from "../../places-nav/level";
import { trunkName, useResource, type Trunk } from "../library/data";
import { Grey, list, rec } from "./common";
import { Glyph } from "./glyphs";

const NO_DEFINITIONS = "Needs the engine's specialist definitions.";
const NO_PATTERN = "Needs the engine's teamwork setting.";
type Pattern = { id: string; title: string; line: string; dots: [number, number][]; lines: [number, number, number, number][] };
const PATTERNS: Pattern[] = [
  { id: "single", title: "One at a time", line: "A Trunk calls a specialist, waits, carries on.", dots: [[26, 8], [26, 26], [26, 44]], lines: [[26, 12, 26, 22], [26, 30, 26, 40]] },
  { id: "super", title: "A lead and helpers", line: "One Trunk plans and hands out the parts.", dots: [[26, 8], [12, 40], [26, 40], [40, 40]], lines: [[26, 12, 12, 36], [26, 12, 26, 36], [26, 12, 40, 36]] },
  { id: "swarm", title: "Swarm", line: "Equals pass the work to whoever fits best.", dots: [[10, 12], [42, 12], [26, 40]], lines: [[14, 12, 38, 12], [12, 16, 24, 36], [40, 16, 28, 36]] },
  { id: "router", title: "Router", line: "Sends each request to the one Trunk that matches.", dots: [[8, 26], [24, 26], [44, 10], [44, 26], [44, 42]], lines: [[12, 26, 20, 26], [28, 24, 40, 12], [28, 26, 40, 26], [28, 28, 40, 40]] },
  { id: "parallel", title: "In parallel", line: "The same job split up, then gathered.", dots: [[26, 6], [12, 26], [26, 26], [40, 26], [26, 46]], lines: [[24, 9, 13, 22], [26, 10, 26, 22], [28, 9, 39, 22], [13, 30, 24, 43], [26, 30, 26, 42], [39, 30, 28, 43]] },
  { id: "teams", title: "Teams", line: "Small groups, each with its own lead.", dots: [[14, 10], [36, 10], [8, 38], [20, 38], [30, 38], [42, 38]], lines: [[18, 10, 32, 10], [13, 14, 9, 34], [15, 14, 19, 34], [35, 14, 31, 34], [37, 14, 41, 34]] },
];
const BUILT_IN: [string, string][] = [
  ["General", "Any task, with the Trunk's own tools"], ["Explore", "Searches code and files; reads only"], ["Plan", "Writes a plan and changes nothing"],
  ["Do", "Carries out a plan step by step"], ["Commands", "Runs commands in a terminal"], ["Branch help", "Answers questions about Branch from its own guide"],
];

export function SpecialistsTab({ engine, level, trunks, facts, openAgents }: { engine: PlaceProps["engine"]; level: Level; trunks: Trunk[]; facts: PlaceProps["facts"]; openAgents: () => void }) {
  return <div className="cz-page" data-testid="specialists">
    <p className="cz-lede">Helpers a Trunk calls in for one job, then lets go.</p>
    <EmptyLine icon={<Glyph name="sparkle" size={22} />}>No specialists yet.</EmptyLine>
    <p className="cz-hint cz-center" title={shownWhy(NO_DEFINITIONS)}>Helper conversations a Trunk starts stay in its conversation list.</p>
    <Fleet engine={engine} trunks={trunks} running={facts.running} />
    <section className="cz-block"><h2 className="cz-h2">How Trunks work together</h2><p className="cz-hint">The pattern a room or a big task uses. Branch picks one; you can choose.</p>
      <div className="cz-pats" role="radiogroup" aria-label="How Trunks work together">{PATTERNS.map(p => <button key={p.id} type="button" role="radio" aria-checked={false} className="cz-pat" disabled title={shownWhy(NO_PATTERN)}>
        <svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true">{p.lines.map((l, i) => <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} />)}{p.dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3.5" className={i === 0 ? "lead" : undefined} />)}</svg>
        <b>{p.title}</b><small>{p.line}</small></button>)}</div></section>
    {shows(level, "advanced") && <section className="cz-block"><h2 className="cz-h2">Other coding agents</h2>
      <div className="cz-prow"><span className="cz-tile"><Glyph name="terminal" size={16} /></span><span className="grow"><b>Hand coding to another agent</b><small>A Trunk can pass a coding job to another coding agent on this computer, then check the result.</small></span><button type="button" className="btn sm" onClick={openAgents}>See how</button></div></section>}
    {shows(level, "advanced") && <section className="cz-block"><h2 className="cz-h2">Built in</h2><p className="cz-hint">Helpers every Trunk can call. Off: Trunks won't offer that one.</p>
      {BUILT_IN.map(([name, line]) => <div key={name} className="cz-prow"><span className="cz-tile"><Glyph name="sparkle" size={16} /></span><span className="grow"><b>{name}</b><small>{line} · comes with Branch, can't be edited</small></span>
        <button type="button" role="switch" aria-checked={true} aria-label={`Offer ${name}`} className="switch" disabled title={shownWhy("Needs the engine's built-in helper switches.")} /></div>)}</section>}
    <section className="cz-block"><h2 className="cz-h2">Let specialists argue it out</h2>
      <div className="cz-prow"><span className="cz-tile"><Glyph name="people" size={16} /></span><span className="grow"><b>Two or three specialists take sides on a question</b><small>Each answers the others in turn, then you get both sides and where they agree.</small></span><Grey reason="Needs the engine's debate method.">Start</Grey></div></section>
  </div>;
}

/** "N Trunks on N computers · N working now", from the engine's Trunks and computers and the shell's running count. */
function Fleet({ engine, trunks, running }: { engine: PlaceProps["engine"]; trunks: Trunk[]; running: number }) {
  const nodes = useResource<unknown>(engine, "node.list");
  const connected = list(rec(nodes.data).nodes).filter(n => n.connected !== false);
  const computers = Math.max(1, connected.length);
  if (!trunks.length) return null;
  return <div className="cz-fleet" data-testid="fleet"><span className="cz-faces">{trunks.slice(0, 6).map(t => <Face key={t.id} size={22} label={trunkName(t)} />)}</span>
    <span className="grow"><b>{trunks.length} {trunks.length === 1 ? "Trunk" : "Trunks"} on {computers} {computers === 1 ? "computer" : "computers"}</b><small>{running} working now</small></span></div>;
}
