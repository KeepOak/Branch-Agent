// On this computer › Running models here, more (Advanced): the OpenAI-shaped endpoint for other apps
// (gateway.http.endpoints.chatCompletions.enabled) and its address (system.info port); the managed runtime's
// fingerprint check; the models here (models.list). Rows the engine has no setting or method for are greyed with why.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { WindowEngine } from "../../../connect/engine";
import { visible, type RecordValue } from "../adapter";
import { Btn, Ctl, Pick, Pill, Sec, Seg, Switch, Val, useConfig, useLevel } from "../kit";
import type { Hw } from "./local";

const NO_KEY = "Branch has no setting for this yet.";
const NO_RUN = "Branch can’t stop, check or clear the models on this computer yet.";
const ENDPOINT = "gateway.http.endpoints.chatCompletions.enabled";

export const MORE_TITLES = ["Fit the room to this computer", "Big downloads on a metered network", "Runtime download", "Installed models", "Bring in a model file",
  "Keep a conversation’s working memory between sessions", "Make room for pictures and video", "Teach tools to models without them", "Let other apps use Branch’s models",
  "Its address", "A rented graphics computer", "Squeeze models to fit", "On your phone"];

export function LocalMore({ engine, hw, local }: { engine: WindowEngine; hw: Hw; local: RecordValue[] }) {
  const lv = useLevel();
  const cfg = useConfig(engine);
  if (lv < 1) return null;
  const first = local[0] ? visible(local[0].name ?? local[0].id) : "";
  return (
    <Sec title="Running models here, more" group="Running models here">
      <Ctl title="Fit the room to this computer" sub="A model’s room is sized to the memory there is; using more asks first." off={NO_KEY}><Switch checked label="Fit the room to this computer" onChange={() => undefined} /></Ctl>
      <Ctl title="Big downloads on a metered network" off={NO_KEY}><Seg label="Big downloads on a metered network" value="ask" options={[{ id: "ask", label: "Ask first" }, { id: "wait", label: "Wait for an unmetered one" }, { id: "go", label: "Go ahead" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Runtime download" sub="Verify installed runtimes against published fingerprints." help="Every runtime Branch installs is checked against its published fingerprint."><Pill tone="ok">Always</Pill></Ctl>
      <Ctl title="Installed models" sub={first ? `${first}${local.length > 1 ? ` and ${local.length - 1} more` : ""} on this computer. Pick which model answers first in Defaults.` : "No model on this computer yet."} off={NO_RUN}>
        {first ? <Btn ghost sm>Stop {first}</Btn> : null}<Btn sm>Check files</Btn><Btn sm>Clear caches</Btn>
      </Ctl>
      <Ctl title="Bring in a model file" sub="A GGUF or MLX file you already have; Branch reads what it is first." off={NO_KEY}><Btn sm>Choose a file</Btn></Ctl>
      <Ctl title="Keep a conversation’s working memory between sessions" sub="Long conversations resume faster; uses disk." off={NO_KEY}><Switch checked={false} label="Keep a conversation’s working memory between sessions" onChange={() => undefined} /></Ctl>
      <Ctl title="Make room for pictures and video" sub="Pause the chat model while pictures use graphics memory." help="When making a picture needs the graphics memory, the chat model steps out first and comes back after." off={NO_KEY}><Switch checked label="Make room for pictures and video" onChange={() => undefined} /></Ctl>
      <Ctl title="Teach tools to models without them" sub="Tools are described in the message and the answer is read for them." off={NO_KEY}><Switch checked label="Teach tools to models without them" onChange={() => undefined} /></Ctl>
      <Ctl title="Let other apps use Branch’s models" sub="A local address that speaks OpenAI’s shape, for your other programs." help="A local address that speaks OpenAI’s shape, for your other programs. Off until you choose: programs on this computer could use your accounts.">
        <Switch checked={cfg.get(ENDPOINT) === true} label="Let other apps use Branch’s models" disabled={cfg.loading} onChange={(v) => void cfg.set(ENDPOINT, v)} />
      </Ctl>
      <Ctl title="Its address" sub="Needs a key from Developer › Keys for scripts and phones.">{hw.port ? <Val code>{`http://127.0.0.1:${hw.port}/v1`}</Val> : null}</Ctl>
      <Ctl title="A rented graphics computer" sub="Use a rented GPU computer for local models." help="Point Branch at a GPU computer you rent; it installs the server and starts your models there." off={NO_KEY}><Btn sm>Add one</Btn></Ctl>
      <Ctl title="Squeeze models to fit" sub="Smaller files and memory, a little less sharp." off={NO_KEY}><Pick label="Squeeze models to fit" value="as" options={[{ id: "as", label: "As downloaded" }, { id: "8", label: "8-bit" }, { id: "4", label: "4-bit" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="On your phone" sub="Small models that run on the phone itself." off="This opens in the Branch app on your phone."><Btn sm>Open on the phone</Btn></Ctl>
    </Sec>
  );
}
