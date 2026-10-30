// Settings › Who uses Branch: the controls the R1 page draws itself. The People place buttons open the People place at its
// tab (Classic people-more.tsx openPeople); Signed household records opens Classic's record of the newest runs (audit.list).
import { useState } from "react";
import { list, record, visible } from "../../../places/settings/adapter";
import { RecordsDialog, openPeople } from "../../../places/settings/set1/people-more";
import { PeopleBlock } from "../../../places/settings/set1/people";
import { ClassicBlock } from "./spec-rows";
import type { SlotControlProps } from "../slots";
import { useRead } from "./accounts-live";
import { Needs } from "./appearance-live";

/** Groups, Signing in from other devices, What you share: the People place at that tab, as the preview's buttons. */
export function PeopleButtons(_props: SlotControlProps) {
  return <span className="r1s-own-ctl r1s-acts" data-local="">
    <button type="button" className="r1s-btn" onClick={() => openPeople("Groups")}>Groups</button>
    <button type="button" className="r1s-btn" onClick={() => openPeople("Signing in")}>Signing in from other devices</button>
    <button type="button" className="r1s-btn" onClick={() => openPeople("Shared")}>What you share</button>
  </span>;
}

/** Signed household records: See the last opens the newest records. */
export function SignedRecords({ engine, row }: SlotControlProps) {
  const [open, setOpen] = useState(false);
  const agents = useRead(engine, "agents.list");
  const trunks = new Map(list(agents.data?.agents).map((a) => [String(a.id), visible(record(a.identity).name ?? a.name ?? a.id)]));
  return <>
    <Needs engine={engine} need={["audit.list"]} where={row.label ?? ""}><button type="button" className="r1s-btn" onClick={() => setOpen(true)}>See the last</button></Needs>
    {open ? <RecordsDialog engine={engine} trunks={trunks} onClose={() => setOpen(false)} /> : null}
  </>;
}

/** Everyone who uses Branch, the chosen person's card and Invite someone: Classic's own block inside the People card. */
export function Everyone(props: SlotControlProps) {
  return <ClassicBlock {...props} draw={(c) => <PeopleBlock {...c.props} />} />;
}
