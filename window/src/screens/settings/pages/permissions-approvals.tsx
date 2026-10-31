// The R1 Permissions page: the re-hosted Classic permissions sections, then the Approvals card (preview Locks and
// records: the Approvals row, advanced level). Its Open button shows the approvals record in a dialog (preview
// apprDlgPS18): Waiting now, Standing permissions and Answered. The record is not drawn inline.
import { useState, type ReactNode } from "react";
import { AskHistory } from "../../approvals/AskHistory";
import { useAsks, useLockdown } from "../../approvals/useAsks";
import { Dialog } from "../../../shell/Dialog";
import type { WindowEngine } from "../../../connect/engine";
import type { PageSlot, SlotPageProps } from "../slots";
import { classicSlot } from "./classic-host";
import { useLevel } from "../SettingsFrame";

const classic = classicSlot("permissions", "permissions");
const ClassicPermissions = classic.component!;

/** The dialog's content: the live list of what waits, and the record. Mounted only while the dialog is open. */
function ApprovalsRecord({ engine, onClose }: { engine: WindowEngine; onClose: () => void }) {
  const lock = useLockdown(engine);
  const approvals = useAsks(engine, lock.on);
  return (
    <Dialog title="Approvals" wide onClose={onClose} footer={<button type="button" className="btn pri" onClick={onClose}>Close</button>}>
      <p className="hint">Commands, plugins and Branch itself, newest first.</p>
      <AskHistory engine={engine} waiting={approvals.waiting} onAnswer={(id, reply) => void approvals.answer(id, reply)} lockdown={lock.on} />
    </Dialog>
  );
}

/** The Approvals row of the Locks and records card: advanced level, one Open button. */
export function ApprovalsRow({ engine }: { engine: WindowEngine }) {
  const [open, setOpen] = useState(false);
  const [level] = useLevel(engine);
  if (level < 1) return null;
  return (
    <section className="r1s-sec g-clear" aria-label="Approvals">
      <h2 className="g-label">Approvals</h2>
      <div className="r1s-row">
        <b className="g-label">Approvals</b>
        <small className="g-label" data-lines>Every yes and no from the last 30 days, and the standing permissions automations hold.</small>
        <div className="r1s-ctl r1s-own"><button type="button" className="btn" aria-haspopup="dialog" onClick={() => setOpen(true)}>Open</button></div>
      </div>
      {open ? <ApprovalsRecord engine={engine} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

function PermissionsPage(props: SlotPageProps): ReactNode {
  return <>
    <ClassicPermissions {...props} />
    <ApprovalsRow engine={props.engine} />
  </>;
}

export const permissionsSlot: PageSlot = { ...classic, component: PermissionsPage };
