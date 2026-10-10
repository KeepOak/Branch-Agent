// Voice › Speaking back, more; What Trunks may use; Listening, services; A spoken turn (Advanced). The speaking
// engine is tts.providers / tts.setProvider, Preview plays tts.speak's clip, named voices are tts.status personas;
// listening engines come from talk.catalog (transcription) and save to the voice-call streaming provider; audio
// files on tools.media.audio.enabled; your own program on tts.providers.tts-local-cli.command.
import { useState } from "react";
import { errorText, list, text, visible } from "../adapter";
import { Btn, Ctl, Field, Pick, Plist, Prow, Sec, Switch, useSaveRunner } from "../kit";
import { Dialog } from "../../../shell/Dialog";
import { APP, Greyed, NO_KEY, group, providersOf, type GreyRow, type Provider } from "./voice-kit";
import type { Shared } from "./voice-more";
import { Logo } from "./service";

export function SpeakingMore(props: Shared) {
  const { engine, tts, voices } = props;
  const save = useSaveRunner();
  const providers = providersOf(voices.data?.providers);
  const current = text(tts.data?.provider ?? voices.data?.active ?? "");
  const pick = (id: string) => void save(async () => { await engine.request("tts.setProvider", { provider: id }); await Promise.all([tts.reload(), voices.reload()]); });
  const ready = providers.filter((p) => p.configured).map((p) => p.label);
  return (
    <Sec title="Speaking back, more" showHeading={false} group="Speaking back">
      <Ctl title="Speaking engine" sub="Voices on this computer are free and private." help="Voices on this computer are free and private. A service needs its key and gets the text it reads out.">
        <Pick label="Speaking engine" value={current} options={providers.map((p) => ({ id: p.id, label: p.label }))} disabled={!voices.data} onChange={pick} />
      </Ctl>
      <PreviewRow {...props} />
      <Ctl title="Voice services" sub={ready.length ? `On because ${ready.join(" and ")} ${ready.length > 1 ? "are" : "is"} connected.` : "Turns on when a voice service is connected."}
        after={<KeyList providers={providers} openSettings={props.openSettings} />} />
      <NamedVoices {...props} />
      <Greyed why="Change it with /tts limit in a conversation for now." rows={[{ t: "Read in full up to", sub: "Longer replies are shortened before they are read. /tts limit changes it for one conversation.", c: { field: "", ph: "1500", unit: "characters" } }]} />
      <Greyed why="Change it with /tts summary in a conversation for now." rows={[{ t: "Shorten longer replies first", sub: "A longer reply is summarised before it is read out. /tts summary changes it for one conversation.", c: { sw: true } }]} />
    </Sec>
  );
}

const KEY_WORD: Record<string, string> = { yes: "Ready", no: "No key yet", here: "On this computer" };
/** A provider that runs on this computer (your own program, a local voice) needs no key. */
const runsHere = (p: Provider) => /local|cli/i.test(p.id);
/** Each service and whether it has a key; keys live in Saved passwords. */
function KeyList({ providers, openSettings }: { providers: Provider[]; openSettings?: (page: string) => void }) {
  if (!providers.length) return null;
  return (
    <Plist>
      {providers.map((p) => (
        <Prow key={p.id} icon={<Logo id={p.id} name={p.label} size={30} />} title={p.label} sub={KEY_WORD[runsHere(p) ? "here" : p.configured ? "yes" : "no"]}>
          {openSettings && !runsHere(p) ? <Btn sm onClick={() => openSettings("secrets")}>{p.configured ? "Change" : "Add key"}</Btn> : null}
        </Prow>
      ))}
    </Plist>
  );
}

function PreviewRow({ engine }: Shared) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const play = async () => {
    setBusy(true); setErr("");
    try {
      const r = await engine.request<{ audioBase64?: string; mimeType?: string }>("tts.speak", { text: "This is how replies will sound." });
      if (!r.audioBase64) throw new Error("The speaking engine sent no sound.");
      await new Audio(`data:${r.mimeType ?? "audio/mpeg"};base64,${r.audioBase64}`).play();
    } catch (e) { setErr(visible(errorText(e))); } finally { setBusy(false); }
  };
  return (
    <Ctl title="Preview" sub={err || "Plays “This is how replies will sound.”"}>
      <Btn sm disabled={busy} onClick={() => void play()}>{busy ? "Playing…" : "Preview"}</Btn>
    </Ctl>
  );
}

function NamedVoices({ tts }: Shared) {
  const [open, setOpen] = useState(false);
  const personas = list(tts.data?.personas);
  if (!personas.length) return <Greyed why="Branch can’t add a named voice from here yet." rows={[{ t: "Named voices", sub: "A name for a voice that keeps sounding the same, whichever engine speaks.", c: { btn: "Manage" } }]} />;
  return (
    <Ctl title="Named voices" sub="Save one voice name across speech engines." help="A name for a voice that keeps sounding the same, whichever engine speaks.">
      <Btn sm onClick={() => setOpen(true)}>See {personas.length}</Btn>
      {open ? (
        <Dialog title="Named voices" onClose={() => setOpen(false)}>
          <div className="rows">
            {personas.map((p) => <div key={text(p.id)} className="prow"><span className="grow"><b>{visible(p.label ?? p.id)}</b><small>{[p.description, p.provider].filter(Boolean).map(visible).join(" · ")}</small></span></div>)}
          </div>
        </Dialog>
      ) : null}
    </Ctl>
  );
}

export function TrunksMayUse() {
  return (
    <Sec title="What Trunks may use" group="Voice engine">
      <Greyed why={APP} rows={[
        { t: "Trunks may listen through the microphone", sub: "A Trunk can record and turn speech into text on this computer when a task needs it. Setup turns it on; it stays off if setup is skipped.", c: { sw: true } },
        { t: "Trunks may speak on this computer’s speakers", sub: "A Trunk can say something out loud here, such as a reminder, in the chosen voice. Setup turns it on; it stays off if setup is skipped.", c: { sw: true } },
      ]} />
    </Sec>
  );
}

const STREAM = "plugins.entries.voice-call.config.streaming.provider";
export function ListeningServices({ cfg, catalog, openSettings }: Shared) {
  const tr = group(catalog.data, "transcription");
  const providers = providersOf(tr.providers);
  const value = text(cfg.get(STREAM) ?? tr.activeProvider ?? "");
  const cli = text(cfg.get("tts.providers.tts-local-cli.command") ?? "");
  return (
    <Sec title="Listening, services" showHeading={false} group="Listening">
      <Ctl title="Listening engine" sub="What turns your voice into words." help="What turns your voice into words. A service needs its key and hears the recording.">
        <Pick label="Listening engine" value={value} options={providers.map((p) => ({ id: p.id, label: p.label }))} disabled={cfg.loading || !providers.length} onChange={(id) => void cfg.set(STREAM, id)} />
      </Ctl>
      <Ctl stack title="A program of yours as an engine" sub="{{Text}} and {{OutputPath}} are filled in for you.">
        <Field wide label="A program of yours as an engine" value={cli} placeholder="piper --output_file {{OutputPath}}" disabled={cfg.loading} onCommit={(v) => void cfg.set("tts.providers.tts-local-cli.command", v.trim() || null)} />
      </Ctl>
      <Greyed why={NO_KEY} rows={[
        { t: "Try again when a service hiccups", sub: "A wrong key stops at once instead of using up your allowance.", c: { sw: true } },
        { t: "Use the chat app’s own transcript first", sub: "Where an app sends its own words with a voice note.", c: { sw: true } },
      ]} />
      <Ctl title="Turn audio and video files into documents" sub="Files you add to Library are transcribed." after={<KeyList providers={providers} openSettings={openSettings} />}>
        <Switch checked={cfg.get("tools.media.audio.enabled") !== false} label="Turn audio and video files into documents" disabled={cfg.loading} onChange={(on) => void cfg.set("tools.media.audio.enabled", on)} />
      </Ctl>
    </Sec>
  );
}

const TURN: GreyRow[] = [
  { t: "Set up voice", sub: "Pick how it listens and speaks, add keys, and get what runs here.", c: { btn: "Start" } },
  { t: "Keep voice ready", sub: "While voice is on somewhere, the engines stay loaded so the first word is quick.", c: { sw: true } },
  { t: "Speak while the answer is written", sub: "Each sentence is spoken as soon as it’s done.", c: { sw: true } },
  { t: "Remember spoken lines", sub: "A line said before plays at once; a new voice never replays an old one.", c: { sw: true } },
  { t: "Trunks may change their voice in a reply", sub: "A reply can ask for another voice or engine for a line.", c: { sw: false } },
  { t: "Send dictation by itself", sub: "When you stop, the words go after a short countdown you can cancel.", c: { sw: false }, why: APP },
  { t: "Countdown", c: { field: "3", unit: "s" }, why: APP },
  { t: "Wait while I’m mid-thought", sub: "A pause that sounds unfinished doesn’t end your turn.", c: { sw: true } },
  { t: "Ignore its own voice", sub: "Its speech, filler sounds and people nearby are kept out of what it hears.", c: { sw: true } },
  { t: "Stop phrases", sub: "Saying one ends the voice session. One per line.", c: { area: "" } },
  { t: "Start answering while I finish", sub: "On this computer: it gets ready as you speak and drops the draft if you keep going.", c: { sw: false } },
  { t: "Talk to a Trunk by name", sub: "A Trunk’s name at the start or end of what you say goes to that Trunk.", c: { sw: true } },
  { t: "Act on each part as I say it", sub: "“Open the browser and find flights”: the first part starts before you finish. Off until you choose: it acts before you’ve finished.", c: { sw: false } },
  { t: "Clean up background noise", sub: "Fans, traffic and typing are filtered before it listens. Uses a little processor.", c: { sw: false }, why: APP },
  { t: "Lower other sound while we talk", sub: "Music and videos get quieter while it listens or speaks.", c: { sw: true }, why: APP },
  { t: "Tell a real interruption from a cough", sub: "A short “uh-huh” pauses it instead of stopping it.", c: { sw: true } },
  { t: "While it thinks", sub: "So a pause doesn’t sound like a dropped call.", c: { seg: ["Silence", "Soft typing", "A low hum"], v: "Silence" } },
  { t: "Say how background tasks are going", sub: "Waits for a pause in the talk, then a short line.", c: { sw: true } },
  { t: "Hand slow work to a Trunk and keep talking", sub: "Anything slower than a few seconds goes to a Trunk; the voice carries on.", c: { sw: true } },
  { t: "Every spoken turn ends with speech", sub: "If it fails, is stopped or runs out, it says a short sentence instead of going quiet.", c: { sw: true } },
  { t: "Risky actions asked by voice need a spoken yes", sub: "Bound to that one task.", c: { sw: true } },
  { t: "Quick spoken commands", sub: "“Stop”, “louder”, “next”: matched before any model is asked.", c: { sw: true } },
  { t: "Notice how I sound", sub: "A hint to the Trunk when it’s fairly sure you sound stressed or rushed. Off until you choose: it reads your tone.", c: { sw: false } },
  { t: "Dictate into any app", sub: "Hold the key below anywhere; the words appear tidied where you type.", c: { sw: false }, why: APP },
  { t: "Dictate-anywhere key", c: { field: "Right Ctrl" }, why: APP, stack: true },
];

export function SpokenTurn() {
  return <Sec title="A spoken turn" showHeading={false} group="Voice engine"><Greyed why={NO_KEY} rows={TURN} /></Sec>;
}
