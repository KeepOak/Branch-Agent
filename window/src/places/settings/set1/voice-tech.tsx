// Voice › Voice, technical (Technical): the real commands for speaking into a file and for phone calls, and "All
// voice settings", the engine's own talk.* and tts.* keys in one form with Save and Reload (the preview's form).
import { useState } from "react";
import { errorText, text } from "../adapter";
import { Btn, Ctl, Sec, Switch } from "../kit";
import { CodeRow, Greyed, NO_KEY } from "./voice-kit";
import type { Cfg, Shared } from "./voice-more";

export function VoiceTechnical({ cfg }: Shared) {
  return (
    <Sec title="Voice, technical">
      <CodeRow t="Speak into a file" code={'branch infer tts convert --text "Your build is done" --output done.mp3'} sub="Uses the speaking engine above." />
      <CodeRow t="Speaking status" code="branch infer tts status" sub="Which engine, voice and named voice are in use, and whether it reads replies aloud. Turning reading aloud on and off is the “Voice” row’s Off and “Answer aloud”." />
      <Ctl title="Voice nicknames" sub="A Trunk can switch voice by nickname, such as “Roger”. Short names for voices of the chosen engine." off={NO_KEY}
        after={<div className="prow add-k" aria-disabled="true"><input className="inp" placeholder="Nickname" aria-label="Nickname" disabled /><input className="inp" placeholder="Voice ID" aria-label="Voice ID" disabled /><Btn sm disabled>Add</Btn></div>} />
      <Greyed why={NO_KEY} rows={[{ t: "Audio format", sub: "The file format spoken replies are made in.", c: { pick: ["Engine default"] } }]} />
      <CodeRow t="Check the call setup" code="branch voicecall setup" />
      <CodeRow t="Call and speak" code={'branch voicecall start --to <number> --message "Hello"'} />
      <CodeRow t="During a call" code="branch voicecall speak|dtmf|end --call-id <id>" />
      <CodeRow t="Follow the call log" code="branch voicecall tail" />
      <CodeRow t="Answer delay" code="branch voicecall latency" />
      <CodeRow t="Reach call webhooks from outside" code="branch voicecall expose --mode serve" sub="Off by default, as Advanced › Reach webhooks from outside." />
      <AllVoiceSettings cfg={cfg} />
    </Sec>
  );
}

type Kind = "text" | "number" | "bool";
const KEYS: [string, Kind, string][] = [
  ["talk.realtime.provider", "text", "Which service runs live voice (blank: the first with a working key)."],
  ["talk.realtime.model", "text", "The live-voice model."],
  ["talk.realtime.speakerVoice", "text", "The live-voice speaker voice."],
  ["talk.realtime.instructions", "text", "Added to Branch’s own live-voice instructions."],
  ["talk.agentId", "text", "Who answers live voice."],
  ["talk.interruptOnSpeech", "bool", "Stop talking when you start."],
  ["talk.realtime.transport", "text", "How sound travels."],
  ["talk.realtime.vadThreshold", "number", "Voice detection, 0–1."],
  ["talk.silenceTimeoutMs", "number", "Pause before sending, ms."],
  ["tts.provider", "text", "The speaking engine."],
  ["tts.maxTextLength", "number", "Longest reply it reads, characters."],
  ["tts.timeoutMs", "number", "How long a spoken reply may take, ms."],
];

/** A draft value back to what the engine stores: blank removes the key. */
export function toValue(kind: Kind, v: string | boolean): unknown {
  if (kind === "bool") return v === true;
  const t = String(v).trim();
  if (!t) return null;
  if (kind === "text") return t;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`“${t}” isn’t a number.`);
  return n;
}

function AllVoiceSettings({ cfg }: { cfg: Cfg }) {
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const dirty = Object.keys(draft).length > 0;
  const shown = (key: string, kind: Kind) => (key in draft ? draft[key] : kind === "bool" ? cfg.get(key) !== false : text(cfg.get(key) ?? ""));
  const save = async () => {
    let values: [string, unknown][];
    try { values = KEYS.filter(([k]) => k in draft).map(([k, kind]) => [k, toValue(kind, draft[k])]); } catch (e) { setErr(errorText(e)); return; }
    setErr(""); setBusy(true);
    for (const [k, v] of values) if (!(await cfg.set(k, v))) { setBusy(false); return; }
    setDraft({}); setBusy(false);
  };
  return (
    <Ctl stack title="All voice settings" sub="Every live-voice and speaking setting the engine has, by its key. The rows above and this form change the same settings."
      after={(
        <div className="kv-k">
          {KEYS.map(([key, kind, what]) => {
            const v = shown(key, kind);
            return (
              <label key={key} className="kvrow-k">
                <code>{key}</code>
                {kind === "bool"
                  ? <Switch checked={v === true} label={key} onChange={(on) => setDraft({ ...draft, [key]: on })} />
                  : <input className="inp" aria-label={key} value={String(v)} placeholder="Default" onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />}
                <small>{what}</small>
              </label>
            );
          })}
          <div className="acts"><Btn pri sm disabled={!dirty || busy || cfg.loading} onClick={() => void save()}>Save</Btn><Btn ghost sm disabled={busy} onClick={() => { setDraft({}); setErr(""); void cfg.reload(); }}>Reload</Btn>{err ? <small className="bad-k" role="alert">{err}</small> : null}</div>
        </div>
      )} />
  );
}
