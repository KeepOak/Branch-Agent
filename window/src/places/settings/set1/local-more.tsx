// On this computer › Running models here, more (Advanced): the endpoint for other apps
// (gateway.http.endpoints.chatCompletions.enabled), its address (system.info port) and the runtime download check.
// Rows the engine has no setting for are not shown until it does.
import type { WindowEngine } from "../../../connect/engine";
import { visible, type RecordValue } from "../adapter";
import { Ctl, Pill, Sec, Switch, Val, useConfig, useLevel } from "../kit";
import type { Hw } from "./local";

const ENDPOINT = "gateway.http.endpoints.chatCompletions.enabled";

export const MORE_TITLES = ["Runtime download", "Installed models", "Let other apps use Branch’s models", "Its address"];

export function LocalMore({ engine, hw, local }: { engine: WindowEngine; hw: Hw; local: RecordValue[] }) {
  const lv = useLevel();
  const cfg = useConfig(engine);
  if (lv < 1) return null;
  const first = local[0] ? visible(local[0].name ?? local[0].id) : "";
  return (
    <Sec title="Running models here, more" group="Running models here">
      <Ctl title="Runtime download" sub="Verify installed runtimes against published fingerprints." help="Every runtime Branch installs is checked against its published fingerprint."><Pill tone="ok">Always</Pill></Ctl>
      <Ctl title="Installed models" sub={first ? `${first}${local.length > 1 ? ` and ${local.length - 1} more` : ""} on this computer. Pick which model answers first in Defaults.` : "No model on this computer yet."} />
      <Ctl title="Let other apps use Branch’s models" sub="A local address your other programs on this computer can use." help="A local address your other programs on this computer can use. Off until you choose: programs on this computer could use your accounts.">
        <Switch checked={cfg.get(ENDPOINT) === true} label="Let other apps use Branch’s models" disabled={cfg.loading} onChange={(v) => void cfg.set(ENDPOINT, v)} />
      </Ctl>
      <Ctl title="Its address" sub="Needs a key from Developer › Keys for scripts and phones.">{hw.port ? <Val code>{`http://127.0.0.1:${hw.port}/v1`}</Val> : null}</Ctl>
    </Sec>
  );
}
