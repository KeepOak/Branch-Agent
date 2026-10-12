// People › Rules (§4.6.5.8): team-wide limits. They belong to a keepoak.com team; with none connected the rows are
// drawn disabled under the banner, as the preview does, showing the defaults a team starts with.
import { Ctl, Seg, Sw } from "./ui";

export const NO_TEAM = "Needs your keepoak.com team. Connect it above.";

export function RulesTab() {
  return <>
    <Ctl title="Spending that needs an Admin’s yes" line="Anything a Trunk would buy or pay for above this."><Seg label="Spending that needs an Admin’s yes" value="25" options={[{ id: "10", name: "Over $10" }, { id: "25", name: "Over $25" }, { id: "100", name: "Over $100" }]} off={NO_TEAM} /></Ctl>
    <Ctl title="Only these services for shared Trunks" line="ChatGPT and Claude through the workspace’s accounts; the KeepOak computer’s own models."><Sw label="Only these services for shared Trunks" on off={NO_TEAM} /></Ctl>
    <Ctl title="Only Admins install skills and plugins" line="Members can ask; an Admin says yes once for everyone."><Sw label="Only Admins install skills and plugins" on off={NO_TEAM} /></Ctl>
    <Ctl title="Sign in with keepoak.com" line="Everyone signs in with their KeepOak account. Removing someone there removes them here."><Sw label="Sign in with keepoak.com" on off={NO_TEAM} /></Ctl>
    <Ctl title="Keep team conversations" line="Only conversations with shared Trunks. Private ones stay on each person’s computer."><Seg label="Keep team conversations" value="forever" options={[{ id: "30d", name: "30 days" }, { id: "1y", name: "1 year" }, { id: "forever", name: "Forever" }]} off={NO_TEAM} /></Ctl>
  </>;
}
