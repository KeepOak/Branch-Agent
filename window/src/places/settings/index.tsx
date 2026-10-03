// Mount point for Settings pages (DESIGN-SPEC §4.7.1 to §4.7.20). Each set file maps page ids to their components
// (set1: General to Permissions; set3, set4: the rest) and lists its rows for search (ROWS); the frame draws the nav,
// Back, search, "Settings for", the save state and "How much to show", and routes here.
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/settings-nav";
import type { RowEntry } from "./kit";
import * as SET1 from "./pages/set1";
import * as SET2 from "./pages/set2";
import * as SET3 from "./pages/set3";
import * as SET4 from "./pages/set4";

export type SettingsPageProps = { page: string; title: string; level: Level; engine: WindowEngine; openSettings?: (page: string) => void };

const SETS = [SET1, SET2, SET3, SET4] as { PAGES: Record<string, React.ComponentType<SettingsPageProps>>; ROWS?: RowEntry[] }[];
const PAGES = Object.assign({}, ...SETS.map((s) => s.PAGES)) as Record<string, React.ComponentType<SettingsPageProps>>;
/** Every page's rows, for the settings search. */
export const SETTINGS_ROWS: RowEntry[] = SETS.flatMap((s) => s.ROWS ?? []);

export function SettingsPage(props: SettingsPageProps) {
  const Page = PAGES[props.page];
  return Page ? <Page key={props.page} {...props} /> : <h1>{props.title}</h1>;
}
