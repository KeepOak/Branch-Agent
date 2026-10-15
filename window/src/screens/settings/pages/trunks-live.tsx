// Settings › Trunks, the full Trunks page (SETTINGS-PROPOSAL "Trunks" row; CUSTOMIZE-PROPOSAL §3, owner approved: no
// Trunks tab in Customize). Everything from Customize › Trunks comes here unchanged, so nothing working is lost: each
// Trunk's row (face and name open its profile, Who it knows, Edit, and the ••• menu with Make default, Share this Trunk…
// and Remove), A new Trunk, New group chat, the job templates, and at Technical the defaults for every Trunk. The •••
// items the engine can't run yet (Pause, Show it how once, Package…) are greyed in the menu (TRUNK_MENU_COMING), and the
// page's two parts with no engine call yet are Coming rows naming the call each waits for (TRUNKS_COMING).
import { Coming } from "../../../glass/coming";
import { TrunksTab } from "../../../places/customize/trunks";
import { useResource, type Trunks } from "../../../places/library/data";
import { pageFor } from "../nav";
import type { Row } from "../rows";
import { SECTION_COMING, useLevel } from "../SettingsFrame";
import type { SlotPageProps } from "../slots";
import "../../../places/library/places.css";
import "../../../places/customize/customize.css";

const LEVEL_WORD = ["regular", "advanced", "technical"] as const;

/** The parts of the approved page the engine can't do yet, each with the call it waits for. */
export const TRUNKS_COMING = [
  { card: "Groups and Grafted agents", label: "Make a group or a Grafted agent the default", need: "agents.setDefault", level: 1 as const },
  { card: "Trunks’ own databases", label: "A database of its own for each Trunk", need: "config.patch", level: 2 as const },
];

/** Re-hosted Classic pages and Trunk profiles open a place this way; R1Window opens it (branch:navigate-place). */
const openPlace = (place: string) => window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place } }));

export function TrunksPage({ engine, onPage }: SlotPageProps) {
  const [level] = useLevel(engine);
  const trunks = useResource<Trunks>(engine, "agents.list");
  return (
    <>
      <div className="r1s-col">
        <section className="r1s-sec g-clear r1s-trunks" aria-label="Your Trunks">
          <div className="kp kp-customize">
            <TrunksTab engine={engine} level={LEVEL_WORD[level]} trunks={trunks} openPlace={openPlace} openSettings={(id) => onPage?.(pageFor(id))} />
          </div>
        </section>
        {TRUNKS_COMING.filter((c) => c.level <= level).map((c) => (
          <section key={c.card} className="r1s-sec g-clear" aria-label={c.card}>
            <h2 className="g-label">{c.card}</h2>
            <Coming engine={engine} need={c.need} unwired reason={SECTION_COMING(c.card)} where={`Trunks › ${c.card}`}>
              <div className="r1s-row">
                <b className="g-label">{c.label}</b>
                <small className="r1s-note g-label" data-lines>{SECTION_COMING(c.card)}</small>
              </div>
            </Coming>
          </section>
        ))}
      </div>
    </>
  );
}

const row = (id: string, card: string, label: string, level: 0 | 1 | 2): Row =>
  ({ id: `trunks.${id}`, page: "trunks", card, label, level, ownerLevel: true, control: "custom", source: { kind: "slot", calls: [], reason: "Drawn by the page." } }) satisfies Row;

/** What the page draws, as rows of the R1 table, so the R1 search finds them and opens Settings › Trunks. */
export const TRUNK_ROWS: Row[] = [
  row("list.new", "Your Trunks", "A new Trunk", 0),
  row("list.group", "Your Trunks", "New group chat", 0),
  row("list.make-default", "Your Trunks", "Make default", 0),
  row("list.share", "Your Trunks", "Share this Trunk", 0),
  row("list.who-it-knows", "Your Trunks", "Who it knows", 0),
  row("list.remove", "Your Trunks", "Remove a Trunk", 0),
  row("jobs.start", "Start from a job", "Start from a job", 0),
  row("defaults.cwd", "Defaults for every Trunk", "Working folder", 2),
  row("defaults.workspace", "Defaults for every Trunk", "Trunks’ own folders", 2),
  row("defaults.bootstrap", "Defaults for every Trunk", "Longest instruction file", 2),
  row("defaults.bootstrap-total", "Defaults for every Trunk", "All instruction files together", 2),
  row("defaults.timezone", "Defaults for every Trunk", "Time zone", 2),
  row("defaults.image", "Defaults for every Trunk", "Largest picture side", 2),
  ...TRUNKS_COMING.map((c) => row(`coming.${c.need.replace(/\W+/g, "-")}`, c.card, c.label, c.level)),
];
