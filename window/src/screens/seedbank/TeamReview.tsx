// The team install review (R1-08 "Paste a seed", Private #544): one sheet before anything is created. Each Trunk shows its
// model, permissions and routines (routines start off), what the scrub removed, and hidden instructions, which turn Add off.
// Add creates one Trunk per bot, in order, through trunks.template.create. A Trunk already made is kept if a later one
// fails, and "Add the rest" creates only the ones still missing, so nothing is made twice.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import { Sheet } from "./InstallSheet";
import { hasHiddenInstructions } from "./seed";
import { templateFor, type TeamBot, type TeamFile } from "./team-markdown";

type Outcome = { added: ReadonlySet<number>; errors: ReadonlyMap<number, string> };
type Props = { team: TeamFile; engine: WindowEngine; onClose: () => void; onDone: (result: { notice: string }) => void };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One Trunk's entry in What it adds: its model, what the file says it may do, its routines, and where it stands. */
function BotRow({ bot, index, outcome }: { bot: TeamBot; index: number; outcome: Outcome }) {
  const error = outcome.errors.get(index);
  const state = outcome.added.has(index) ? "Added ✓" : error ? "Not added: " + error : "";
  return <div className="sb-bot">
    <b className="g-label">{bot.name}</b>
    <small className="g-label">{[bot.model || "Default model", count(bot.routines.length, "routine", "routines")].join(" · ")}</small>
    {bot.description && <small className="g-label" data-lines>{bot.description}</small>}
    {bot.permissions.length > 0 && <ul className="sb-may g-frost">{bot.permissions.map(line => <li key={line}>{line}</li>)}</ul>}
    {bot.routines.map(routine => <small key={routine.name} className="g-label" data-lines>Routine {routine.name} · {routine.cron} · off until you turn it on</small>)}
    {hasHiddenInstructions(bot.instructions) && <p className="sb-error g-label" data-lines role="alert">{bot.name} has hidden instructions. Add is off.</p>}
    {state && <small className="g-label" data-lines>{state}</small>}
  </div>;
}

export function TeamReview({ team, engine, onClose, onDone }: Props) {
  const [outcome, setOutcome] = useState<Outcome>({ added: new Set(), errors: new Map() });
  const [busy, setBusy] = useState(false);
  const blocked = team.bots.some(bot => hasHiddenInstructions(bot.instructions));

  async function add() {
    if (busy || blocked) return;
    setBusy(true);
    const added = new Set(outcome.added), errors = new Map<number, string>();
    for (const index of team.bots.map((_, i) => i).filter(i => !added.has(i))) {
      try { await engine.request("trunks.template.create", { template: templateFor(team.bots[index]!) }); added.add(index); }
      catch (error) { errors.set(index, errorText(error)); }
    }
    setOutcome({ added, errors });
    setBusy(false);
    if (!errors.size) onDone({ notice: `Added ${team.name}: ${count(added.size, "Trunk", "Trunks")}. Routines are off until you turn them on.` });
  }

  const footer = <>
    <button type="button" className="sb-btn" data-local="" onClick={onClose}>Cancel</button>
    <Coming engine={engine} need="trunks.template.create">
      <button type="button" className="sb-btn" data-primary="" disabled={busy || blocked} onClick={() => void add()}>{busy ? "Adding…" : outcome.added.size ? "Add the rest" : "Add team"}</button>
    </Coming>
  </>;

  return <Sheet title={`Add ${team.name}?`} onClose={onClose} footer={footer} wide>
    <div className="sb-preview"><div className="sb-look"><b className="g-label">{team.name}</b>{team.description && <small className="g-label" data-lines>{team.description}</small>}</div></div>
    <div className="sb-meta"><span className="sb-pill g-label">Team</span><span className="g-label">{count(team.bots.length, "Trunk", "Trunks")} · from a file</span></div>
    <section className="sb-sec"><h3 className="g-label">What it adds</h3>{team.bots.map((bot, index) => <BotRow key={index} bot={bot} index={index} outcome={outcome} />)}</section>
    <section className="sb-sec"><h3 className="g-label">Safety check</h3><dl className="sb-kv g-frost">
      <dt>Hidden instructions</dt><dd data-bad={blocked || undefined}>{blocked ? "Found. Add is off." : "None found."}</dd>
      <dt>Secrets</dt><dd>{team.removed ? `Removed ${count(team.removed, "secret", "secrets")} from the file.` : "None found."}</dd>
    </dl></section>
    <section className="sb-sec"><h3 className="g-label">What it may do</h3><p className="sb-hint g-label" data-lines>Every Trunk starts on Ask first. The permissions above are what the file says, not a setting. Routines start off.</p></section>
    {outcome.errors.size > 0 && <p className="sb-error g-label" data-lines role="alert">{count(outcome.errors.size, "Trunk", "Trunks")} not added. Add the rest keeps the ones already made.</p>}
  </Sheet>;
}
