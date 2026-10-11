// Settings › Devices & apps: the tiles that were Customize › Everywhere (one per place you reach Branch from:
// Windows, Mac, a terminal, phones, keepoak.com, chat apps, a page of your own). Moved here so Customize keeps to
// Trunks, Tools and Chat apps; the Chat apps tile opens Settings › Chat apps.
import type { SettingsPageProps } from "../index";
import { Page, type RowEntry } from "../kit";
import { EverywhereTab } from "../../customize/everywhere";
import "../../customize/customize.css";

const LEDE = "One Branch, everywhere you are: this computer, your phones, a terminal and the chat apps you use.";

export const ROWS: RowEntry[] = [];

export function DevicesPage(props: SettingsPageProps) {
  return <Page title={props.title} lede={LEDE}>
    <div className="cz"><EverywhereTab engine={props.engine} openChannels={() => props.openSettings?.("chatapps")} /></div>
  </Page>;
}
