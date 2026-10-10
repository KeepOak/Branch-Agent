// Voice › Calls and meetings (Advanced). Phone calls are the voice-call plugin (plugins.entries.voice-call: enabled,
// config.fromNumber; a test call is voicecall.initiate); meeting notes are the meeting plugins plus transcripts.*
// (enabled, autoStart). Everything the engine has no setting for is greyed with why.
import { text } from "../adapter";
import { Btn, Ctl, Field, Sec, Switch, useSaveRunner } from "../kit";
import type { Shared } from "./voice-more";

const CALL = "plugins.entries.voice-call";
const MEETINGS = ["google-meet", "teams-meetings", "zoom-meetings"];

export function CallsAndMeetings(props: Shared) {
  const { cfg } = props;
  const calls = cfg.get(`${CALL}.enabled`) === true;
  return (
    <Sec title="Calls and meetings" hint="Calls use your Twilio number; notes use your calendar." help="Phone calls go through your own Twilio number; meeting notes use your connected calendar.">
      <Ctl title="Phone calls" sub="Call you, or call someone for you." help="Call you, or call someone for you. Off until you choose: calls cost money by the minute and reach people outside Branch.">
        <Switch checked={calls} label="Phone calls" disabled={cfg.loading} onChange={(on) => void cfg.set(`${CALL}.enabled`, on)} />
      </Ctl>
      <Ctl title="Calling from" sub="Your Twilio number. Its key is in the locker.">
        <Field label="Calling from" value={text(cfg.get(`${CALL}.config.fromNumber`) ?? "")} placeholder="Your number" disabled={cfg.loading} onCommit={(v) => void cfg.set(`${CALL}.config.fromNumber`, v.trim() || null)} />
      </Ctl>
      <TestCall {...props} on={calls} />
      <Meetings {...props} />
    </Sec>
  );
}

function TestCall({ engine, on }: Shared & { on: boolean }) {
  const save = useSaveRunner();
  const call = () => void save(() => engine.request("voicecall.initiate", { message: "This is a test call from Branch.", mode: "notify" }));
  return (
    <Ctl title="Test call" sub={`Rings your own number with a short message, so you know calls work.${on ? "" : " Turn on Phone calls first."}`}>
      <Btn sm disabled={!on} onClick={call}>Call me</Btn>
    </Ctl>
  );
}

function Meetings({ cfg }: Shared) {
  const keep = cfg.get("transcripts.enabled") !== false;
  const notes = MEETINGS.every((id) => cfg.get(`plugins.entries.${id}.enabled`) !== false);
  const setNotes = (on: boolean) => void cfg.set("plugins.entries", Object.fromEntries(MEETINGS.map((id) => [id, { enabled: on }])));
  return (
    <>
      <Ctl title="Keep meeting transcripts" sub="Lets a Trunk save what’s said in a meeting." help="Lets a Trunk save what’s said in a meeting. It records nothing by itself: “Meeting notes” and the places below decide when.">
        <Switch checked={keep} label="Keep meeting transcripts" disabled={cfg.loading} onChange={(on) => void cfg.set("transcripts.enabled", on)} />
      </Ctl>
      <Ctl title="Meeting notes" sub="A Trunk joins meetings as a guest and brings back notes." help="A Trunk joins Meet, Teams or Zoom as a guest and brings the notes back.">
        <Switch checked={notes} label="Meeting notes" disabled={cfg.loading} onChange={setNotes} />
      </Ctl>
    </>
  );
}
