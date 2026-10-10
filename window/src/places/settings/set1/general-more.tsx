// Settings › General, Writing: the rows with a real setting (Show "Finish setting up") and Open Branch on.
import type { WindowEngine } from "../../../connect/engine";
import { platformName } from "../../../setup/steps-later";
import { Ctl, Pick, Sec, Switch, useSaveRunner } from "../kit";
import { useLook } from "./appearance-store";

/** The computer's own name for itself, as setup's Start-with row uses it. */
export const OS = platformName;
export const NO_KEY = "Branch has no setting for this yet.";
const noop = () => undefined;

const LANDING = ["The last conversation", "Overview", "Canopy", "Inbox", "Automations"].map((l) => ({ id: l, label: l }));

/** Overview's "Finish setting up" checklist: the person's own choice, kept in their look ("checklist"). */
function FinishSetupRow({ engine }: { engine: WindowEngine }) {
  const look = useLook(engine);
  const save = useSaveRunner();
  const on = look.val("checklist", true) !== false;
  return (
    <Ctl title="Show “Finish setting up”" sub="The checklist on Overview until every step is done.">
      <Switch checked={on} label="Show “Finish setting up”" onChange={(v) => void save(() => look.store.set("checklist", v ? null : false))} />
    </Ctl>
  );
}

export function Writing({ engine }: { engine: WindowEngine }) {
  return (
    <Sec title="Writing">
      <Ctl title="Open Branch on" sub="What you see first when Branch opens." off={NO_KEY}><Pick label="Open Branch on" value="The last conversation" options={LANDING} onChange={noop} /></Ctl>
      <FinishSetupRow engine={engine} />
    </Sec>
  );
}
