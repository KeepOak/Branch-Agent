// Instructions & personality, the rows under the files (§4.7.5): project instructions, kits and reply style at
// Regular; at Advanced the prompts behind quick actions, saved prompts (the engine's skill library), what goes with
// every message and rules. Rows the engine has no setting for are drawn greyed with why; the preview's sample kits,
// rules, words and example conversations are not real and are not drawn.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { WindowEngine } from "../../../connect/engine";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, Hint, Sec, Seg, Switch, Val, useAsk, useLevel } from "../kit";

export const NO_KEY = "Branch has no setting for this yet.";
const none = () => undefined;

export function InstructionsMore({ engine }: { engine: WindowEngine }) {
  const lv = useLevel();
  return (
    <>
      <Sec title="Project instructions">
        <Ctl title="Project instruction files" sub="Read from the project folder." help="Read from the project folder. A file written for one model family is read only when a model of that family answers." off="Branch reads AGENTS.md or CLAUDE.md for every model; it can’t keep a file to one model family yet."><span title="AGENTS.md"><Val>House rules</Val></span></Ctl>
      </Sec>
      <Sec title="Kits" hint="Named sets of conventions, tools and voice.">
        <Ctl title="Pick a kit by what’s in the folder" sub="Languages, git and commands found in the folder choose the kit." off="Branch has no kits yet."><Switch checked label="Pick a kit by what’s in the folder" onChange={none} /></Ctl>
      </Sec>
      <Sec title="How replies are written">
        <Ctl title="Reply style" sub="Explanatory adds why; Learning leaves small parts for you to try." off={NO_KEY}>
          <Seg label="Reply style" value="Default" options={["Default", "Explanatory", "Learning", "Short"].map((x) => ({ id: x, label: x }))} onChange={none} />
        </Ctl>
      </Sec>
      {lv >= 1 ? <><SavedPrompts engine={engine} /><EveryMessage /></> : null}
    </>
  );
}


/** Saved prompts: the skills in the engine's library, by their slash name. */
function SavedPrompts({ engine }: { engine: WindowEngine }) {
  const lib = useResource<RecordValue>(engine, "skills.library.list", {});
  const entries = list(lib.data?.entries).filter((e) => e.removed !== true);
  const ask = useAsk();
  return (
    <Sec title="Saved prompts">
      {lib.loading ? <Hint>Reading your saved prompts…</Hint> : null}
      {lib.error ? <Hint>{visible(lib.error)}</Hint> : null}
      {!lib.loading && !lib.error && !entries.length ? <Hint>No saved prompts yet.</Hint> : null}
      {entries.map((e) => (
        <Ctl key={text(e.skillId)} title={`/${visible(e.slug)}`} sub={e.description ? visible(e.description) : undefined} off={e.enabled === false ? "Turned off in the library." : ask ? undefined : "Needs a model set up first."}>
          <Btn sm onClick={() => ask?.(`/${text(e.slug)}`)}>Try it</Btn>
        </Ctl>
      ))}
    </Sec>
  );
}

/** A greyed row whose fields sit under its lines (the preview's wide rows); the engine has no setting for it yet. */


/** What goes with every message: today's date and the time zone, and a short line about this computer. Both are always sent. */
function EveryMessage() {
  return (
    <Sec title="What goes with every message">
      <Hint>Branch always sends today’s date and your time zone, and a short line about this computer.</Hint>
    </Sec>
  );
}

