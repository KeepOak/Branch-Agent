// Voice › Live voice (Advanced and Technical): the realtime services talk.catalog lists, and the talk.* keys behind
// each row (talk.realtime.provider/model/speakerVoice/instructions/transport/mode/brain/…, talk.agentId,
// talk.interruptOnSpeech, talk.silenceTimeoutMs), saved through config.patch. Blank or "Service default" removes
// the key so the engine's own default applies.
import { useEffect, useState } from "react";
import { list, record, text, visible, type RecordValue } from "../adapter";
import { Btn, Ctl, Hint, Pick, Pill, Plist, Prow, Sec, Seg, Switch, type Opt } from "../kit";
import { APP, Greyed, NO_KEY, NumField, group, providersOf, type GreyRow, type Kept, type Provider } from "./voice-kit";
import type { Cfg, Shared } from "./voice-more";
import { Logo } from "./service";

type Live = { providers: Provider[]; active?: Provider; chosen: string };
/** The realtime services, the one live voice really uses (catalog's active one) and the one chosen in settings. */
export function liveOf(catalog: RecordValue | undefined, cfg: Cfg): Live {
  const rt = group(catalog, "realtime");
  const providers = providersOf(rt.providers);
  const chosen = text(cfg.get("talk.realtime.provider") ?? "");
  const active = providers.find((p) => p.id === (chosen || text(rt.activeProvider ?? "")));
  return { providers, active, chosen };
}

/** Choose a live-voice service; the engine needs it listed in talk.realtime.providers when that map has entries. */
export function chooseLive(cfg: Cfg, id: string) {
  const map = record(cfg.get("talk.realtime.providers"));
  const listed = !id || !Object.keys(map).length || id in map;
  return cfg.set("talk.realtime", { provider: id || null, model: null, speakerVoice: null, ...(listed ? {} : { providers: { [id]: {} } }) });
}

const READY: Record<string, [ "ok" | "warn", string]> = { yes: ["ok", "Ready"], no: ["warn", "Not set up"] };

export function LiveMore({ cfg, catalog, agents }: Shared & { agents: Kept<RecordValue> }) {
  const live = liveOf(catalog.data, cfg);
  const ready = Boolean(live.active?.configured);
  const [tone, word] = READY[ready ? "yes" : "no"];
  const through: Opt[] = [{ id: "local", label: "This computer", off: "Branch has no live voice on this computer yet." }, { id: "", label: "Any service with a working key" }, ...live.providers.map((p) => ({ id: p.id, label: p.label }))];
  const str = (path: string) => text(cfg.get(path) ?? "");
  const set = (path: string) => (v: string) => void cfg.set(path, v || null);
  return (
    <Sec title="Live voice, more">
      <Ctl title={<>Live voice{catalog.data ? <Pill tone={tone}>{word}</Pill> : null}</>} id="Live voice" sub={catalog.error ? visible(catalog.error) : ready ? `Using ${live.active?.label}.` : "No live-voice service is set up yet."} />
      <Ctl title="Live voice through" sub={live.providers.some((p) => p.configured) ? "On because a live-voice service is connected." : "Turns on when a live-voice service is connected."}>
        <Pick label="Live voice through" value={live.chosen} options={through} disabled={cfg.loading} onChange={(id) => void chooseLive(cfg, id)} />
      </Ctl>
      <Ctl title="Live voice model" sub="The model that listens and answers in live voice.">
        <Pick label="Live voice model" value={str("talk.realtime.model")} disabled={!live.active || cfg.loading} onChange={set("talk.realtime.model")}
          options={[{ id: "", label: live.active?.defaultModel ? `Service default (${live.active.defaultModel})` : "Service default" }, ...(live.active?.models ?? []).map((m) => ({ id: m, label: m }))]} />
      </Ctl>
      <Ctl title="Speaker voice" sub="The voice for spoken replies in live voice." help="The voice for spoken replies in live voice. Some services keep it fixed once a call starts.">
        <Pick label="Speaker voice" value={str("talk.realtime.speakerVoice")} disabled={!live.active || cfg.loading} onChange={set("talk.realtime.speakerVoice")}
          options={[{ id: "", label: "Service default" }, ...(live.active?.voices ?? []).map((v) => ({ id: v, label: v }))]} />
      </Ctl>
      <GatewayRow cfg={cfg} live={live} />
      <Ctl title="Stop talking when I start" sub="When you start speaking, it stops and listens.">
        <Switch checked={cfg.get("talk.interruptOnSpeech") !== false} label="Stop talking when I start" disabled={cfg.loading} onChange={(on) => void cfg.set("talk.interruptOnSpeech", on)} />
      </Ctl>
      <Ctl title="Who answers live voice" sub="For live voice started by the wake word or the phone’s Talk button." help="For live voice started by the wake word or the phone’s Talk button. A call started from a conversation is always with that conversation’s Trunk.">
        <Pick label="Who answers live voice" value={str("talk.agentId")} disabled={cfg.loading} onChange={set("talk.agentId")}
          options={[{ id: "", label: "The default Trunk" }, ...list(agents.data?.agents).map((a) => ({ id: text(a.id), label: visible(record(a.identity).name ?? a.name ?? a.id) }))]} />
      </Ctl>
      <TextRow cfg={cfg} path="talk.realtime.instructions" title="How it talks in live voice" ph="Speak warmly and keep answers brief." sub="Add pace and tone to live-voice instructions." help="Style for the voice service, such as pace and tone. Added to Branch’s own live-voice instructions, never replacing them." />
      <Greyed why={APP} rows={LIVE_APP} />
    </Sec>
  );
}

const SOUNDS = ["System sound", "None"];
const LIVE_APP: GreyRow[] = [
  { t: "Shift stops it talking", sub: "Press Shift while it speaks to stop it and talk.", c: { sw: true } },
  { t: "Sounds as it listens and answers", sub: "A soft sound when live voice starts listening, starts thinking and starts to speak.", c: { sw: true } },
  { t: "Wake sound", sub: "The sound when the wake word is heard.", c: { pick: SOUNDS, extra: "Play" } },
  { t: "Sent sound", sub: "The sound when what you said is sent.", c: { pick: SOUNDS, extra: "Play" } },
  { t: "Camera", sub: "For showing something during live voice. The camera starts only when you turn it on in a call.", c: { pick: ["System default"], extra: "Refresh" } },
];

function GatewayRow({ cfg, live }: { cfg: Cfg; live: Live }) {
  const can = Boolean(live.active?.configured) && (!live.active?.transports.length || live.active.transports.includes("gateway-relay"));
  const on = cfg.get("talk.realtime.transport") === "gateway-relay";
  return (
    <Ctl title="Live voice through the Gateway" off={can ? undefined : "Needs a live-voice service, the Gateway connection and the Trunk doing the thinking (Technical)."}
      sub={can ? "This computer’s microphone and speaker use the Gateway’s live-voice session. Switching it during a call restarts the call on the new route. Off until you choose: your voice goes through the Gateway to that service." : undefined}>
      <Switch checked={on} label="Live voice through the Gateway" disabled={!can || cfg.loading} onChange={(v) => void cfg.set("talk.realtime.transport", v ? "gateway-relay" : null)} />
    </Ctl>
  );
}

/** A stacked text area that saves when it loses focus (blank removes the key). */
export function TextRow({ cfg, path, title, sub, help, ph }: { cfg: Cfg; path: string; title: string; sub: string; help?: string; ph: string }) {
  const saved = text(cfg.get(path) ?? "");
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  return (
    <Ctl stack title={title} sub={sub} help={help}>
      <textarea className="inp" rows={3} aria-label={title} placeholder={ph} value={draft} disabled={cfg.loading} onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== saved) void cfg.set(path, draft.trim() || null); }} />
    </Ctl>
  );
}

const opts = (pairs: [string, string][]): Opt[] => pairs.map(([id, label]) => ({ id, label }));
const MODES = opts([["", "Service default"], ["realtime", "Live"], ["stt-tts", "Speech to text, then voice"], ["transcription", "Transcribe only"]]);
const BRAINS = opts([["agent-consult", "The Trunk"], ["direct-tools", "The service, with tools"], ["none", "No one (transcribe)"]]);
const FINAL = opts([["provider-direct", "The service’s own reply"], ["force-agent-consult", "Always the Trunk"]]);
const THINK = opts([["", "As the conversation"], ["off", "Off"], ["minimal", "Minimal"], ["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Extra high"], ["adaptive", "Adaptive"], ["max", "Max"], ["ultra", "Ultra"]]);
const FAST = opts([["", "As the conversation"], ["on", "On"], ["off", "Off"]]);
const EFFORT = opts([["", "Service default"], ["minimal", "Minimal"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]]);
const CONN = opts([["", "Chosen by the service"], ["webrtc", "Direct (WebRTC)"], ["provider-websocket", "The service’s socket"], ["gateway-relay", "Through the Gateway"], ["managed-room", "Managed room"]]);

export function LiveTechnical({ cfg, catalog }: Shared) {
  const live = liveOf(catalog.data, cfg);
  const str = (path: string, def = "") => text(cfg.get(path) ?? def);
  const set = (path: string) => (v: string) => void cfg.set(path, v || null);
  const num = (path: string) => (v: number | null) => void cfg.set(path, v);
  const fast = cfg.get("talk.consultFastMode");
  const t = live.active?.transports ?? [];
  const conn = CONN.map((o) => (o.id && t.length && !t.includes(o.id) ? { ...o, off: `${live.active?.label} doesn’t offer this.` } : o));
  return (
    <Sec title="Live voice, technical" hint="Leave raw live-voice settings blank unless needed." help="Raw live-voice settings; leave them blank unless something sounds wrong.">
      <Ctl title="How it runs"><Seg label="How it runs" value={str("talk.realtime.mode")} options={MODES} onChange={set("talk.realtime.mode")} /></Ctl>
      <Ctl title="Who does the thinking"><Seg label="Who does the thinking" value={str("talk.realtime.brain", "agent-consult")} options={BRAINS} onChange={set("talk.realtime.brain")} /></Ctl>
      <Ctl title="Final words go to"><Seg label="Final words go to" value={str("talk.realtime.consultRouting", "provider-direct")} options={FINAL} onChange={set("talk.realtime.consultRouting")} /></Ctl>
      <Ctl title="Thinking during live voice"><Pick label="Thinking during live voice" value={str("talk.consultThinkingLevel")} options={THINK} onChange={set("talk.consultThinkingLevel")} /></Ctl>
      <Ctl title="Fast answers during live voice"><Seg label="Fast answers during live voice" value={fast === true ? "on" : fast === false ? "off" : ""} options={FAST} onChange={(v) => void cfg.set("talk.consultFastMode", v ? v === "on" : null)} /></Ctl>
      <Ctl title="Voice detection" sub="0 hears the quietest sound, 1 only clear speech." help="0 hears the quietest sound, 1 only clear speech. Blank keeps the service default."><NumField label="Voice detection" unit="0–1" ph="Service default" min={0} max={1} value={cfg.get("talk.realtime.vadThreshold")} onSave={num("talk.realtime.vadThreshold")} /></Ctl>
      <Ctl title="Silence before it answers" sub="Blank keeps the service default."><NumField label="Silence before it answers" unit="ms" ph="Service default" min={1} int value={cfg.get("talk.realtime.silenceDurationMs")} onSave={num("talk.realtime.silenceDurationMs")} /></Ctl>
      <Ctl title="Sound kept before speech" sub="Blank keeps the service default."><NumField label="Sound kept before speech" unit="ms" ph="Service default" min={0} int value={cfg.get("talk.realtime.prefixPaddingMs")} onSave={num("talk.realtime.prefixPaddingMs")} /></Ctl>
      <Ctl title="Reasoning"><Pick label="Reasoning" value={str("talk.realtime.reasoningEffort")} options={EFFORT} onChange={set("talk.realtime.reasoningEffort")} /></Ctl>
      <Ctl title="Pause before sending (talk on a device)" sub="Blank: 700 ms on a Mac and Android, 900 ms on iPhone."><NumField label="Pause before sending (talk on a device)" unit="ms" ph="Default" min={1} int value={cfg.get("talk.silenceTimeoutMs")} onSave={num("talk.silenceTimeoutMs")} /></Ctl>
      <Ctl stack title="Connection" sub="How live-voice sound travels between you and the service."><Seg label="Connection" value={str("talk.realtime.transport")} options={conn} onChange={set("talk.realtime.transport")} /></Ctl>
    </Sec>
  );
}

export function LiveServices({ cfg, catalog }: Shared) {
  const live = liveOf(catalog.data, cfg);
  return (
    <Sec title="Live voice, more services">
      {live.providers.length ? (
        <Plist>
          {live.providers.map((p) => (
            <Prow key={p.id} icon={<Logo id={p.id} name={p.label} size={30} />} title={p.label} sub={p.configured ? "Has a working key" : "Uses the key from Accounts or Voice services"}>
              <Btn sm ghost disabled={live.chosen === p.id || cfg.loading} onClick={() => void chooseLive(cfg, p.id)}>{live.chosen === p.id ? "In use" : "Use"}</Btn>
            </Prow>
          ))}
        </Plist>
      ) : <Hint>{catalog.loading ? "Looking for live-voice services…" : "No live-voice service is installed."}</Hint>}
      <Greyed why={NO_KEY} rows={[{ t: "Live voice with a ChatGPT account", sub: "Use your ChatGPT sign-in for live voice instead of a key.", c: { sw: true } }]} />
    </Sec>
  );
}
