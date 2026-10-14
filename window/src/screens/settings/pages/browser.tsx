// Settings › Browser & screen: the approved preview's ten cards (preview.html PG browser), drawn from Classic Computer &
// browser's own section data (set2/computer-more.tsx, set2/computer-browser.tsx) and Advanced's Web search, more. Each
// Classic row becomes an R1 row on its card (spec-rows.tsx); a row Classic left out because Branch can't do it yet is a
// Coming row in its own words, and Sites and Saved flows, which no Classic control does, are Coming.
import type { SettingsPageProps } from "../../../places/settings/index";
import { list } from "../../../places/settings/adapter";
import { useConfig, useScope } from "../../../places/settings/kit";
import { WEB_MORE } from "../../../places/settings/set2/advanced-more";
import { Section } from "../../../places/settings/set2/advanced-more";
import { lvOf, rec, useLive, type RecordValue } from "../../../places/settings/set2/common";
import { BROWSER_BASIC, BROWSER_MORE, BROWSER_TECH } from "../../../places/settings/set2/computer-browser";
import { PART_SECS as S, type SecSpec } from "../../../places/settings/set2/computer-more";
import type { Row } from "../rows";
import { specPage } from "./spec-rows";

type AdvancedSpec = Parameters<typeof Section>[0]["spec"];
/** One of Classic Advanced's sections, with the context its rows read. */
function AdvancedSection({ spec, props }: { spec: AdvancedSpec; props: SettingsPageProps }) {
  const config = useConfig(props.engine);
  const agent = useScope() ?? props.engine.agentId ?? "";
  const plugins = useLive<RecordValue>(props.engine, "plugins.list", {}, ["plugins"]);
  return <Section spec={{ ...spec, lv: 0 }} c={{ ...props, config, lv: lvOf(props.level), agent, plugins: list(rec(plugins.data).plugins) }} />;
}
/** An Advanced section as a section of its own, drawn as one bare row. */
export const advanced = (spec: AdvancedSpec): SecSpec => ({ t: spec.title, lv: spec.lv as SecSpec["lv"], body: (c) => <AdvancedSection spec={spec} props={c.props} /> });

const [MORE, HOW, CLEANERS, HANDS, OWN] = BROWSER_MORE;
const [TECH, CLOUD_BROWSERS] = BROWSER_TECH;

const PAGE = specPage("browser", [
  ["On a computer", [S.ON_COMPUTER, S.ON_MORE]],
  ["Using the screen", [S.USING_SCREEN, S.USING_MORE, S.USING_TECH, S.SCREEN_TECH]],
  ["The browser", [BROWSER_BASIC, MORE, TECH, CLOUD_BROWSERS]],
  ["How it browses", [HOW, advanced(WEB_MORE)]],
  ["Page cleaners", [CLEANERS]],
  ["What it hands to you", [HANDS]],
  ["Your own browser", [OWN]],
  ["Logbook", [S.LOGBOOK]],
]);

/** A card no Classic control does yet: Coming, in its own words (R1-10); the call it waits for stays in `need`. */
const coming = (id: string, card: string, need: string): Row =>
  ({ id, page: "browser", card, label: card, level: 1, control: "custom", source: { kind: "coming", need, reason: `${card} comes in a later update.` } });

/** In the preview's card order: Sites after How it browses, Saved flows after What it hands to you. */
const ORDER = ["On a computer", "Using the screen", "The browser", "How it browses", "Sites", "Page cleaners", "What it hands to you", "Saved flows", "Your own browser", "Logbook"];
export const BROWSER = {
  rows: [...PAGE.rows, coming("browser.sites.coming", "Sites", "engine: per-site rules for the browser"), coming("browser.flows.coming", "Saved flows", "engine: saved browser flows")]
    .sort((a, b) => ORDER.indexOf(a.card) - ORDER.indexOf(b.card)),
  controls: PAGE.controls,
};
