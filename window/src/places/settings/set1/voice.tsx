// Settings › Voice (DESIGN-SPEC §4.7.9): talking (listening, the push-to-talk key, the microphone), speaking back
// (the voice replies are read in, or Off) and, at Advanced and Technical, wake words, live voice, the speaking and
// listening engines, calls and meetings. Saves at once: the voice on tts.setPersona / tts.enable / tts.disable,
// wake words on voicewake.set, live voice and talk settings through config.patch (talk.*).
import type { SettingsPageProps } from "../index";
import { list, text, visible, type RecordValue } from "../adapter";
import { Ctl, Page, Sec, useLevel, useSaveRunner, type Opt, type RowEntry } from "../kit";
import { APP, Choice, Greyed, providersOf, useKept, type Kept } from "./voice-kit";
import { VoiceAdvanced } from "./voice-more";
import { platformName } from "../../../setup/steps-later";
import "./voice.css";

/** The first wake word, quoted, for the sub-lines (the engine's own list; never a made-up phrase). */
export function wakeWordOf(wake: RecordValue | undefined): string {
  const first = list(wake?.triggers).length ? String((wake?.triggers as unknown[])[0]) : "";
  return first ? `“${visible(first)}”` : "the wake word";
}

export function VoicePage(props: SettingsPageProps) {
  const lv = useLevel();
  const platform = platformName();
  const tts = useKept<RecordValue>(props.engine, "tts.status", {});
  const voices = useKept<RecordValue>(props.engine, "tts.providers", {});
  const wake = useKept<RecordValue>(props.engine, "voicewake.get", {});
  const word = wakeWordOf(wake.data);
  return (
    <Page title={props.title} lede="Talking to Branch." help="Talking to Branch. Voice stays on this computer unless a voice service is connected.">
      <Sec title="Talking">
        <Greyed why={APP} rows={[
          { t: "Listening", sub: `Push to talk holds the key; wake word listens for ${word}.`, c: { seg: ["Off", "Push to talk", "Wake word"], v: "Off" } },
          { t: "Push-to-talk key", sub: platform === "macOS" ? "Hold it anywhere on this Mac." : platform === "Windows" ? "Hold it anywhere in Windows." : "Hold it anywhere on this computer.", c: { btn: "Change" } },
          { t: "Microphone", sub: "Used for dictation, push to talk, the wake word and live voice. A change applies to the next dictation or call.", c: { pick: ["System default"], extra: "Refresh" } },
          { t: "Test the microphone", sub: "Watch the level as you speak, and try the wake word.", c: { btn: "Test" } },
        ]} />
      </Sec>
      <Sec title="Speaking back">
        <VoiceRow engine={props.engine} tts={tts} voices={voices} />
        <Greyed why={APP} rows={[{ t: "Dictation in the message box", sub: "The microphone button turns speech into text.", c: { sw: false } }]} />
      </Sec>
      {lv >= 1 ? <VoiceAdvanced {...props} tts={tts} voices={voices} wake={wake} word={word} /> : null}
    </Page>
  );
}

type VoiceProps = { engine: SettingsPageProps["engine"]; tts: Kept<RecordValue>; voices: Kept<RecordValue> };
const NO_PICK = "Branch picks a reply voice only through a named voice yet.";

/** Voice: the engine's named voices (personas) and Off; with none, the speaking engine's own voices. */
function VoiceRow({ engine, tts, voices }: VoiceProps) {
  const save = useSaveRunner();
  const on = tts.data?.enabled === true;
  const personas = list(tts.data?.personas);
  const active = providersOf(voices.data?.providers).find((p) => p.id === text(voices.data?.active));
  const options: Opt[] = personas.length
    ? personas.map((p) => ({ id: text(p.id), label: visible(p.label ?? p.id) }))
    : [{ id: "", label: "Engine default" }, ...(active?.voices ?? []).map((v) => ({ id: `voice:${v}`, label: visible(v), off: NO_PICK }))];
  const persona = typeof tts.data?.persona === "string" ? tts.data.persona : "";
  const value = !on ? "off" : personas.length ? persona : "";
  const pick = (id: string) => void save(async () => {
    if (id === "off") await engine.request("tts.disable", {});
    else {
      if (personas.length) await engine.request("tts.setPersona", { persona: id });
      if (!on) await engine.request("tts.enable", {});
    }
    await tts.reload();
  });
  return (
    <Ctl title="Voice" sub={tts.error ? visible(tts.error) : "Read replies out loud in this voice."}>
      <Choice label="Voice" value={value} options={[...options, { id: "off", label: "Off" }]} disabled={!tts.data} onChange={pick} />
    </Ctl>
  );
}

const rows = (sec: string, lv: 0 | 1 | 2, titles: string[]): RowEntry[] => titles.map((title) => ({ page: "voice", title, sec, group: sec.replace(/, (more|technical|in depth)$/, ""), lv }));
export const VOICE_ROWS: RowEntry[] = [
  ...rows("Talking", 0, ["Listening", "Push-to-talk key", "Microphone", "Test the microphone"]),
  ...rows("Speaking back", 0, ["Voice", "Dictation in the message box"]),
  ...rows("Hearing, more", 1, ["Microphone level"]),
  ...rows("Listening, more", 1, ["Wake word", "Wake words", "The wake word starts live voice", "Stop listening after silence", "Answer aloud", "Spoken morning brief", "Speech language", "Also understand", "Speech model", "Test voice input", "Chime when listening starts and stops"]),
  ...rows("Talking, more", 1, ["Answer approvals by voice", "Talking over it stops it", "Hold the microphone to dictate"]),
  ...rows("Calls and meetings", 1, ["Phone calls", "Calling from", "Who it may call", "Recording", "Test call", "Calls", "Keep meeting transcripts", "Meeting notes", "Start notes by itself in", "Meeting notes now", "Join from your calendar", "Send notes afterwards"]),
  ...rows("Live voice, more", 1, ["Live voice", "Live voice through", "Live voice model", "Speaker voice", "Live voice through the Gateway", "Stop talking when I start", "Who answers live voice", "How it talks in live voice", "Shift stops it talking", "Sounds as it listens and answers", "Wake sound", "Sent sound", "Camera"]),
  ...rows("Speaking back, more", 1, ["Speaking engine", "Preview", "Voice services", "Named voices", "Read in full up to", "Shorten longer replies first"]),
  ...rows("What Trunks may use", 1, ["Trunks may listen through the microphone", "Trunks may speak on this computer’s speakers"]),
  ...rows("Live voice, technical", 2, ["How it runs", "Who does the thinking", "Final words go to", "Thinking during live voice", "Fast answers during live voice", "Voice detection", "Silence before it answers", "Sound kept before speech", "Reasoning", "Pause before sending (talk on a device)", "Connection"]),
  ...rows("Voice, technical", 2, ["Speak into a file", "Speaking status", "Voice nicknames", "Audio format", "Check the call setup", "Call and speak", "During a call", "Follow the call log", "Answer delay", "Reach call webhooks from outside", "All voice settings"]),
  ...rows("Listening, services", 1, ["Listening engine", "A program of yours as an engine", "Try again when a service hiccups", "Use the chat app’s own transcript first", "Turn audio and video files into documents"]),
  ...rows("A spoken turn", 1, ["Set up voice", "Keep voice ready", "Speak while the answer is written", "Remember spoken lines", "Trunks may change their voice in a reply", "Send dictation by itself", "Countdown", "Wait while I’m mid-thought", "Ignore its own voice", "Stop phrases", "Start answering while I finish", "Talk to a Trunk by name", "Act on each part as I say it", "Clean up background noise", "Lower other sound while we talk", "Tell a real interruption from a cough", "While it thinks", "Say how background tasks are going", "Hand slow work to a Trunk and keep talking", "Every spoken turn ends with speech", "Risky actions asked by voice need a spoken yes", "Quick spoken commands", "Notice how I sound", "Dictate into any app", "Dictate-anywhere key"]),
  ...rows("Calls and meetings, more", 1, ["Recognise who is speaking", "Split recordings by speaker", "Notes from any call, without joining", "Record and transcribe", "Answer questions it hears", "Sum up each call", "Call numbers", "Press keypad tones on phone menus", "Call a list of people", "Practice calls", "FaceTime", "A face on live voice", "Smart glasses", "Make a podcast from a document", "Narrate a screen recording", "Make a voice of your own"]),
  ...rows("Live voice, more services", 2, ["Live voice with a ChatGPT account"]),
];
