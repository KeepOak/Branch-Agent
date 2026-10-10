// Voice › Speaking back, more; What Trunks may use; Listening, services; A spoken turn (Advanced). The speaking
// engine is tts.providers / tts.setProvider, Preview plays tts.speak's clip, named voices are tts.status personas;
// listening engines come from talk.catalog (transcription) and save to the voice-call streaming provider; audio
// files on tools.media.audio.enabled; your own program on tts.providers.tts-local-cli.command.
import { useState } from "react";
import { errorText, list, text, visible } from "../adapter";
import { Btn, Ctl, Field, Pick, Plist, Prow, Sec, Switch, useSaveRunner } from "../kit";
import { Dialog } from "../../../shell/Dialog";
import { group, providersOf, type Provider } from "./voice-kit";
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
    </Sec>
  );
}

const KEY_WORD: Record<string, string> = { yes: "Ready", no: "No key yet", here: "On this computer" };
/** A provider that runs on this computer (your own program, a local voice) needs no key. */
const runsHere = (p: Provider) => /local|cli/i.test(p.id);
/** Each service and whether it has a key; keys live in Saved sign-ins. */
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
  if (!personas.length) return null;
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
      <Ctl title="Turn audio and video files into documents" sub="Files you add to Library are transcribed." after={<KeyList providers={providers} openSettings={openSettings} />}>
        <Switch checked={cfg.get("tools.media.audio.enabled") !== false} label="Turn audio and video files into documents" disabled={cfg.loading} onChange={(on) => void cfg.set("tools.media.audio.enabled", on)} />
      </Ctl>
    </Sec>
  );
}
