// Settings › Voice (DESIGN-SPEC §4.7.9): talking (listening, the push-to-talk key, the microphone), speaking back
// (the voice replies are read in, or Off) and, at Advanced and Technical, wake words, live voice, the speaking and
// listening engines, calls and meetings. Saves at once: the voice on tts.setPersona / tts.enable / tts.disable,
// wake words on voicewake.set, live voice and talk settings through config.patch (talk.*).
import type { SettingsPageProps } from "../index";
import { list, text, visible, type RecordValue } from "../adapter";
import { Ctl, Hint, Page, Sec, useLevel, useSaveRunner, type Opt, type RowEntry } from "../kit";
import { Choice, providersOf, useKept, type Kept } from "./voice-kit";
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
      <Hint>Talking by microphone, push to talk and dictation aren’t in this version of Branch yet.</Hint>
      <Sec title="Speaking back">
        <VoiceRow engine={props.engine} tts={tts} voices={voices} />
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
  ...rows("Speaking back", 0, ["Voice"]),
  ...rows("Listening, more", 1, ["Wake words", "Answer aloud", "Speech language"]),
  ...rows("Talking, more", 1, ["Talking over it stops it"]),
  ...rows("Calls and meetings", 1, ["Phone calls", "Calling from", "Test call", "Keep meeting transcripts", "Meeting notes"]),
  ...rows("Live voice, more", 1, ["Live voice", "Live voice through", "Live voice model", "Speaker voice", "Live voice through the Gateway", "Stop talking when I start", "Who answers live voice", "How it talks in live voice"]),
  ...rows("Speaking back, more", 1, ["Speaking engine", "Preview", "Voice services", "Named voices"]),
  ...rows("Live voice, technical", 2, ["How it runs", "Who does the thinking", "Final words go to", "Thinking during live voice", "Fast answers during live voice", "Voice detection", "Silence before it answers", "Sound kept before speech", "Reasoning", "Pause before sending (talk on a device)", "Connection"]),
  ...rows("Voice, technical", 2, ["Speak into a file", "Speaking status", "Check the call setup", "Call and speak", "During a call", "Follow the call log", "Answer delay", "Reach call webhooks from outside", "All voice settings"]),
  ...rows("Listening, services", 1, ["Listening engine", "A program of yours as an engine", "Turn audio and video files into documents"]),
  ...rows("Live voice, more services", 2, []),
];
