// Settings › Computer & browser, one part at a time, for the Settings that gives each part its own page: Browser &
// screen draws the screen, browser and Logbook sections, and Coding draws Accounts' coding apps and the code and git
// sections. Same sections, same rows and same controls as Computer & browser (computer-more.tsx); the full page stays
// as it is. These pages are not in this window's own list, so its search keeps finding each row once, on Computer &
// browser.
import type { SettingsPageProps } from "../index";
import { Page, type RowEntry } from "../kit";
import { CodingApps } from "../set1/coding-apps";
import { ACCOUNTS_ROWS } from "../set1/rows";
import { ComputerMore, partRows } from "./computer-more";

export function ComputerBrowserPage(props: SettingsPageProps) {
  return (
    <Page title={props.title} lede="How Trunks use a computer’s screen and its browser.">
      <ComputerMore {...props} part="browser" />
    </Page>
  );
}

export function ComputerCodingPage(props: SettingsPageProps) {
  return (
    <Page title={props.title} lede="Code, git, checks and the coding apps Trunks work with.">
      <CodingApps engine={props.engine} />
      <ComputerMore {...props} part="coding" />
    </Page>
  );
}

const CODING_APPS = ACCOUNTS_ROWS.filter((r) => r.sec === "Coding apps on this computer").map((r): RowEntry => ({ ...r, page: "computer-coding" }));

export const ROWS: RowEntry[] = [...partRows("browser", "computer-browser"), ...CODING_APPS, ...partRows("coding", "computer-coding")];
