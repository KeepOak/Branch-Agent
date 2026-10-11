// Settings › Helpers: what was Customize › Specialists (helpers a Trunk calls in for one job, the fleet line, how
// Trunks work together, and from Advanced the built-in helpers and handing coding to another agent). Moved here so
// Customize keeps to Trunks, Tools and Chat apps; "See how" opens Settings › Connected agents.
import type { SettingsPageProps } from "../index";
import { Page, type RowEntry } from "../kit";
import { useResource, type Trunks } from "../../library/data";
import { SpecialistsTab } from "../../customize/specialists";
import "../../customize/customize.css";

const LEDE = "Helpers a Trunk calls in for one job, then lets go.";

export const ROWS: RowEntry[] = [];

export function HelpersPage(props: SettingsPageProps) {
  const trunks = useResource<Trunks>(props.engine, "agents.list");
  return <Page title={props.title} lede={LEDE}>
    <div className="cz"><SpecialistsTab engine={props.engine} level={props.level} trunks={trunks.data?.agents ?? []} openAgents={() => props.openSettings?.("agents")} /></div>
  </Page>;
}
