// Settings › General, the rows Branch has no setting for yet (§4.7.1): Writing, Clipboard history, Cover the screen,
// Controllers and This PC. Each is drawn as the preview draws it, greyed, with the reason on its own line.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { WindowEngine } from "../../../connect/engine";
import { Btn, Ctl, Hint, Pick, Sec, Seg, Switch, useLevel, useSaveRunner } from "../kit";
import { useLook } from "./appearance-store";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** The computer's own name for itself, as the preview words its rows. */
export const OS = MAC ? "macOS" : "Windows";
export const NO_KEY = "Branch has no setting for this yet.";
const noop = () => undefined;

const LANGS = ["Same as my message", "English", "Español", "Français", "Deutsch", "Português", "Yorùbá", "العربية", "日本語", "中文"].map((l) => ({ id: l, label: l }));
const LANDING = ["The last conversation", "Overview", "Canopy", "Inbox", "Automations"].map((l) => ({ id: l, label: l }));
const AFTER_PLAN = ["Ask to carry it out", "In a fresh conversation", "Don’t ask"].map((l) => ({ id: l, label: l }));

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
  const lv = useLevel();
  return (
    <Sec title="Writing">
      <Ctl title="Message box grows with the text" sub="Off keeps it one size; drag its top edge to change it." off={NO_KEY}><Switch checked label="Message box grows with the text" onChange={noop} /></Ctl>
      <Ctl title="Check spelling in the message box" sub="Uses this computer’s own spell checker." off={NO_KEY}><Switch checked label="Check spelling in the message box" onChange={noop} /></Ctl>
      <Ctl title="Suggest the rest as I type" sub="Grey text you take with Tab. Off until you choose: each suggestion is a model call." off={NO_KEY}><Switch checked={false} label="Suggest the rest as I type" onChange={noop} /></Ctl>
      {lv >= 1 ? <Ctl title="Write long messages in your own editor" sub="Ctrl G opens the draft there and brings it back when you close it. Empty uses $EDITOR." off={NO_KEY}><input className="inp" placeholder={MAC ? "code --wait" : "notepad"} aria-label="Editor" /></Ctl> : null}
      <Ctl title="Add my location to messages" sub="Your town, so “near me” works. Off until you choose: it shares where you are." off={NO_KEY}><Switch checked={false} label="Add my location to messages" onChange={noop} /></Ctl>
      <Ctl title="Replies in" sub="Separate from the window’s language." off={NO_KEY}><Pick label="Replies in" value="Same as my message" options={LANGS} onChange={noop} /></Ctl>
      <Ctl title="After a plan" sub="When a Trunk finishes planning, “Carry out this plan?”" off={NO_KEY}><Seg label="After a plan" value="Ask to carry it out" options={AFTER_PLAN} onChange={noop} /></Ctl>
      {lv >= 1 ? <Ctl title="Rounds before it checks in" sub="Empty means no limit; a number makes it stop and ask after that many rounds." off={NO_KEY}><input className="inp" placeholder="No limit" aria-label="Rounds before it checks in" /></Ctl> : null}
      <Ctl title="Open Branch on" sub="What you see first when Branch opens." off={NO_KEY}><Pick label="Open Branch on" value="The last conversation" options={LANDING} onChange={noop} /></Ctl>
      <FinishSetupRow engine={engine} />
    </Sec>
  );
}

export function ClipboardHistory() {
  return (
    <Sec title="Clipboard history">
      <Hint>What you copied inside Branch: replies, code and terminal text. Kept in memory only unless you choose.</Hint>
      <Ctl title="Keep after restart" sub="Off until you choose: copied text would be written to disk." off={NO_KEY}><Switch checked={false} label="Keep after restart" onChange={noop} /></Ctl>
    </Sec>
  );
}

export function CoverScreen() {
  return (
    <Sec title="Cover the screen">
      <Ctl title="Cover now" sub="Covers every display and blocks input without sleeping, so Trunks, builds and remote sessions keep going. Any key or click brings it back." off="The window can’t cover every display yet.">
        <kbd className="key-k">{MAC ? "⌘ ⌥ L" : "Ctrl Alt L"}</kbd><Btn sm>Cover</Btn>
      </Ctl>
    </Sec>
  );
}

export function Controllers() {
  return (
    <Sec title="Controllers">
      <Ctl title="Use a gamepad or macro pad" sub="Buttons answer and steer Trunks; a keypad’s lights show who needs you." off={NO_KEY}><Switch checked={false} label="Use a gamepad or macro pad" onChange={noop} /></Ctl>
    </Sec>
  );
}

const QUICK_OFF = "The window can’t open a box over other apps yet.";
export function ThisComputer() {
  return (
    <Sec title="This computer">
      <Ctl title="Quick ask from anywhere" sub="A small box over any app." off={QUICK_OFF}><Switch checked label="Quick ask from anywhere" onChange={noop} /></Ctl>
      <Ctl title="Quick ask shortcut" sub="Escape keeps the old keys." off={QUICK_OFF}><kbd className="key-k">{MAC ? "⌥ Space" : "Ctrl Shift Space"}</kbd><Btn sm>Change…</Btn></Ctl>
    </Sec>
  );
}
