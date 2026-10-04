// People › Groups (§4.6.5.3): permission groups that can only take things away. The engine keeps no such groups
// yet (its roles give one role per person), so the screen shows its empty line and New group is greyed.
import { Icon } from "../../shell/icons";
import { shownWhy } from "../../shell/shown-why";
import { Empty } from "./ui";

export const GROUPS_OFF = "Needs the engine's permission groups.";

export function GroupsTab() {
  return <>
    <p className="pp-hint" style={{ margin: "0 0 10px" }}>Being in a group can only take things away. Use groups to limit many people at once.</p>
    <Empty>No groups yet.</Empty>
    <div className="pp-acts"><button type="button" className="btn sm" disabled title={shownWhy(GROUPS_OFF)}><Icon name="plus" small />New group</button>{shownWhy(GROUPS_OFF) && <span className="pp-hint" style={{ margin: 0 }}>{shownWhy(GROUPS_OFF)}</span>}</div>
  </>;
}
