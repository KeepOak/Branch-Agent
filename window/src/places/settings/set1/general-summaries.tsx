// Settings › General, summaries of older turns and the waiting line (§4.7.1, Advanced and Technical). Each row is an
// engine key: agents.defaults.compaction.* (enabled, keepRecentTokens, model, mode, timeoutSeconds, identifierPolicy),
// agents.defaults.contextPruning.* (mode, ttl) and messages.queue.* (cap, drop). config.get gives the materialised
// config, so a value the engine filled in (safeguard mode, the Claude trimming default) reads as it runs.
import type { WindowEngine } from "../../../connect/engine";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Ctl, Field, Pick, Sec, Seg, Switch, useConfig, useSaved } from "../kit";

const C = "agents.defaults.compaction";
const PRUNE = "agents.defaults.contextPruning";
/** The engine's own defaults when a key is unset (settings-manager, agent-settings, queue/state). */
const KEEP_RECENT = 20_000;
const SUMMARY_TIMEOUT = 180;
const QUEUE_CAP = 20;
const fmt = (n: number) => n.toLocaleString("en-US");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A number box with its unit; commas are fine, empty puts the engine's default back. */
export function Num({ value, unit, label, onSave, placeholder, disabled }: {
  value: number | undefined; unit?: string; label: string; onSave?: (n: number | null) => void; placeholder?: string; disabled?: boolean;
}) {
  const report = useSaved();
  const commit = (v: string) => {
    const t = v.replace(/[,\s_]/g, "");
    if (!t) return onSave?.(null);
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1) return report.failed(`${label}: type a whole number above 0.`);
    onSave?.(n);
  };
  return (
    <span className="num-k">
      <Field value={value === undefined ? "" : fmt(value)} label={label} placeholder={placeholder} disabled={disabled} onCommit={commit} />
      {unit ? <small>{unit}</small> : null}
    </span>
  );
}

export function OlderTurns({ engine, grouped = false }: { engine: WindowEngine; grouped?: boolean }) {
  const cfg = useConfig(engine);
  const models = useResource<RecordValue>(engine, "models.list", {});
  const options = [{ id: "", label: "The conversation’s model" }, ...list(models.data?.models).filter((m) => m.available !== false).map((m) => ({ id: `${text(m.provider)}/${text(m.id)}`, label: visible(m.name ?? m.id) }))];
  const model = cfg.get(`${C}.model`);
  return (
    <Sec title={grouped ? "" : "Summaries"}>
      <Ctl title="Summarise older turns by themselves" sub="Keeps long conversations fast. The summary card shows what was kept.">
        <Switch checked={cfg.get(`${C}.enabled`) !== false} label="Summarise older turns by themselves" disabled={cfg.loading} onChange={(v) => void cfg.set(`${C}.enabled`, v)} />
      </Ctl>
      <Ctl title="Always keep the latest" sub="The newest part of the conversation, kept word for word.">
        <Num value={num(cfg.get(`${C}.keepRecentTokens`)) ?? KEEP_RECENT} unit="tokens" label="Always keep the latest" disabled={cfg.loading} onSave={(n) => void cfg.set(`${C}.keepRecentTokens`, n)} />
      </Ctl>
      <Ctl title="Model for summaries" sub="A cheaper or local model keeps summaries cheap.">
        <Pick label="Model for summaries" value={typeof model === "string" ? model : ""} options={options} disabled={cfg.loading} onChange={(v) => void cfg.set(`${C}.model`, v || null)} />
      </Ctl>
    </Sec>
  );
}

const HOW = [{ id: "safeguard", label: "Careful" }, { id: "default", label: "Quick" }];
export function SummariesTechnical({ engine, grouped = false }: { engine: WindowEngine; grouped?: boolean }) {
  const cfg = useConfig(engine);
  const mode = cfg.get(`${C}.mode`) === "default" ? "default" : "safeguard";
  return (
    <Sec title={grouped ? "" : "Summaries"}>
      <Ctl title="How it summarises" sub="Careful mode checks each summary before replacing history." help="Careful works in chunks and checks the summary; if the check fails the history is kept as it was.">
        <Seg label="How it summarises" value={mode} options={HOW} disabled={cfg.loading} onChange={(v) => void cfg.set(`${C}.mode`, v)} />
      </Ctl>
      <Ctl title="Summary time limit">
        <Num value={num(cfg.get(`${C}.timeoutSeconds`)) ?? SUMMARY_TIMEOUT} unit="s" label="Summary time limit" disabled={cfg.loading} onSave={(n) => void cfg.set(`${C}.timeoutSeconds`, n)} />
      </Ctl>
      <Ctl title="Keep names and numbers exact" sub="IDs, names and numbers are copied word for word.">
        <Switch checked={cfg.get(`${C}.identifierPolicy`) !== "off"} label="Keep names and numbers exact" disabled={cfg.loading} onChange={(v) => void cfg.set(`${C}.identifierPolicy`, v ? "strict" : "off")} />
      </Ctl>
      <Trim engine={engine} />
    </Sec>
  );
}

/** A duration as the engine reads contextPruning.ttl (a bare number is minutes), in minutes. */
export function ttlMinutes(ttl: unknown): number | undefined {
  if (ttl === undefined || ttl === null) return 5;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/i.exec(String(ttl));
  if (!m) return undefined;
  const per: Record<string, number> = { ms: 1 / 60_000, s: 1 / 60, m: 1, h: 60, d: 1440 };
  return Math.round(Number(m[1]) * per[(m[2] ?? "m").toLowerCase()] * 100) / 100;
}

function Trim({ engine }: { engine: WindowEngine }) {
  const cfg = useConfig(engine);
  const auth = useResource<RecordValue>(engine, "models.authStatus", {});
  const claude = list(auth.data?.providers).some((p) => p.provider === "anthropic" && list(p.profiles).length > 0);
  const on = cfg.get(`${PRUNE}.mode`) === "cache-ttl";
  const why = on && claude ? " On because a Claude account is connected." : !on && !claude && !auth.loading ? " Turns on when a Claude account is connected." : "";
  return (
    <>
      <Ctl title="Trim old tool results" sub="Clears old tool output after the cache expires." help={`After the cache expires, old tool output is cleared from what the model sees; the conversation keeps it.${why}`}>
        <Switch checked={on} label="Trim old tool results" disabled={cfg.loading} onChange={(v) => void cfg.set(`${PRUNE}.mode`, v ? "cache-ttl" : "off")} />
      </Ctl>
      <Ctl title="Trim after">
        <Num value={ttlMinutes(cfg.get(`${PRUNE}.ttl`))} unit="minutes" label="Trim after" disabled={cfg.loading || !on} onSave={(n) => void cfg.set(`${PRUNE}.ttl`, n === null ? null : `${n}m`)} />
      </Ctl>
    </>
  );
}

const DROP = [{ id: "summarize", label: "Summarise the oldest" }, { id: "old", label: "Drop the oldest" }, { id: "new", label: "Refuse the newest" }];
export function WaitingLine({ engine }: { engine: WindowEngine }) {
  const cfg = useConfig(engine);
  const drop = cfg.get("messages.queue.drop");
  return (
    <Sec title="Waiting line">
      <Ctl title="Most messages in line">
        <Num value={num(cfg.get("messages.queue.cap")) ?? QUEUE_CAP} label="Most messages in line" disabled={cfg.loading} onSave={(n) => void cfg.set("messages.queue.cap", n)} />
      </Ctl>
      <Ctl title="When the line is full" sub="Summarising keeps the gist of what is dropped.">
        <Seg label="When the line is full" value={typeof drop === "string" ? drop : "summarize"} options={DROP} disabled={cfg.loading} onChange={(v) => void cfg.set("messages.queue.drop", v)} />
      </Ctl>
    </Sec>
  );
}

