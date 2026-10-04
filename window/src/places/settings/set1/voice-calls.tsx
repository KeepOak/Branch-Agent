// Voice › Calls and meetings (Advanced). Phone calls are the voice-call plugin (plugins.entries.voice-call: enabled,
// config.fromNumber; a test call is voicecall.initiate); meeting notes are the meeting plugins plus transcripts.*
// (enabled, autoStart). Everything the engine has no setting for is greyed with why.
import { useState } from "react";
import { Dialog } from "../../../shell/Dialog";
import { list, text, visible } from "../adapter";
import { Btn, Ctl, Field, Sec, Switch, useSaveRunner } from "../kit";
import { APP, Greyed, NO_KEY } from "./voice-kit";
import type { Shared } from "./voice-more";

const CALL = "plugins.entries.voice-call";
const MEETINGS = ["google-meet", "teams-meetings", "zoom-meetings"];

export function CallsAndMeetings(props: Shared) {
  const { cfg } = props;
  const calls = cfg.get(`${CALL}.enabled`) === true;
  return (
    <Sec title="Calls and meetings" hint="Phone calls go through your own Twilio number; meeting notes use your connected calendar.">
      <Ctl title="Phone calls" sub="Call you, or call someone for you. Off until you choose: calls cost money by the minute and reach people outside Branch.">
        <Switch checked={calls} label="Phone calls" disabled={cfg.loading} onChange={(on) => void cfg.set(`${CALL}.enabled`, on)} />
      </Ctl>
      <CallingFrom cfg={cfg} />
      <Greyed why={NO_KEY} rows={[
        { t: "Who it may call", sub: "Numbers you approve once, or anyone you name in a message.", c: { seg: ["People I approve", "Anyone I name"], v: "Anyone I name" } },
        { t: "Recording", sub: "It always says first that it’s an AI assistant calling for you.", c: { seg: ["Only if they agree", "Never"], v: "Only if they agree" } },
      ]} />
      <TestCall {...props} on={calls} />
      <Greyed why="Branch lists only calls in progress yet." rows={[{ t: "Calls", sub: "Every call: who, when, how long and how it ended.", c: { btn: "See" } }]} />
      <Meetings {...props} />
    </Sec>
  );
}

/** Calling from: plugins.entries.voice-call.config.fromNumber, set in a small dialog behind Set up. */
function CallingFrom({ cfg }: { cfg: Shared["cfg"] }) {
  const [open, setOpen] = useState(false);
  const path = `${CALL}.config.fromNumber`;
  const number = text(cfg.get(path) ?? "");
  return (
    <Ctl title="Calling from" sub={number ? `${visible(number)}. Its key is in the locker.` : "Your Twilio number. Its key is in the locker."}>
      <Btn sm disabled={cfg.loading} onClick={() => setOpen(true)}>{number ? "Change" : "Set up"}</Btn>
      {open ? (
        <Dialog title="Calling from" onClose={() => setOpen(false)} footer={<button type="button" className="btn pri" onClick={() => setOpen(false)}>Done</button>}>
          <p className="hint">The Twilio number calls come from. Its key is in the locker.</p>
          <Field wide label="Calling from" value={number} placeholder="Your number" onCommit={(v) => void cfg.set(path, v.trim() || null)} />
        </Dialog>
      ) : null}
    </Ctl>
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
  const places = list(cfg.get("transcripts.autoStart"));
  const setNotes = (on: boolean) => void cfg.set("plugins.entries", Object.fromEntries(MEETINGS.map((id) => [id, { enabled: on }])));
  return (
    <>
      <Ctl title="Keep meeting transcripts" sub="Lets a Trunk save what’s said in a meeting. It records nothing by itself: “Meeting notes” and the places below decide when.">
        <Switch checked={keep} label="Keep meeting transcripts" disabled={cfg.loading} onChange={(on) => void cfg.set("transcripts.enabled", on)} />
      </Ctl>
      <Ctl title="Meeting notes" sub="A Trunk joins Meet, Teams or Zoom as a guest and brings the notes back.">
        <Switch checked={notes} label="Meeting notes" disabled={cfg.loading} onChange={setNotes} />
      </Ctl>
      <Greyed why="Branch can’t add a place from here yet." rows={[{
        t: "Start notes by itself in", c: { btn: "Add a place" },
        sub: places.length ? places.map((p) => visible(p.title ?? p.channelId ?? p.providerId)).join(" · ") : "Empty until you add a place. A Trunk then keeps notes there by itself.",
      }]} />
      <Greyed why={NO_KEY} rows={[
        { t: "Meeting notes now", sub: keep ? "Saving is on." : "Saving is off.", c: { btn: "Check again", ghost: true } },
        { t: "Join from your calendar", sub: "It never joins a meeting by itself unless you pick the second.", c: { seg: ["Only when I ask", "Meetings I’m invited to"], v: "Only when I ask" } },
        { t: "Send notes afterwards", sub: "Sending to other people asks you first.", c: { seg: ["To me", "To everyone there"], v: "To me" } },
      ]} />
    </>
  );
}

export function CallsMore() {
  return (
    <Sec title="Calls and meetings, more">
      <Greyed why={NO_KEY} rows={[
        { t: "Recognise who is speaking", sub: "Voices are told apart and remembered; say “that was Jill” to name one.", c: { sw: false } },
        { t: "Split recordings by speaker", sub: "On this computer, as it records.", c: { sw: true }, why: APP },
        { t: "Notes from any call, without joining", sub: "Records this computer’s sound and your microphone during a call you’re in. Off until you choose: it records your calls.", c: { sw: false }, why: APP },
        { t: "Record and transcribe", sub: "Start a recording on this computer; it becomes a transcript in Meetings.", c: { btn: "Start recording" }, why: APP },
        { t: "Answer questions it hears", sub: "While transcribing, it answers when someone asks something worth answering. Off until you choose: it speaks up in your calls.", c: { sw: false } },
        { t: "Sum up each call", sub: "Who, what was decided and how it ended, for every call.", c: { sw: true } },
        { t: "Call numbers", sub: "Talk-over and silence measured on recorded calls.", c: { btn: "See" } },
        { t: "Press keypad tones on phone menus", sub: "When it reaches a recorded menu, it listens and presses the right number.", c: { sw: true } },
        { t: "Call a list of people", sub: "One call each, from a list, with retries and a cap on calls at once.", c: { btn: "Choose a list" } },
        { t: "Practice calls", sub: "Run a voice Trunk against made-up callers and check what it said.", c: { btn: "Run" } },
        { t: "FaceTime", sub: "Answers FaceTime from people you pick, and calls you after a yes.", c: { btn: "Set up" }, why: APP },
        { t: "A face on live voice", sub: "A moving face for spoken replies. Off until you choose: a service draws it.", c: { pick: ["The Trunk’s own face", "A video avatar service"] } },
        { t: "Smart glasses", sub: "Even Realities G1: replies on the lenses, notes and notifications.", c: { btn: "Pair" }, why: APP },
        { t: "Make a podcast from a document", sub: "Two voices talk it through.", c: { btn: "Choose a document" } },
        { t: "Narrate a screen recording", sub: "Spoken notes from timed comments.", c: { btn: "Choose a recording" } },
        { t: "Make a voice of your own", sub: "Train a voice on your recordings, on this computer.", c: { btn: "Start" }, why: APP },
      ]} />
    </Sec>
  );
}
