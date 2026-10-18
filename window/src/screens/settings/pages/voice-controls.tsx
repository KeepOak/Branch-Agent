// Settings › Voice & calls: the controls the R1 page draws itself (slots.ts controls), each on the engine calls Classic
// Voice (set1/voice*.tsx) makes: the reply voice and reading aloud (tts.status, tts.setPersona, tts.enable/disable),
// wake words (voicewake.get/set), the speaking engine and its preview (tts.providers, tts.setProvider, tts.speak), live
// voice (talk.catalog, talk.* through config), meeting notes (the meeting plugins), the test call (voicecall.initiate),
// the listening engine and the Technical commands and key list.
import { CheckedAt, useCheckedAt } from "../../../places/settings/checked-at";
import { useEffect, useState, type ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { errorText, list, record, text, visible } from "../../../places/settings/adapter";
import { useConfig } from "../../../places/settings/kit";
import { group, providersOf, type Provider } from "../../../places/settings/set1/voice-kit";
import { wakeProblem } from "../../../places/settings/set1/voice-listen";
import { chooseLive, liveOf } from "../../../places/settings/set1/voice-live";
import { toValue } from "../../../places/settings/set1/voice-tech";
import { Dialog } from "../../../shell/Dialog";
import { Segmented, Toggle } from "../RowView";
import type { SlotControlProps } from "../slots";
import { useRead } from "./accounts-live";
import { Failed, Needs, useFailure } from "./appearance-live";
import { copyAndSay } from "../../../shell/clipboard";
import { VOICE_CODE } from "./voice";

const Line = ({ children, bad }: { children: ReactNode; bad?: boolean }) => <small className={"r1s-msg g-label" + (bad ? " r1s-bad" : "")} role={bad ? "status" : undefined} data-lines>{children}</small>;
/** A button that keeps the attributes <Coming> gives it (data-need), so the control stays declared. */
const Btn = ({ children, disabled, onClick, ...rest }: { children: ReactNode; disabled?: boolean; onClick: () => void }) =>
  <button type="button" className="r1s-btn" disabled={disabled} onClick={onClick} {...rest}>{children}</button>;
type Opt = { v: string; label: string };
/** A choice as segments when short and a list when long, as Classic's Choice. */
function Choose({ label, value, options, disabled, onChange, ...rest }: { label: string; value: string; options: Opt[]; disabled?: boolean; onChange: (v: string) => void }) {
  return options.length <= 4
    ? <span className="r1s-own-ctl" {...rest}><Segmented label={label} value={value} options={options} disabled={disabled} onChange={(v) => onChange(String(v))} /></span>
    : <select className="r1s-inp" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} {...rest}>{options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>;
}
const CFG = ["config.get", "config.patch"];

function useTts(engine: WindowEngine) {
  const tts = useRead(engine, "tts.status");
  const voices = useRead(engine, "tts.providers");
  return { tts, voices, providers: providersOf(voices.data?.providers) };
}
function useLive(engine: WindowEngine) {
  const cfg = useConfig(engine);
  const catalog = useRead(engine, "talk.catalog");
  return { cfg, catalog, live: liveOf(catalog.data, cfg) };
}

/** Voice: the engine's named voices and Off; with none, Engine default and Off (Classic VoiceRow). */
export function VoicePick({ engine, row }: SlotControlProps) {
  const { tts, providers, voices } = useTts(engine);
  const [failed, run] = useFailure();
  const on = tts.data?.enabled === true;
  const personas = list(tts.data?.personas);
  const active = providers.find((p) => p.id === text(voices.data?.active));
  const options: Opt[] = personas.length ? personas.map((p) => ({ v: text(p.id), label: visible(p.label ?? p.id) })) : [{ v: "", label: "Engine default" }];
  const persona = typeof tts.data?.persona === "string" ? tts.data.persona : "";
  const value = !on ? "off" : personas.length ? persona : "";
  const pick = (id: string) => void run(async () => {
    if (id === "off") await engine.request("tts.disable", {});
    else { if (personas.length) await engine.request("tts.setPersona", { persona: id }); if (!on) await engine.request("tts.enable", {}); }
    await tts.reload();
  });
  return <>
    <Needs engine={engine} need={["tts.status", "tts.enable", "tts.disable"]} where={row.label ?? ""}>
      <Choose label="Voice" value={value} options={[...options, { v: "off", label: "Off" }]} disabled={!tts.data} onChange={pick} />
    </Needs>
    {!personas.length && active?.voices.length ? <Line>{`${active.label} voices: ${active.voices.slice(0, 6).join(", ")}. A named voice picks one.`}</Line> : null}
    {tts.error ? <Line bad>{visible(tts.error)}</Line> : null}
    <Failed text={failed} />
  </>;
}

/** Wake words: one per line, saved on leaving the box (voicewake.set). */
export function WakeWords({ engine, row }: SlotControlProps) {
  const wake = useRead(engine, "voicewake.get");
  const [failed, run] = useFailure();
  const saved = Array.isArray(wake.data?.triggers) ? (wake.data.triggers as unknown[]).map(String).join("\n") : "";
  const [draft, setDraft] = useState(saved);
  const [err, setErr] = useState("");
  useEffect(() => setDraft(saved), [saved]);
  const commit = () => {
    const lines = draft.split("\n").map((s) => s.trim()).filter(Boolean);
    const bad = wakeProblem(lines);
    setErr(bad);
    if (bad || lines.join("\n") === saved) return;
    void run(async () => { await engine.request("voicewake.set", { triggers: lines }); await wake.reload(); });
  };
  return <>
    <Needs engine={engine} need={["voicewake.get", "voicewake.set"]} where={row.label ?? ""}>
      <textarea className="r1s-inp" rows={4} aria-label="Wake words" value={draft} disabled={!wake.data} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
    </Needs>
    {err ? <Line bad>{err}</Line> : wake.error ? <Line bad>{visible(wake.error)}</Line> : null}
    <Failed text={failed} />
  </>;
}

const AUTO: Record<string, string> = { off: "never", inbound: "talk", always: "always" };
/** Answer aloud: Never or Always (tts.disable / tts.enable); When I talk waits for the engine. */
export function AnswerAloud({ engine, row }: SlotControlProps) {
  const { tts } = useTts(engine);
  const [failed, run] = useFailure();
  const value = AUTO[String(tts.data?.auto)] ?? "";
  return <>
    <Needs engine={engine} need={["tts.status", "tts.enable", "tts.disable"]} where={row.label ?? ""}>
      <Choose label="Answer aloud" value={value} options={[{ v: "never", label: "Never" }, { v: "always", label: "Always" }]} disabled={!tts.data}
        onChange={(id) => void run(async () => { await engine.request(id === "never" ? "tts.disable" : "tts.enable", {}); await tts.reload(); })} />
    </Needs>
    <Line>{tts.data?.auto === "tagged" ? "Now: only when a reply asks to be read out." : "Reading aloud only after you talk comes in a later update."}</Line>
    <Failed text={failed} />
  </>;
}

/** Speaking engine (tts.setProvider). */
export function SpeakingEngine({ engine, row }: SlotControlProps) {
  const { tts, voices, providers } = useTts(engine);
  const [failed, run] = useFailure();
  const current = text(tts.data?.provider ?? voices.data?.active ?? "");
  return <>
    <Needs engine={engine} need={["tts.providers", "tts.setProvider"]} where={row.label ?? ""}>
      <select className="r1s-inp" aria-label="Speaking engine" value={current} disabled={!voices.data} onChange={(e) => { const id = e.target.value; void run(async () => { await engine.request("tts.setProvider", { provider: id }); await Promise.all([tts.reload(), voices.reload()]); }); }}>
        {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** Preview: plays tts.speak's clip. */
/** What Preview says when no voice service can speak yet, in place of the engine's "no provider registered". */
export const NO_VOICE_SERVICE = "Add a voice service to hear a preview.";
const NO_PROVIDER = /no (tts |speech |voice )?provider|provider (is )?not (registered|configured)/i;
/** The words a failed preview shows: a missing voice service in plain words, anything else as the engine said it. */
export const previewError = (e: unknown): string => {
  const said = errorText(e);
  return NO_PROVIDER.test(said) ? NO_VOICE_SERVICE : visible(said);
};
/** Shows the Voice services row (same card, same level as Preview) and moves focus to its first button. */
function showVoiceServices() {
  const el = document.getElementById("row-voice.speaking.services");
  el?.scrollIntoView?.({ block: "center" });
  el?.setAttribute("data-flash", "");
  setTimeout(() => el?.removeAttribute("data-flash"), 1400);
  el?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
}

export function PreviewVoice({ engine, row }: SlotControlProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const play = async () => {
    setBusy(true); setErr("");
    try {
      const r = await engine.request<{ audioBase64?: string; mimeType?: string }>("tts.speak", { text: "This is how replies will sound." });
      if (!r.audioBase64) throw new Error("The speaking engine sent no sound.");
      await new Audio(`data:${r.mimeType ?? "audio/mpeg"};base64,${r.audioBase64}`).play();
    } catch (e) { setErr(previewError(e)); } finally { setBusy(false); }
  };
  return <><Needs engine={engine} need={["tts.speak"]} where={row.label ?? ""}><Btn disabled={busy} onClick={() => void play()}>{busy ? "Playing…" : "Preview"}</Btn></Needs>
    {err === NO_VOICE_SERVICE ? <Line bad>{err} <button type="button" className="r1s-link" data-local="" onClick={showVoiceServices}>Voice services</button></Line>
      : err ? <Line bad>{err}</Line> : null}</>;
}

const runsHere = (p: Provider) => /local|cli/i.test(p.id);
/** Each service and whether it has a key; Add key opens Sign-ins & keys. */
function KeyList({ providers, onPage }: { providers: Provider[]; onPage?: SlotControlProps["onPage"] }) {
  if (!providers.length) return null;
  return <ul className="r1s-items">{providers.map((p) => (
    <li key={p.id} className="r1s-item"><span className="r1s-item-t g-label">{p.label}</span>
      <small className="g-label">{runsHere(p) ? "On this computer" : p.configured ? "Ready" : "No key yet"}</small>
      {!runsHere(p) && onPage ? <button type="button" className="r1s-link" data-local="" onClick={() => onPage("signins")}>{p.configured ? "Change" : "Add key"}</button> : null}</li>
  ))}</ul>;
}
export function SpeakServices({ engine, row, onPage }: SlotControlProps) {
  const { providers } = useTts(engine);
  const ready = providers.filter((p) => p.configured).map((p) => p.label);
  return <Needs engine={engine} need={["tts.providers"]} where={row.label ?? ""}><div className="r1s-own-ctl">
    <Line>{ready.length ? `On because ${ready.join(" and ")} ${ready.length > 1 ? "are" : "is"} connected.` : "Turns on when a voice service is connected."}</Line>
    <KeyList providers={providers} onPage={onPage} /></div></Needs>;
}
export function ListenServices({ engine, row, onPage }: SlotControlProps) {
  const catalog = useRead(engine, "talk.catalog");
  return <Needs engine={engine} need={["talk.catalog"]} where={row.label ?? ""}><div className="r1s-own-ctl"><KeyList providers={providersOf(group(catalog.data, "transcription").providers)} onPage={onPage} /></div></Needs>;
}

/** Named voices: the engine's personas, in a sheet. */
export function NamedVoices({ engine, row }: SlotControlProps) {
  const { tts } = useTts(engine);
  const [open, setOpen] = useState(false);
  const personas = list(tts.data?.personas);
  return <>
    <Needs engine={engine} need={["tts.status"]} where={row.label ?? ""}><Btn disabled={!personas.length} onClick={() => setOpen(true)}>{personas.length ? `See ${personas.length}` : "None yet"}</Btn></Needs>
    {open ? <Dialog title="Named voices" onClose={() => setOpen(false)}><ul className="r1s-items">{personas.map((p) => <li key={text(p.id)} className="r1s-item">
      <span className="r1s-item-t g-label">{visible(p.label ?? p.id)}</span><small className="g-label">{[p.description, p.provider].filter(Boolean).map(visible).join(" · ")}</small></li>)}</ul></Dialog> : null}
  </>;
}

/** Live voice: whether a live-voice service is ready, and which. */
export function LiveStatus({ engine }: SlotControlProps) {
  const { catalog, live } = useLive(engine);
  const ready = Boolean(live.active?.configured);
  return <><span className="r1s-val g-label">{catalog.data ? (ready ? "Ready" : "Not set up") : "…"}</span>
    <Line bad={Boolean(catalog.error)}>{catalog.error ? visible(catalog.error) : ready ? `Using ${live.active?.label}.` : "No live-voice service is set up yet."}</Line></>;
}

/** Live voice through: any service with a working key, or one of them (talk.realtime.provider). */
export function LiveThrough({ engine, row }: SlotControlProps) {
  const { cfg, live } = useLive(engine);
  const [failed, run] = useFailure();
  const options: Opt[] = [{ v: "", label: "Any service with a working key" }, ...live.providers.map((p) => ({ v: p.id, label: p.label }))];
  return <>
    <Needs engine={engine} need={["talk.catalog", ...CFG]} where={row.label ?? ""}>
      <select className="r1s-inp" aria-label="Live voice through" value={live.chosen} disabled={cfg.loading} onChange={(e) => { const id = e.target.value; void run(() => chooseLive(cfg, id)); }}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </Needs>
    <Line>{live.providers.some((p) => p.configured) ? "On because a live-voice service is connected." : "Turns on when a live-voice service is connected."}</Line>
    <Failed text={failed} />
  </>;
}

function LivePick({ engine, row, path, label, values, first }: SlotControlProps & { path: string; label: string; values: (p?: Provider) => string[]; first: (p?: Provider) => string }) {
  const { cfg, live } = useLive(engine);
  const [failed, run] = useFailure();
  return <>
    <Needs engine={engine} need={["talk.catalog", ...CFG]} where={row.label ?? ""}>
      <select className="r1s-inp" aria-label={label} value={text(cfg.get(path) ?? "")} disabled={!live.active || cfg.loading} onChange={(e) => { const v = e.target.value; void run(() => cfg.set(path, v || null)); }}>
        <option value="">{first(live.active)}</option>
        {values(live.active).map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </Needs>
    <Failed text={failed} />
  </>;
}
export const LiveModel = (p: SlotControlProps) => <LivePick {...p} path="talk.realtime.model" label="Live voice model" values={(a) => a?.models ?? []} first={(a) => (a?.defaultModel ? `Service default (${a.defaultModel})` : "Service default")} />;
export const LiveSpeaker = (p: SlotControlProps) => <LivePick {...p} path="talk.realtime.speakerVoice" label="Speaker voice" values={(a) => a?.voices ?? []} first={() => "Service default"} />;

/** Live voice through the Gateway: only when the service is set up and offers the relay. */
export function LiveGateway({ engine, row }: SlotControlProps) {
  const { cfg, live } = useLive(engine);
  const [failed, run] = useFailure();
  const can = Boolean(live.active?.configured) && (!live.active?.transports.length || live.active.transports.includes("gateway-relay"));
  return <>
    <Needs engine={engine} need={["talk.catalog", ...CFG]} where={row.label ?? ""}>
      <span className="r1s-own-ctl"><Toggle label="Live voice through the Gateway" on={cfg.get("talk.realtime.transport") === "gateway-relay"} disabled={!can || cfg.loading}
        onChange={(v) => void run(() => cfg.set("talk.realtime.transport", v ? "gateway-relay" : null))} /></span>
    </Needs>
    {!can ? <Line>Needs a live-voice service, the Gateway connection and the Trunk doing the thinking (Technical).</Line> : null}
    <Failed text={failed} />
  </>;
}

/** Who answers live voice: the default Trunk or one of them (talk.agentId). */
export function LiveWho({ engine, row }: SlotControlProps) {
  const cfg = useConfig(engine);
  const agents = useRead(engine, "agents.list");
  const [failed, run] = useFailure();
  return <>
    <Needs engine={engine} need={["agents.list", ...CFG]} where={row.label ?? ""}>
      <select className="r1s-inp" aria-label="Who answers live voice" value={text(cfg.get("talk.agentId") ?? "")} disabled={cfg.loading} onChange={(e) => { const v = e.target.value; void run(() => cfg.set("talk.agentId", v || null)); }}>
        <option value="">The default Trunk</option>
        {list(agents.data?.agents).map((a) => <option key={text(a.id)} value={text(a.id)}>{visible(record(a.identity).name ?? a.name ?? a.id)}</option>)}
      </select>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** Live-voice services: each, with Use (Classic Live voice, more services). */
export function LiveServices({ engine, row }: SlotControlProps) {
  const { cfg, catalog, live } = useLive(engine);
  const [failed, run] = useFailure();
  return <>
    <Needs engine={engine} need={["talk.catalog", ...CFG]} where={row.label ?? ""}>
      <div className="r1s-own-ctl">{live.providers.length ? <ul className="r1s-items">{live.providers.map((p) => (
        <li key={p.id} className="r1s-item"><span className="r1s-item-t g-label">{p.label}</span><small className="g-label">{p.configured ? "Has a working key" : "Uses the key from Accounts or Voice services"}</small>
          <button type="button" className="r1s-link" disabled={live.chosen === p.id || cfg.loading} onClick={() => void run(() => chooseLive(cfg, p.id))}>{live.chosen === p.id ? "In use" : "Use"}</button></li>
      ))}</ul> : <Line>{catalog.loading ? "Checking…" : "No live-voice service is set up yet."}</Line>}</div>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** Test call: rings your own number (voicecall.initiate); needs Phone calls on. */
export function TestCall({ engine, row }: SlotControlProps) {
  const cfg = useConfig(engine);
  const [failed, run] = useFailure();
  const on = cfg.get("plugins.entries.voice-call.enabled") === true;
  return <>
    <Needs engine={engine} need={["voicecall.initiate"]} where={row.label ?? ""}><Btn disabled={!on} onClick={() => void run(async () => { await engine.request("voicecall.initiate", { message: "This is a test call from Branch.", mode: "notify" }); })}>Call me</Btn></Needs>
    {!on ? <Line>Turn on Phone calls first.</Line> : null}
    <Failed text={failed} />
  </>;
}

const MEETINGS = ["google-meet", "teams-meetings", "zoom-meetings"];
/** Meeting notes: the Meet, Teams and Zoom plugins together. */
export function MeetingNotes({ engine, row }: SlotControlProps) {
  const cfg = useConfig(engine);
  const [failed, run] = useFailure();
  const on = MEETINGS.every((id) => cfg.get(`plugins.entries.${id}.enabled`) !== false);
  return <>
    <Needs engine={engine} need={CFG} where={row.label ?? ""}><span className="r1s-own-ctl"><Toggle label="Meeting notes" on={on} disabled={cfg.loading}
      onChange={(v) => void run(() => cfg.set("plugins.entries", Object.fromEntries(MEETINGS.map((id) => [id, { enabled: v }]))))} /></span></Needs>
    <Failed text={failed} />
  </>;
}

/** Listening engine: the transcription services talk.catalog lists (the voice-call streaming provider). */
export function ListeningEngine({ engine, row }: SlotControlProps) {
  const cfg = useConfig(engine);
  const catalog = useRead(engine, "talk.catalog");
  const [failed, run] = useFailure();
  const tr = group(catalog.data, "transcription");
  const providers = providersOf(tr.providers);
  const STREAM = "plugins.entries.voice-call.config.streaming.provider";
  return <>
    <Needs engine={engine} need={["talk.catalog", ...CFG]} where={row.label ?? ""}>
      <select className="r1s-inp" aria-label="Listening engine" value={text(cfg.get(STREAM) ?? tr.activeProvider ?? "")} disabled={cfg.loading || !providers.length} onChange={(e) => { const v = e.target.value; void run(() => cfg.set(STREAM, v)); }}>
        {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** A terminal command (Technical), with Copy. */
export function VoiceCode({ row }: SlotControlProps) {
  const code = VOICE_CODE[row.id] ?? "";
  const [copied, setCopied] = useState(false);
  return <span className="r1s-own-ctl" data-local=""><code className="r1s-val">{code}</code>
    <Btn onClick={() => void copyAndSay(code).then(setCopied)}>{copied ? "Copied" : "Copy"}</Btn></span>;
}

type Kind = "text" | "number" | "bool";
const KEYS: [string, Kind, string][] = [
  ["talk.realtime.provider", "text", "Which service runs live voice (blank: the first with a working key)."], ["talk.realtime.model", "text", "The live-voice model."],
  ["talk.realtime.speakerVoice", "text", "The live-voice speaker voice."], ["talk.realtime.instructions", "text", "Added to Branch’s own live-voice instructions."],
  ["talk.agentId", "text", "Who answers live voice."], ["talk.interruptOnSpeech", "bool", "Stop talking when you start."], ["talk.realtime.transport", "text", "How sound travels."],
  ["talk.realtime.vadThreshold", "number", "Voice detection, 0–1."], ["talk.silenceTimeoutMs", "number", "Pause before sending, ms."], ["tts.provider", "text", "The speaking engine."],
  ["tts.maxTextLength", "number", "Longest reply it reads, characters."], ["tts.timeoutMs", "number", "How long a spoken reply may take, ms."],
];
/** All voice settings: each talk.* and tts.* key the engine has, with Save and Reload (Classic Voice, technical). */
export function AllVoiceSettings({ engine, row }: SlotControlProps) {
  const [checked, stamp] = useCheckedAt();
  const cfg = useConfig(engine);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const shown = (key: string, kind: Kind) => (key in draft ? draft[key] : kind === "bool" ? cfg.get(key) !== false : text(cfg.get(key) ?? ""));
  const save = async () => {
    let values: [string, unknown][];
    try { values = KEYS.filter(([k]) => k in draft).map(([k, kind]) => [k, toValue(kind, draft[k])]); } catch (e) { setErr(errorText(e)); return; }
    setErr(""); setBusy(true);
    for (const [k, v] of values) if (!(await cfg.set(k, v))) { setBusy(false); return; }
    setDraft({}); setBusy(false);
  };
  return <Needs engine={engine} need={CFG} where={row.label ?? ""}><div className="r1s-own-ctl">
    <ul className="r1s-items">{KEYS.map(([key, kind, what]) => { const v = shown(key, kind); return (
      <li key={key} className="r1s-item"><code className="r1s-item-t">{key}</code>
        {kind === "bool" ? <Toggle label={key} on={v === true} onChange={(on) => setDraft({ ...draft, [key]: on })} />
          : <input className="r1s-inp" aria-label={key} value={String(v)} placeholder="Default" onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />}
        <small className="g-label">{what}</small></li>); })}</ul>
    <span className="r1s-acts"><button type="button" className="r1s-btn" disabled={!Object.keys(draft).length || busy || cfg.loading} onClick={() => void save()}>Save</button>
      <button type="button" className="r1s-btn" disabled={busy} onClick={() => { setDraft({}); setErr(""); void cfg.reload().then((ok) => { if (ok) stamp(); }, () => undefined); }}>Reload</button><CheckedAt at={checked} /></span>
    {err ? <Line bad>{err}</Line> : null}
  </div></Needs>;
}
