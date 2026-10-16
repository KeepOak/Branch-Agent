// Mount point for Settings pages (DESIGN-SPEC §4.7.1 to §4.7.20). Each set file maps page ids to their components
// (set1: General to Permissions; set3, set4: the rest) and lists its rows for search (ROWS); the frame draws the nav,
// Back, search, "Settings for", the save state and "How much to show", and routes here.
import type { WindowEngine } from "../../connect/engine";
import { sectionId, type Level } from "../../places-nav/settings-nav";
import type { RowEntry } from "./kit";
import { PAGES as PAGES1, ROWS as ROWS1 } from "./pages/set1";
import { PAGES as PAGES2, ROWS as ROWS2 } from "./pages/set2";
import { PAGES as PAGES3, ROWS as ROWS3 } from "./pages/set3";
import { PAGES as PAGES4, ROWS as ROWS4 } from "./pages/set4";

export type SettingsPageProps = { page: string; title: string; level: Level; engine: WindowEngine; running?: number; openSettings?: (page: string) => void; searchSection?: string };

const PAGES: Record<string, React.ComponentType<SettingsPageProps>> = { ...PAGES1, ...PAGES2, ...PAGES3, ...PAGES4 };
/** Every page's rows, for the settings search. */
export const SETTINGS_ROWS: RowEntry[] = [...ROWS1, ...ROWS2, ...ROWS3, ...ROWS4];

export function SettingsPage(props: SettingsPageProps) {
  const Page = PAGES[props.page];
  return Page ? <Page key={sectionId(props.page)} {...props} /> : <h1>{props.title}</h1>;
}
