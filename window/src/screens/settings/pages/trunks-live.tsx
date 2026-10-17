// Settings › Trunks, as the approved preview draws it (preview.html PG trunksP17, item 36): one untitled card with A new
// Trunk, New group chat, each Trunk's row (face and name open its profile; Edit; the ••• menu in the preview's words, with
// Who it knows in it) and one "Start from a template" row that opens Seedbank; at Technical the defaults for every Trunk's
// folders and sizes inside it. At Advanced the preview's "Defaults for every Trunk" and "Trunks’ own databases" cards
// follow. Everything Customize › Trunks did works here (places/customize/trunks.tsx, its Settings variant); the rows and
// buttons the preview has with nothing behind them yet are Coming in their own words (R1-10).
import type { ReactElement } from "react";
import { Coming } from "../../../glass/coming";
import { TrunksTab } from "../../../places/customize/trunks";
import { useResource, type Trunks } from "../../../places/library/data";
import { pageFor } from "../nav";
import { COMING_FROM, type Row } from "../rows";
import { Toggle } from "../RowView";
import { SECTION_COMING, useLevel } from "../SettingsFrame";
import type { SlotPageProps } from "../slots";
import "../../../places/library/places.css";
import "../../../places/customize/customize.css";

const LEVEL_WORD = ["regular", "advanced", "technical"] as const;
const DEFAULTS = "Defaults for every Trunk";
const DATABASES = "Trunks’ own databases";

/** The preview's "Defaults for every Trunk" rows (Advanced; Classic Advanced's "Trunks, more"): a switch or a button each,
 *  Coming until the engine has a setting behind it. */
export const TRUNK_DEFAULTS: { id: string; label: string; help?: string; button?: string; need: string }[] = [
  { id: "projects", label: "Projects pick up matching work", need: "config: projects picking up matching work" },
  { id: "follow-up", label: "Follow-up tasks", help: "A Trunk can leave itself a task for later, shown in the Board.", need: "config: follow-up tasks" },
  { id: "standing", label: "Standing orders", help: "Named programmes a Trunk keeps running; ESCALATE pauses one and asks you.", button: "See them", need: "engine: standing orders" },
  { id: "from-now-on", label: "“From now on” for a specialist", help: "A standing instruction kept by one specialist.", button: "Add one", need: "engine: standing instructions for a specialist" },
  { id: "share", label: "Share a Trunk", help: "Through Git, as a skill bundle, or exported with memory details removed.", button: "Export…", need: "engine: exporting a Trunk" },
  { id: "modes", label: "Custom modes", help: "Your own modes; one can hand the work back when it’s done.", need: "engine: custom modes" },
  { id: "marketplace", label: "Agent marketplace", help: "Trunks others made, each with a fingerprint you can check.", button: "Browse", need: "engine: an agent marketplace" },
  { id: "packages", label: "Trunk packages", help: "Add, update and share Trunks as packages. Off as it ships: still experimental.", need: "engine: Trunk packages" },
];

/** Re-hosted Classic pages and Trunk profiles open a place this way; R1Window opens it (branch:navigate-place). */
const openPlace = (place: string) => window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place } }));

function DefaultRow({ engine, item }: { engine: SlotPageProps["engine"]; item: (typeof TRUNK_DEFAULTS)[number] }): ReactElement {
  const reason = `${item.label} comes in a later update.`;
  return (
    <div className="r1s-row" data-row={`trunks.defaults.${item.id}`} data-lv="Advanced">
      <b className="g-label" data-lv="Advanced">{item.label}</b>
      {item.help ? <small className="g-label" data-lines>{item.help}</small> : null}
      <div className="r1s-ctl">
        <Coming engine={engine} need={item.need} unwired reason={reason} where={item.label}>
          {item.button
            ? <button type="button" className="r1s-btn">{item.button}</button>
            : <span className="r1s-own-ctl"><Toggle label={item.label} on={false} disabled aria-disabled="true" title={reason} onChange={() => undefined} /></span>}
        </Coming>
      </div>
      {item.button ? null : <small className="r1s-note g-label" data-lines>{reason}</small>}
    </div>
  );
}

export function TrunksPage({ engine, onPage }: SlotPageProps) {
  const [level] = useLevel(engine);
  const trunks = useResource<Trunks>(engine, "agents.list");
  return (
    <div className="r1s-col">
      <section className="r1s-sec g-clear r1s-trunks" aria-label="Your Trunks">
        <div className="kp kp-customize">
          <TrunksTab engine={engine} level={LEVEL_WORD[level]} trunks={trunks} openPlace={openPlace} openSettings={(id) => onPage?.(pageFor(id))}
            settings={{ openTemplates: () => onPage?.("seedbank") }} />
        </div>
      </section>
      {/* Both cards wait for a later update: like every Coming row, Technical only (rows.ts COMING_FROM). */}
      {level >= COMING_FROM ? <>
        <section className="r1s-sec g-clear" aria-label={DEFAULTS}>
          <h2 className="g-label">{DEFAULTS}</h2>
          {TRUNK_DEFAULTS.map((item) => <DefaultRow key={item.id} engine={engine} item={item} />)}
        </section>
        <section className="r1s-sec g-clear" aria-label={DATABASES}>
          <h2 className="g-label">{DATABASES}</h2>
          <Coming engine={engine} need="engine: a database of a Trunk's own" unwired reason={SECTION_COMING(DATABASES)} where={`Trunks › ${DATABASES}`}>
            <div className="r1s-row">
              <b className="g-label">Coming</b>
              <small className="g-label" data-lines>A Trunk can keep a small database of its own and set when it next wakes to work on it.</small>
              <small className="r1s-note g-label" data-lines>{SECTION_COMING(DATABASES)}</small>
            </div>
          </Coming>
        </section>
      </> : null}
    </div>
  );
}

const row = (id: string, card: string, label: string, level: 0 | 1 | 2): Row =>
  ({ id: `trunks.${id}`, page: "trunks", card, label, level, ownerLevel: true, control: "custom", source: { kind: "slot", calls: [], reason: "Drawn by the page." } }) satisfies Row;

/** What the page draws, as rows of the R1 table, so the R1 search finds them and opens Settings › Trunks. */
export const TRUNK_ROWS: Row[] = [
  row("list.new", "", "A new Trunk", 0),
  row("list.group", "", "New group chat", 0),
  row("list.make-default", "", "Make default", 0),
  row("list.share", "", "Share this Trunk", 0),
  row("list.who-it-knows", "", "Who it knows", 0),
  row("list.remove", "", "Remove Trunk", 0),
  row("templates.start", "", "Start from a template", 0),
  row("defaults.cwd", "", "Working folder", 2),
  row("defaults.workspace", "", "Trunks’ own folders", 2),
  row("defaults.bootstrap", "", "Longest instruction file", 2),
  row("defaults.bootstrap-total", "", "All instruction files together", 2),
  row("defaults.timezone", "", "Time zone", 2),
  row("defaults.image", "", "Largest picture side", 2),
  ...TRUNK_DEFAULTS.map((item) => row(`defaults.${item.id}`, DEFAULTS, item.label, 1)),
  row("databases", DATABASES, DATABASES, 1),
];
