// Voice › Hearing, Listening and Talking, more (Advanced). Wake words on voicewake.get/set; Answer aloud on
// tts.status's auto mode (tts.enable / tts.disable); speech language on talk.speechLocale; talking over it on
// talk.interruptOnSpeech. Microphone, wake-word listening and dictation run in the desktop app, so they are greyed.
import { useEffect, useState } from "react";
import { visible } from "../adapter";
import { Ctl, Pick, Sec, Switch, useSaveRunner, type Opt } from "../kit";
import { APP, Choice, Greyed, NO_KEY, isMac } from "./voice-kit";
import type { Cfg, Shared } from "./voice-more";

export function HearingMore() {
  return (
    <Sec title="Hearing, more">
      <Greyed why={APP} rows={[{ t: "Microphone level", sub: "Level, the point where it starts listening, and the pitch it hears.", c: { btn: "Test" } }]} />
    </Sec>
  );
}

export function ListeningMore(props: Shared) {
  return (
    <Sec title="Listening, more">
      <Greyed why={APP} rows={[{ t: "Wake word", sub: `${props.word}, heard on this computer only. Off until you choose: it keeps the microphone open.`, c: { sw: false } }]} />
      <WakeWords {...props} />
      <Greyed why={APP} rows={[
        { t: "The wake word starts live voice", sub: "Saying a wake word opens live voice with the default Trunk. Off: the wake word starts dictation into the message box. Off until you choose: the call keeps the microphone open until you end it.", c: { sw: false } },
        { t: "Stop listening after silence", sub: "For live dictation.", c: { field: isMac() ? "0.7" : "2.5", unit: "s" } },
      ]} />
      <AnswerAloud {...props} />
      <Greyed why={NO_KEY} rows={[{ t: "Spoken morning brief", sub: "The written brief, read out at 7:30 on the speaker you choose.", c: { sw: true } }]} />
      <SpeechLanguage cfg={props.cfg} />
      <Greyed why={NO_KEY} rows={[{ t: "Also understand", sub: "None added.", c: { pick: ["Add a language…"] } }]} />
      <Greyed why={APP} rows={[
        { t: "Speech model", sub: "Turns your voice into text on this computer. Bigger understands more and takes more disk and memory.", c: { seg: ["Tiny", "Base", "Small"], v: "Base" } },
        { t: "Test voice input", sub: "Say something, and see the words it heard.", c: { btn: "Try it" } },
        { t: "Chime when listening starts and stops", sub: "A short sound when push to talk, the wake word or dictation starts and stops listening.", c: { sw: true } },
      ]} />
    </Sec>
  );
}

/** The engine keeps at most 32 wake words of 64 characters each; an empty list goes back to its own words. */
export function wakeProblem(lines: string[]): string {
  if (lines.length > 32) return "Couldn’t save the wake words: more than 32 words.";
  if (lines.some((l) => l.length > 64)) return "Couldn’t save the wake words: a word is longer than 64 characters.";
  return "";
}

function WakeWords({ engine, wake }: Shared) {
  const save = useSaveRunner();
  const saved = Array.isArray(wake.data?.triggers) ? (wake.data.triggers as unknown[]).map(String).join("\n") : "";
  const [draft, setDraft] = useState(saved);
  const [err, setErr] = useState("");
  useEffect(() => setDraft(saved), [saved]);
  const commit = () => {
    const lines = draft.split("\n").map((s) => s.trim()).filter(Boolean);
    const bad = wakeProblem(lines);
    setErr(bad);
    if (bad || lines.join("\n") === saved) return;
    void save(async () => { await engine.request("voicewake.set", { triggers: lines }); await wake.reload(); });
  };
  return (
    <Ctl stack title="Wake words" sub="Saying one of these starts listening. One per line, up to 32, each up to 64 characters. Shared by every computer and phone on this Branch. Clear the list to go back to the standard words."
      after={err ? <small className="bad-k" role="alert">{err}</small> : wake.error ? <small className="bad-k">{visible(wake.error)}</small> : null}>
      <textarea className="inp" rows={4} aria-label="Wake words" value={draft} disabled={!wake.data} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
    </Ctl>
  );
}

const AUTO: Record<string, string> = { off: "never", inbound: "talk", always: "always" };
const ALOUD: Opt[] = [{ id: "never", label: "Never" }, { id: "talk", label: "When I talk", off: "Branch can switch reading aloud only fully on or off yet." }, { id: "always", label: "Always" }];

function AnswerAloud({ engine, tts }: Shared) {
  const save = useSaveRunner();
  const value = AUTO[String(tts.data?.auto)] ?? "";
  const sub = tts.data?.auto === "tagged" ? "Now: only when a reply asks to be read out." : undefined;
  const pick = (id: string) => void save(async () => { await engine.request(id === "never" ? "tts.disable" : "tts.enable", {}); await tts.reload(); });
  return <Ctl title="Answer aloud" sub={sub}><Choice label="Answer aloud" value={value} options={ALOUD} disabled={!tts.data} onChange={pick} /></Ctl>;
}

const LANGS: [string, string][] = [["en-US", "English (US)"], ["en-GB", "English (UK)"], ["es-ES", "Spanish"], ["fr-FR", "French"], ["de-DE", "German"], ["pt-BR", "Portuguese"], ["it-IT", "Italian"], ["nl-NL", "Dutch"], ["ja-JP", "Japanese"], ["zh-CN", "Chinese"], ["ko-KR", "Korean"], ["ar-SA", "Arabic"], ["hi-IN", "Hindi"], ["yo-NG", "Yoruba"]];
const LANG_OPTS: Opt[] = [{ id: "", label: "This computer’s language" }, { id: "detect", label: "Detect it", off: NO_KEY }, ...LANGS.map(([id, label]) => ({ id, label }))];

function SpeechLanguage({ cfg }: { cfg: Cfg }) {
  const v = cfg.get("talk.speechLocale");
  return (
    <Ctl title="Speech language" sub="What you say is recognised in these languages.">
      <Pick label="Speech language" value={typeof v === "string" ? v : ""} options={LANG_OPTS} disabled={cfg.loading} onChange={(id) => void cfg.set("talk.speechLocale", id || null)} />
    </Ctl>
  );
}

export function TalkingMore({ cfg }: { cfg: Cfg }) {
  return (
    <Sec title="Talking, more">
      <Greyed why={APP} rows={[{ t: "Answer approvals by voice", sub: "Say yes or no to an approval, or hold the phone key to talk turn by turn.", c: { btn: "Try one" } }]} />
      <Ctl title="Talking over it stops it" sub="Speak while it is talking and it stops to listen. On a Mac, pressing the right Option key does the same at any time.">
        <Switch checked={cfg.get("talk.interruptOnSpeech") !== false} label="Talking over it stops it" disabled={cfg.loading} onChange={(on) => void cfg.set("talk.interruptOnSpeech", on)} />
      </Ctl>
      <Greyed why={APP} rows={[{ t: "Hold the microphone to dictate", sub: "Hold the microphone button until it listens, then let go and keep talking. Done puts the words in the message box.", c: { sw: true } }]} />
    </Sec>
  );
}
