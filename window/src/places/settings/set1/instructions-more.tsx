// Instructions & personality, the rows under the files (§4.7.5): project instructions, kits and reply style at
// Regular; at Advanced the prompts behind quick actions, saved prompts (the engine's skill library), what goes with
// every message and rules. Rows the engine has no setting for are drawn greyed with why; the preview's sample kits,
// rules, words and example conversations are not real and are not drawn.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, Hint, Pick, Sec, Seg, Switch, Val, useAsk, useLevel } from "../kit";

export const NO_KEY = "Branch has no setting for this yet.";
const none = () => undefined;

export function InstructionsMore({ engine }: { engine: WindowEngine }) {
  const lv = useLevel();
  return (
    <>
      <Sec title="Project instructions">
        <Ctl title="Project instruction files" sub="Read from the project folder. A file written for one model family is read only when a model of that family answers." off="Branch reads AGENTS.md or CLAUDE.md for every model; it can’t keep a file to one model family yet."><Val code>AGENTS.md</Val></Ctl>
        <Ctl title="Trunks may write rule files" sub="A Trunk can add a rule to the project’s rules folder; you see each one." off={NO_KEY}><Switch checked label="Trunks may write rule files" onChange={none} /></Ctl>
        <Ctl title="Built-in prompts" sub="The prompts Branch uses for tidying up, naming and more." off={NO_KEY}><Btn sm>See and change</Btn></Ctl>
      </Sec>
      <Sec title="Kits" hint="Named sets of conventions, tools and voice.">
        <Ctl title="Pick a kit by what’s in the folder" sub="Languages, git and commands found in the folder choose the kit." off="Branch has no kits yet."><Switch checked label="Pick a kit by what’s in the folder" onChange={none} /></Ctl>
      </Sec>
      <Sec title="How replies are written">
        <Ctl title="Reply style" sub="Explanatory adds why; Learning leaves small parts for you to try." off={NO_KEY}>
          <Seg label="Reply style" value="Default" options={["Default", "Explanatory", "Learning", "Short"].map((x) => ({ id: x, label: x }))} onChange={none} />
        </Ctl>
      </Sec>
      {lv >= 1 ? <><QuickPrompts /><SavedPrompts engine={engine} /><EveryMessage /><Rules /></> : null}
    </>
  );
}

/** Branch's own wording for the quick actions (preview 96-appopsp), shown as what each one asks. */
const QUICK: [string, string][] = [
  ["Rewrite", "Rewrite this so it is clearer. Keep the meaning and the facts."],
  ["Shorten", "Make this shorter. Keep every fact and number."],
  ["Explain", "Explain this in plain words for someone new to it."],
  ["Make it formal", "Make this formal and polite, ready to send."],
];
function QuickPrompts() {
  return (
    <Sec title="Prompts behind quick actions">
      {QUICK.map(([k, v]) => <Ctl key={k} title={k} sub={v} off={NO_KEY}><Btn ghost sm>Edit</Btn></Ctl>)}
    </Sec>
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
function Under({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return <Ctl title={title} sub={sub} off={NO_KEY} after={<div className="if-under" inert>{children}</div>} />;
}

const LANGS = ["The language you write in", "English", "Polski", "Español", "Français", "Deutsch", "日本語", "中文"];
const VOICES = ["As SOUL.md says", "Helpful", "Brief", "Teacher", "Creative", "Technical", "Playful"];
const opts = (xs: string[]) => xs.map((x) => ({ id: x, label: x }));

/** What goes with every message: the date and this computer's line are always sent; the rest has no setting yet. */
function EveryMessage() {
  return (
    <Sec title="What goes with every message">
      <Under title="Keep in mind" sub="A line or two it reads before every reply."><textarea className="inp if-mind" rows={1} placeholder="For example: I’m travelling until Friday; keep answers short." aria-label="Keep in mind" /></Under>
      <Under title="Words filled in for you" sub="Write {{name}} in an instruction or saved prompt and it’s filled in each time.">
        <input className="inp" placeholder="word" aria-label="New word" /><input className="inp" placeholder="What it stands for" aria-label="What it stands for" /><Btn sm>Add</Btn>
      </Under>
      <Ctl title="Today’s date and time" sub="So “tomorrow” and “last week” mean what you mean.">
        <span title="Branch always sends today’s date and your time zone."><Switch checked disabled label="Today’s date and time" onChange={none} /></span>
      </Ctl>
      <Ctl title="This computer’s details" sub="The folder, shell, system and git status, so commands fit this computer.">
        <Seg label="This computer’s details" value="short" onChange={none} options={[{ id: "off", label: "Off", off: "Branch always sends a short line about this computer." }, { id: "short", label: "Short" }, { id: "full", label: "Full", off: NO_KEY }]} />
      </Ctl>
      <Ctl title="What your editor has open" sub="The open file and what’s on screen, when an editor is connected." off={NO_KEY}><Switch checked label="What your editor has open" onChange={none} /></Ctl>
      <Ctl title="Instructions in folders it opens" sub="Reads AGENTS.md and similar files in a folder the first time it works there." off={NO_KEY}><Switch checked label="Instructions in folders it opens" onChange={none} /></Ctl>
      <Ctl title="Reply in" sub="The language you write in, unless you pick one." off={NO_KEY}><Pick label="Reply in" value={LANGS[0]} options={opts(LANGS)} onChange={none} /></Ctl>
      <Ctl title="Personality" sub="A ready-made voice on top of SOUL.md. As SOUL.md says leaves it to your file." off={NO_KEY}><Pick label="Personality" value={VOICES[0]} options={opts(VOICES)} onChange={none} /></Ctl>
      <Under title="Example conversations" sub="Short examples of how you like answers. They go before the conversation.">
        <input className="inp" placeholder="You ask…" aria-label="Example question" /><input className="inp" placeholder="It replies…" aria-label="Example reply" /><Btn sm>Add</Btn>
      </Under>
    </Sec>
  );
}

function Rules() {
  return (
    <Sec title="Rules" hint="Rule files a Trunk reads when they apply: always, when certain files are open, when a message mentions something, or when it asks.">
      <Under title="Extra instruction files" sub="A file, a folder pattern or a web address read at the start, on top of the files above.">
        <input className="inp" placeholder="~/notes/house-style.md or docs/*.md" aria-label="Extra instruction file" /><Btn sm>Add</Btn>
      </Under>
      <Ctl title="Rules for conversations outside a project" sub="Made the first time you chat outside a project." off={NO_KEY}><Btn sm>Edit</Btn></Ctl>
      <Ctl title="From your organisation" sub="Rules, steps and skills your organisation sends appear here, read only." off="Branch has no organisation settings service yet."><Btn ghost sm>Check now</Btn></Ctl>
    </Sec>
  );
}
