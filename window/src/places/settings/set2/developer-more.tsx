// Settings › Developer, the shared row helpers and the dialog-backed sections: Runs and traces (audit.list runs and
// their tool steps, diagnostics.otel.*, the diagnostics-prometheus plugin, telemetry), Troubleshooting (a bug-report
// summary from status/system.info, where each setting comes from out of config.get, diagnostics.stability warnings,
// profiles from diagnostics.*, diagnostics.lanes, node.invoke) and the settings file editor (config.get raw + hash,
// saved with config.apply against that hash; the engine validates and keeps hidden values hidden).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SettingsPageProps } from "../index";
import { Acts, Btn, Ctl, Empty, Field, Hint, Num, Pill, Sec, Seg, Switch, Tabs, Val, useAsk, useConfig } from "../kit";
import { list } from "../adapter";
import { Dialog } from "../../../shell/Dialog";
import { useBranchVersion, versionParts } from "../../../connect/branch-version";
import { CallLine, CopyBtn, Kv, bytes, rec, str, useCall, useLive, when, type RecordValue } from "./common";
import { rerunSetup } from "../../../setup/setup-model";
import "./developer.css";

export const DEFAULT_PORT = 18789;
export const APP = "Set in the Branch app on this computer.";
export const ne = (what: string) => `Needs the engine’s ${what}.`;
export type Config = ReturnType<typeof useConfig>;
export type Ctx = SettingsPageProps & { config: Config; sys: RecordValue; port: number; base: string };
const HIDDEN = "__BRANCH_REDACTED__";

/** A greyed row: [title, sub, why, control]. Control: "sw", "on", "in", "btn:Label", "btns:A|B", "seg:A|B", "val:Text",
 *  "pill:Text", "chips:A|B", "code:text", "codecopy:text", "add:Shown|Placeholder|Label". */
export type OffRow = [string, string, string, string?];
function offCtl(kind: string | undefined, title: string): ReactNode {
  if (!kind) return null;
  if (kind === "in") return <input className="inp" aria-label={title} />;
  if (kind === "sw" || kind === "on") return <Switch label={title} checked={kind === "on"} onChange={() => undefined} />;
  const at = kind.indexOf(":");
  const [k, rest] = [kind.slice(0, at), kind.slice(at + 1)];
  const parts = rest.split("|");
  if (k === "btn") return <Btn sm>{rest}</Btn>;
  if (k === "btns") return <>{parts.map((l, i) => <Btn key={l} sm ghost={i > 0}>{l}</Btn>)}</>;
  if (k === "in") return <input className="inp" aria-label={title} />;
  if (k === "pill") return <Pill>{rest}</Pill>;
  if (k === "chips") return <span className="s2developer-chips">{parts.map((l) => <span key={l} className="chip6">{l}</span>)}</span>;
  if (k === "codecopy") return <><code className="s2-code">{rest}</code><Btn sm ghost>Copy</Btn></>;
  if (k === "add") return <><Val>{parts[0]}</Val><input className="inp" placeholder={parts[1]} aria-label={parts[2]} /><Btn sm>Add</Btn></>;
  if (k === "seg") return <Seg label={title} value={rest.split("|")[0]} onChange={() => undefined} options={rest.split("|").map((l) => ({ id: l, label: l }))} />;
  if (k === "code") return <code className="s2-code">{rest}</code>;
  return <Val>{rest}</Val>;
}
export function Greyed({ rows }: { rows: OffRow[] }) {
  return <>{rows.map(([t, sub, off, c]) => <Ctl key={t} title={t} sub={sub || undefined} off={off}>{offCtl(c, t)}</Ctl>)}</>;
}
/** [section, row titles] for the row search; every row on this page is Technical. */
export const SEC_ROWS = new Map<string, [string, string[]]>();
export function rowsOf(sec: string, titles: string[]): void { SEC_ROWS.set(`${sec}|${titles[0] ?? ""}`, [sec, titles]); }
const titles = (rows: OffRow[]) => rows.map((r) => r[0]);

const RL = "gateway.auth.rateLimit";
function perWindow(ms: number): string { return ms === 60_000 ? "a minute" : ms % 60_000 === 0 ? `every ${ms / 60_000} minutes` : `every ${Math.round(ms / 1000)} seconds`; }
function waitLen(ms: number): string { return ms % 60_000 === 0 ? `${ms / 60_000}-minute` : `${Math.round(ms / 1000)}-second`; }
/** The rate-limit line from gateway.auth.rateLimit, with the engine's own defaults (10 tries, 1 minute, 5 minutes). */
export function failedLine(config: Config): string {
  const n = (k: string, d: number) => { const v = config.get(`${RL}.${k}`); return typeof v === "number" ? v : d; };
  const exempt = config.get(`${RL}.exemptLoopback`) !== false;
  return `${n("maxAttempts", 10)} tries ${perWindow(n("windowMs", 60_000))}, then a ${waitLen(n("lockoutMs", 300_000))} wait.${exempt ? " This computer isn’t counted." : ""}`;
}

/** Leaf paths of a config object, as key lists (keys may hold dots), with their values. Arrays stay whole. */
export function leaves(value: unknown, path: string[] = []): [string[], unknown][] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return path.length ? [[path, value]] : [];
  const entries = Object.entries(value as RecordValue);
  if (!entries.length && path.length) return [[path, value]];
  return entries.flatMap(([k, v]) => leaves(v, [...path, k]));
}
export function shown(v: unknown): string {
  if (v === HIDDEN) return "••••••••";
  if (typeof v === "string") return v;
  return JSON.stringify(v) ?? "";
}
function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try { return { ok: true, value: text.trim() ? JSON.parse(text) : {} }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/* ───────────── Runs and traces ───────────── */

const TRACE_OFF: OffRow[] = [
  ["Programs that see every model call", "Each sees the request, the answer and its words, for logging or accounting.", ne("model-call hooks"), "add:None|A script path|Script path"],
  ["Send logs to", "In batches. Off until you choose: logs leave this computer.", ne("log shipping"), "seg:Off|A web address|Redis"],
  ["Record requests to the local address", "Written to logs\\http-audit.log.", ne("request log"), "seg:Off|Who and when|Requests|Requests and answers"],
  ["Keep a copy of every prompt", "For audits. Off until you choose: it keeps every word sent.", ne("prompt archive"), "seg:Off|A folder|Cloud storage"],
  ["Record the browser as video", "A clip per run, in the run’s files. Off until you choose: video takes disk space.", ne("browser recording"), "sw"],
  ["Stamp files Trunks make", "Writes who made it, from what, and whether it was checked into the file itself. Off until you choose: it changes the files.", ne("file stamping"), "sw"],
];
rowsOf("Runs and traces", ["Trace explorer", "Where traces go", ...titles(TRACE_OFF), "What was sent"]);

type Dlg = "" | "trace" | "dests" | "sent" | "cfgsrc" | "warnings" | "lanes" | "node" | "editor";

export function RunsTraces(ctx: Ctx) {
  const [dlg, setDlg] = useState<Dlg>("");
  const otel = rec(ctx.config.get("diagnostics.otel"));
  return (
    <Sec title="Runs and traces">
      <Ctl title="Trace explorer" sub="See each run’s steps, model input and files." help="Every run as steps: what each took, what the model saw, and the files it made."><Btn sm onClick={() => setDlg("trace")}>Open</Btn></Ctl>
      <Ctl title="Where traces go" sub={otel.enabled === true ? `OpenTelemetry on${str(otel.endpoint) ? `: ${str(otel.endpoint)}` : ""}.` : "No destinations on. OpenTelemetry, Langfuse, LangSmith, Datadog, Sentry and more."}><Btn sm onClick={() => setDlg("dests")}>Choose</Btn></Ctl>
      <Greyed rows={TRACE_OFF} />
      <Ctl title="What was sent" sub="The local copy of every count Branch shares."><Btn sm onClick={() => setDlg("sent")}>Show</Btn></Ctl>
      {dlg === "trace" ? <TraceDialog engine={ctx.engine} onClose={() => setDlg("")} /> : null}
      {dlg === "dests" ? <DestsDialog {...ctx} onClose={() => setDlg("")} /> : null}
      {dlg === "sent" ? <SentDialog config={ctx.config} onClose={() => setDlg("")} /> : null}
    </Sec>
  );
}
type Step = { id: string; name: string; start: number; end?: number; status: string; error?: string };
type Run = { runId: string; agentId: string; sessionKey?: string; start: number; end?: number; status: string; error?: string; steps: Step[] };
const STATUS: Record<string, string> = { succeeded: "Done", failed: "Failed", cancelled: "Stopped", timed_out: "Timed out", blocked: "Blocked", started: "Running", unknown: "Unknown" };

/** Groups audit.list events into runs, each with its tool steps (start and finish pair up by toolCallId). */
export function runsFrom(events: RecordValue[]): Run[] {
  const runs = new Map<string, Run>();
  for (const e of [...events].sort((a, b) => Number(a.sequence) - Number(b.sequence))) {
    const id = str(e.runId);
    const run = runs.get(id) ?? { runId: id, agentId: str(e.agentId), sessionKey: str(e.sessionKey) || undefined, start: Number(e.occurredAt), status: "started", steps: [] };
    runs.set(id, run);
    run.start = Math.min(run.start, Number(e.occurredAt));
    if (e.action === "agent.run.finished") { run.end = Number(e.occurredAt); run.status = str(e.status); run.error = str(e.errorCode) || undefined; }
    if (e.kind !== "tool_action") continue;
    const key = str(e.toolCallId) || str(e.eventId);
    let step = run.steps.find((s) => s.id === key);
    if (!step) { step = { id: key, name: str(e.toolName) || "tool", start: Number(e.occurredAt), status: "started" }; run.steps.push(step); }
    if (e.action === "tool.action.finished") { step.end = Number(e.occurredAt); step.status = str(e.status); step.error = str(e.errorCode) || undefined; }
  }
  return [...runs.values()].sort((a, b) => b.start - a.start);
}
export function secs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "";
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function TraceDialog({ engine, onClose }: { engine: SettingsPageProps["engine"]; onClose: () => void }) {
  const audit = useLive<RecordValue>(engine, "audit.list", { limit: 500 }, []);
  const [older, setOlder] = useState<{ events: RecordValue[]; cursor?: string }>({ events: [] });
  const more = useCall();
  const cursor = older.events.length ? older.cursor : str(rec(audit.data).nextCursor) || undefined;
  const loadMore = () => void more.run(() => engine.request<RecordValue>("audit.list", { limit: 500, cursor }), (r) => { setOlder({ events: [...older.events, ...list(rec(r).events)], cursor: str(rec(r).nextCursor) || undefined }); return undefined; });
  const [filter, setFilter] = useState("all");
  const [pick, setPick] = useState("");
  const runs = useMemo(() => runsFrom([...list(rec(audit.data).events), ...older.events]), [audit.data, older.events]);
  const shownRuns = filter === "err" ? runs.filter((r) => r.status !== "succeeded" && r.status !== "started") : runs;
  const run = shownRuns.find((r) => r.runId === pick) ?? shownRuns[0];
  return (
    <Dialog title="Runs and traces" wide onClose={onClose}>
      <div className="s2developer-dlg">
        <Seg label="Runs and traces" value="runs" onChange={() => undefined} options={[{ id: "runs", label: "Runs" }, { id: "overview", label: "Overview", off: ne("run overview") }, { id: "versions", label: "Instructions over time", off: ne("instruction history") }]} />
        {audit.error ? <p className="hint s2-err" role="alert">{audit.error}</p> : null}
        <div className="s2developer-tr">
          <div className="s2developer-list">
            <Seg label="Which runs" value={filter} onChange={setFilter} options={[{ id: "all", label: "All" }, { id: "chat", label: "From chat apps", off: ne("run sources") }, { id: "err", label: "With errors" }, { id: "browser", label: "Browser", off: ne("run sources") }]} />
            {audit.data && !shownRuns.length ? <Empty>No runs recorded yet.</Empty> : null}
            <div className="s2developer-runs">
              {shownRuns.map((r) => (
                <button key={r.runId} type="button" className="s2developer-run" aria-pressed={r === run} onClick={() => setPick(r.runId)}>
                  <span className="grow"><b>{`Run · ${r.agentId}`}</b><small>{[when(r.start), secs(r.end !== undefined ? r.end - r.start : undefined), `${r.steps.length} ${r.steps.length === 1 ? "step" : "steps"}`].filter(Boolean).join(" · ")}</small></span>
                  <span className={r.status === "succeeded" ? "s2developer-ok" : "s2developer-bad"}>{STATUS[r.status] ?? r.status}</span>
                </button>
              ))}
            </div>
            {cursor ? <Btn sm ghost disabled={more.busy} onClick={loadMore}>Load older runs</Btn> : null}
            <CallLine call={more} />
          </div>
          {run ? <RunView run={run} /> : null}
        </div>
      </div>
    </Dialog>
  );
}

function runMarkdown(run: Run): string {
  const head = `# Run · ${run.agentId}\n\n${when(run.start)} · ${STATUS[run.status] ?? run.status}${run.end ? ` · ${secs(run.end - run.start)}` : ""}\n`;
  return head + run.steps.map((s) => `\n- ${s.name}: ${STATUS[s.status] ?? s.status}${s.end ? `, ${secs(s.end - s.start)}` : ""}${s.error ? ` (${s.error})` : ""}`).join("");
}

function RunView({ run }: { run: Run }) {
  const [sel, setSel] = useState("run");
  const total = Math.max(1, (run.end ?? Math.max(run.start, ...run.steps.map((s) => s.end ?? s.start))) - run.start);
  const bar = (start: number, end: number | undefined) => ({ left: `${((start - run.start) / total) * 100}%`, width: `${Math.max(2, (((end ?? start) - start) / total) * 100)}%` });
  const step = run.steps.find((s) => s.id === sel);
  return (
    <div className="s2developer-one">
      <div className="s2developer-runh"><b>{`Run · ${run.agentId}`}</b><small>{[run.sessionKey, when(run.start)].filter(Boolean).join(" · ")}</small></div>
      <Acts>
        <Btn sm disabled title={ne("run replay")}>Step through it</Btn>
        <CopyBtn text={runMarkdown(run)} label="Copy as Markdown" />
        <Btn sm disabled title={ne("run comparison")}>Compare with an earlier run</Btn>
        <Btn sm disabled title={ne("run records")}>Check the record</Btn>
      </Acts>
      <div className="s2developer-split">
        <div className="s2developer-tree" role="tree">
          <button type="button" role="treeitem" className="s2developer-span k-run" aria-selected={sel === "run"} onClick={() => setSel("run")}>
            <span className="s2developer-sn">{`Run · ${run.agentId}`}</span><span className="s2developer-bar"><i style={bar(run.start, run.end ?? run.start + total)} /></span><span className="s2developer-len">{secs(run.end !== undefined ? run.end - run.start : undefined)}</span>
          </button>
          {run.steps.map((s) => (
            <button key={s.id} type="button" role="treeitem" className="s2developer-span k-tool" style={{ ["--d" as string]: 1 }} aria-selected={sel === s.id} onClick={() => setSel(s.id)}>
              <span className="s2developer-sn">{s.name}</span><span className="s2developer-bar"><i style={bar(s.start, s.end)} /></span><span className="s2developer-len">{secs(s.end !== undefined ? s.end - s.start : undefined)}</span>
            </button>
          ))}
        </div>
        <div className="s2developer-detail">
          <Kv rows={step ? [["Step", step.name], ["Took", secs(step.end !== undefined ? step.end - step.start : undefined)], ["Status", STATUS[step.status] ?? step.status], ["Error", step.error ?? ""]]
            : [["Step", `Run · ${run.agentId}`], ["Took", secs(run.end !== undefined ? run.end - run.start : undefined)], ["Status", STATUS[run.status] ?? run.status], ["Error", run.error ?? ""], ["Run", run.runId]]} />
        </div>
      </div>
      <Hint>Model calls, what the model saw, files made and read, and the reasoning map need the engine’s span details; the record keeps runs and tool steps only.</Hint>
    </div>
  );
}

const VENDORS = ["Langfuse", "LangSmith", "Laminar", "Braintrust", "Datadog", "Arize Phoenix", "Arthur", "PostHog", "Sentry", "Confident AI", "Monocle", "NeMo Relay", "ClickHouse (keep traces here)"];
const OT = "diagnostics.otel";

/** An official exporter plugin from plugins.list: missing once the list says it isn't installed. */
function usePlugin(engine: SettingsPageProps["engine"], id: string): { missing: boolean; entry?: RecordValue } {
  const plugins = useLive<RecordValue>(engine, "plugins.list", {}, ["plugins"]);
  const entry = list(rec(plugins.data).plugins).find((p) => p.id === id);
  return { missing: Boolean(plugins.data) && (!entry || entry.installed === false), entry };
}

function DestsDialog({ engine, config, base, onClose }: Ctx & { onClose: () => void }) {
  const otel = rec(config.get(OT));
  const on = otel.enabled === true;
  const rate = typeof otel.sampleRate === "number" ? otel.sampleRate : 1;
  const otelPlugin = usePlugin(engine, "diagnostics-otel");
  const promPlugin = usePlugin(engine, "diagnostics-prometheus");
  const prom = config.get("plugins.entries.diagnostics-prometheus.enabled") === true || promPlugin.entry?.state === "enabled";
  const setOtel = (v: boolean) => { void config.set(`${OT}.enabled`, v); if (v) void config.set("plugins.entries.diagnostics-otel.enabled", true); };
  return (
    <Dialog title="Where traces go" wide onClose={onClose}>
      <div className="s2developer-dlg">
        <Hint>Every run, model call and tool step goes as one stream to each destination you turn on. Off until you choose: it sends data outside Branch.</Hint>
        <div className="s2developer-dests">
          <div className="s2developer-dest">
            <Ctl title="OpenTelemetry" sub={otelPlugin.missing ? "Needs its plugin: branch plugins install @branch/diagnostics-otel" : on ? str(otel.endpoint) || "No address set yet." : "Off"}><Switch label="OpenTelemetry" checked={on} disabled={config.loading} onChange={setOtel} /></Ctl>
            {on ? <Field label="OpenTelemetry address" value={str(otel.endpoint)} placeholder="http://127.0.0.1:4318" onCommit={(v) => void config.set(`${OT}.endpoint`, v.trim() || null)} /> : null}
          </div>
          {VENDORS.map((v) => <div key={v} className="s2developer-dest"><Ctl title={v} off={ne(`${v} exporter`)}><Switch label={v} checked={false} onChange={() => undefined} /></Ctl></div>)}
        </div>
        <Ctl title="Which runs to keep" sub="Sampling happens before anything is sent.">
          <Seg label="Which runs to keep" value={rate === 1 ? "all" : rate === 0.1 ? "ten" : ""} disabled={config.loading} onChange={(v) => void config.set(`${OT}.sampleRate`, v === "all" ? null : 0.1)}
            options={[{ id: "all", label: "All" }, { id: "ten", label: "1 in 10" }, { id: "err", label: "Only errors", off: ne("error-only sampling") }]} />
        </Ctl>
        <Ctl title="Leave out message text" sub="Sends timings, counts and names only."><Switch label="Leave out message text" checked={otel.captureContent !== true} disabled={config.loading} onChange={(v) => void config.set(`${OT}.captureContent`, !v)} /></Ctl>
        <Ctl title="Also trace the server, database and outside calls" sub="Off until you choose: many more spans." off={ne("server tracing")}><Switch label="Also trace the server, database and outside calls" checked={false} onChange={() => undefined} /></Ctl>
        <Ctl title="Counters at /metrics" sub={`Conversations, words, cost, tool use and queue sizes for Prometheus at ${base}/api/diagnostics/prometheus. Off until you choose: anything on this computer can read them.${promPlugin.missing ? " Needs its plugin: branch plugins install @branch/diagnostics-prometheus" : ""}`}>
          <Switch label="Counters at /metrics" checked={prom} disabled={config.loading} onChange={(v) => void config.set("plugins.entries.diagnostics-prometheus.enabled", v)} />
        </Ctl>
        <Ctl title="A viewer on this computer" sub="Starts a local trace collector for Jaeger and Grafana." help="Starts a local collector with Jaeger; grafana.yml starts Tempo, Prometheus and Grafana." off={ne("local collector files")} />
        <Hint>{on ? `Traces go to ${str(otel.endpoint) || "the OpenTelemetry address"}.` : "Nothing is sent."}</Hint>
      </div>
    </Dialog>
  );
}

function SentDialog({ config, onClose }: { config: Config; onClose: () => void }) {
  const on = config.get("telemetry.enabled") === true;
  return (
    <Dialog title="What was sent" onClose={onClose}>
      <div className="s2developer-dlg">
        <Hint>Every count Branch shares is written here first, on this computer.</Hint>
        <pre className="s2developer-pre">{on ? "Feature counts go with the daily update check: the chat apps and services that are on, how many plugins, and how many recent conversations." : "Nothing has been sent. “Share anonymous feature counts” is off."}</pre>
        {on ? <Hint>{ne("record of what was sent")}</Hint> : null}
      </div>
    </Dialog>
  );
}

/* ───────────── Troubleshooting, more ───────────── */

const MORE_OFF: OffRow[] = [
  ["Tell the Trunk about recent errors", "So it can work around them instead of trying the same thing.", ne("error hints for Trunks"), "sw"],
  ["Tell me when one repeats", "When the same error keeps coming back, it shows in Inbox.", ne("repeated-error alerts"), "sw"],
  ["How the last start went", "Each start phase and its time, and how Branch is doing at rest.", ne("start-up timeline"), "btn:Show"],
  ["Show frame rate", "A small meter in the corner of this window while you look for slow screens.", APP, "sw"],
  ["Database shell", "A SQL prompt on the conversation store. Stop the Gateway first for anything that writes.", "The branch command has no database shell yet."],
  ["Developer tools", "Network, console and the window’s state.", APP, "btn:Open"],
  ["Repair the branch command", "For when typing branch in a terminal stopped working.", "The Branch app’s installer repairs it.", "btn:Repair"],
];
rowsOf("Troubleshooting, more", ["A summary for a bug report", "Where each setting comes from", "Warnings since the start", ...titles(MORE_OFF.slice(0, 2)), "Look into a problem", ...titles(MORE_OFF.slice(2))]);

/** Look into a problem: starts a conversation with the default Trunk about what went wrong. */
function LookInto() {
  const ask = useAsk();
  const [text, setText] = useState("");
  const t = "Look into a problem";
  const go = () => { if (ask && text.trim()) { ask(`Something went wrong in Branch: ${text.trim()}. Please look into it.`); setText(""); } };
  return (
    <Ctl title={t} sub="Sapling looks into it in your conversation." off={ask ? undefined : "Needs a model set up first."}>
      <input className="inp" aria-label="What went wrong" placeholder="Replies stopped after lunch" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
      <Btn sm onClick={go}>Look into it</Btn>
    </Ctl>
  );
}

/** The bug-report summary: version, machine, gateway and the settings file path, no keys. */
async function summary(engine: SettingsPageProps["engine"], version: string): Promise<string> {
  const [sys, cfg] = await Promise.all([engine.request<RecordValue>("system.info", {}), engine.request<RecordValue>("config.get", {})]);
  const i = rec(sys); const c = rec(cfg); const g = rec(rec(c.config).gateway);
  return [version ? `Branch ${versionParts(version).detail}` : "Branch version unavailable", `${str(i.osLabel) || str(i.platform)} ${str(i.arch)} · Node ${str(i.nodeVersion)}`.trim(),
    `Gateway ${str(g.bind) || "loopback"}:${str(g.port) || DEFAULT_PORT} · sign-in ${str(rec(g.auth).mode) || "token"} · process ${str(i.pid)}`,
    `Model ${shown(rec(rec(rec(c.config).agents).defaults).model)}`, `Settings file ${str(c.path)}${c.valid === false ? " (has problems)" : ""}`].join("\n");
}

export function TroubleMore(ctx: Ctx) {
  const version = useBranchVersion(ctx.engine.gatewayUrl);
  const [dlg, setDlg] = useState<Dlg>("");
  const copy = useCall();
  const warn = useLive<RecordValue>(ctx.engine, "diagnostics.stability", { limit: 1000 }, []);
  const count = warningsOf(list(rec(warn.data).events)).length;
  const go = () => void copy.run(async () => { await navigator.clipboard.writeText(await summary(ctx.engine, version)); return true; }, () => "Copied.");
  return (
    <Sec title="Troubleshooting, more" group="Troubleshooting">
      <Ctl title="A summary for a bug report" sub={copy.error ?? copy.note ?? "Version, model, gateway, paths and settings file, on one paste."}><Btn sm disabled={copy.busy} onClick={go}>Copy</Btn></Ctl>
      <Ctl title="Where each setting comes from" sub="Every setting with its value and the layer it came from."><Btn sm onClick={() => setDlg("cfgsrc")}>Show</Btn></Ctl>
      <Ctl title="Warnings since the start" sub={warn.error ?? (warn.data ? `${count} kept, each with its kind and error id.` : "Each with its kind and error id.")}><Btn sm onClick={() => setDlg("warnings")}>See them</Btn></Ctl>
      <Greyed rows={MORE_OFF.slice(0, 2)} />
      <LookInto />
      <Greyed rows={MORE_OFF.slice(2)} />
      {dlg === "cfgsrc" ? <SourceDialog engine={ctx.engine} onClose={() => setDlg("")} /> : null}
      {dlg === "warnings" ? <WarningsDialog events={list(rec(warn.data).events)} error={warn.error} onReload={() => void warn.reload()} onClose={() => setDlg("")} /> : null}
    </Sec>
  );
}

/** Where each setting comes from: a value the settings file names is "Your settings file"; anything else is the default. */
function SourceDialog({ engine, onClose }: { engine: SettingsPageProps["engine"]; onClose: () => void }) {
  const cfg = useLive<RecordValue>(engine, "config.get", {}, ["config"]);
  const [q, setQ] = useState("");
  const c = rec(cfg.data);
  const authored = new Set(leaves(c.resolved ?? c.sourceConfig).map(([p]) => p.join(".")));
  const rows = leaves(c.config).map(([p, v]) => [p.join("."), shown(v), authored.has(p.join(".")) ? "Your settings file" : "Default"] as const).filter(([p]) => !q || p.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog title="Where each setting comes from" wide onClose={onClose}>
      <div className="s2developer-dlg">
        <Seg label="Which" value="settings" onChange={() => undefined} options={[{ id: "settings", label: "Settings" }, { id: "more", label: "Skills, hooks and connectors", off: ne("layer list for skills, hooks and connectors") }]} />
        <Hint>Later layers win: the default, then the settings file. Keys and passwords show as dots.</Hint>
        <input className="inp" aria-label="Filter settings" placeholder="Filter settings" value={q} onChange={(e) => setQ(e.target.value)} />
        {cfg.error ? <p className="hint s2-err" role="alert">{cfg.error}</p> : null}
        <div className="s2developer-scroll">
          <table className="s2developer-tbl"><thead><tr><th>Setting</th><th>Value</th><th>From</th></tr></thead>
            <tbody>{rows.map(([p, v, from]) => <tr key={p}><th><code>{p}</code></th><td>{v}</td><td>{from}</td></tr>)}</tbody></table>
        </div>
        <Ctl title="The settings file is managed elsewhere" sub="Branch reads these files but never writes them." help="Branch reads it but never writes it, for files kept by Nix or your organisation. Changes made here last until a restart." off={ne("read-only settings mode")}><Switch label="The settings file is managed elsewhere" checked={false} onChange={() => undefined} /></Ctl>
      </div>
    </Dialog>
  );
}

const BAD = /error|fail|warn|timeout|timed_out|denied|rejected|dropped|stall|blocked/i;
/** Events from diagnostics.stability that are warnings or errors. */
export function warningsOf(events: RecordValue[]): RecordValue[] {
  return events.filter((e) => Boolean(e.errorCategory) || BAD.test(str(e.level)) || BAD.test(str(e.outcome)) || BAD.test(str(e.type)) || e.timedOut === true);
}

function WarningsDialog({ events, error, onReload, onClose }: { events: RecordValue[]; error?: string; onReload: () => void; onClose: () => void }) {
  const warns = warningsOf(events).reverse();
  return (
    <Dialog title="Warnings since the start" wide onClose={onClose} footer={<><Btn ghost onClick={onReload}>Check again</Btn></>}>
      <div className="s2developer-dlg">
        <Hint>Kept here instead of scrolling away. Each id matches its line in the log.</Hint>
        {error ? <p className="hint s2-err" role="alert">{error}</p> : !warns.length ? <Empty>No warnings since the start.</Empty> : null}
        <div className="s2developer-warns">
          {warns.map((e) => (
            <div key={str(e.seq)} className="s2developer-wrow">
              <span className="s2developer-tag">{str(e.type).split(".")[0]}</span>
              <span className="grow"><b>{[str(e.type), str(e.reason) || str(e.errorCategory) || str(e.outcome), str(e.toolName) || str(e.channel) || str(e.pluginId) || str(e.provider)].filter(Boolean).join(" · ")}</b>
                <small>{new Date(Number(e.ts)).toLocaleTimeString()} · <code>{`#${str(e.seq)}`}</code></small></span>
              <CopyBtn text={`#${str(e.seq)}`} label="Copy id" />
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/* ───────────── Troubleshooting ───────────── */

const TROUBLE_OFF: OffRow[] = [
  ["Connection log", "Every step of connecting: state changes, messages and where the sign-in came from.", "The window’s connection log is kept by the Branch app.", "btn:Open"],
  ["Copy for support", "Plain text with keys left out.", "", ""],
  ["Ports", "Which programs hold the gateway and tunnel ports.", APP, "btn:Check ports"],
  ["App process", "", APP], ["Program file", "", APP],
  ["Engine folder", "Used to find Node and fill PATH when starting the gateway.", APP, "btns:Change|Reset"],
  ["Conversation store", "The Branch service tile’s “Process” on Advanced is the gateway’s; these are the window’s own.", APP, "btn:Change"],
];
rowsOf("Troubleshooting", [...titles(TROUBLE_OFF), "Processor profile", "Memory profile", "Full memory snapshot", "System busyness", "Try a computer command"]);
const APP_BTNS = ["Open the conversation store", "Show Branch in Explorer", "Send a test notification", "Send a test check-in", "Send a test voice message", "Show the pairing panel"];

export function Troubleshooting(ctx: Ctx) {
  const { engine } = ctx;
  const version = useBranchVersion(engine.gatewayUrl);
  const [dlg, setDlg] = useState<Dlg>("");
  const support = useCall(); const open = useCall(); const cpu = useCall(); const heap = useCall(); const snap = useCall();
  const copySupport = () => void support.run(async () => { await navigator.clipboard.writeText(await summary(engine, version)); return true; }, () => "Copied.");
  const openFile = () => void open.run(() => engine.request<RecordValue>("config.openFile", {}), (r) => { if (rec(r).ok === false) throw new Error(str(rec(r).error)); return `Opened ${str(rec(r).path)}.`; });
  return (
    <Sec title="Troubleshooting" showHeading={false}>
      <Greyed rows={TROUBLE_OFF.slice(0, 1)} />
      <Ctl title="Copy for support" sub={support.error ?? support.note ?? "Plain text with keys left out."}><Btn sm disabled={support.busy} onClick={copySupport}>Copy…</Btn></Ctl>
      <Greyed rows={TROUBLE_OFF.slice(2)} />
      <div className="acts s2developer-acts"><Btn sm disabled title={APP}>Restart the app</Btn><Btn sm data-testid="run-setup-again" onClick={rerunSetup}>Run setup again</Btn></div>
      <div className="acts s2developer-acts"><Btn sm ghost onClick={openFile} disabled={open.busy}>Open the settings file</Btn>{APP_BTNS.slice(0, 2).map((b) => <Btn key={b} sm ghost disabled title={APP}>{b}</Btn>)}</div>
      <CallLine call={open} />
      <div className="acts s2developer-acts">{APP_BTNS.slice(2).map((b) => <Btn key={b} sm ghost disabled title={APP}>{b}</Btn>)}</div>
      <Ctl title="Processor profile" sub={cpu.error ?? cpu.note ?? "Owner and Admins only. Saves a file on this computer."}>
        <Btn sm disabled={cpu.busy} onClick={() => void cpu.run(() => engine.request("diagnostics.cpuProfile", {}), (r) => { download("branch.cpuprofile", r); return "Saved branch.cpuprofile."; })}>{cpu.busy ? "Recording…" : "Record 5 s"}</Btn>
      </Ctl>
      <Ctl title="Memory profile" sub={heap.error ?? heap.note}>
        <Btn sm disabled={heap.busy} onClick={() => void heap.run(() => engine.request("diagnostics.heapProfile", {}), (r) => { download("branch.heapprofile", r); return "Saved branch.heapprofile."; })}>{heap.busy ? "Recording…" : "Record"}</Btn>
      </Ctl>
      <Ctl title="Full memory snapshot" sub={snap.error ?? snap.note ?? "Branch may pause while it writes this. It is saved only on this computer."}>
        <Btn sm disabled={snap.busy} onClick={() => void snap.run(() => engine.request<RecordValue>("diagnostics.heapSnapshot", { reason: "settings" }), (r) => `Saved ${str(rec(r).path)} (${bytes(rec(r).sizeBytes)}).`)}>{snap.busy ? "Writing…" : "Take one"}</Btn>
      </Ctl>
      <Ctl title="System busyness"><Btn sm onClick={() => setDlg("lanes")}>Open</Btn></Ctl>
      <Ctl title="Try a computer command" sub="Send one command to a lent computer or phone and see what it answers."><Btn sm onClick={() => setDlg("node")}>Open</Btn></Ctl>
      {dlg === "lanes" ? <LanesDialog engine={engine} onClose={() => setDlg("")} /> : null}
      {dlg === "node" ? <NodeDialog engine={engine} onClose={() => setDlg("")} /> : null}
    </Sec>
  );
}

/** System busyness: diagnostics.lanes (command lanes and worker pools) as the engine answers it. */
function LanesDialog({ engine, onClose }: { engine: SettingsPageProps["engine"]; onClose: () => void }) {
  const lanes = useLive<RecordValue>(engine, "diagnostics.lanes", {}, []);
  const d = rec(lanes.data);
  const rows = Object.entries(d).filter(([k]) => k !== "ts");
  return (
    <Dialog title="System busyness" wide onClose={onClose} footer={<><Btn ghost onClick={() => void lanes.reload()}>Check again</Btn></>}>
      {lanes.error ? <p className="hint s2-err" role="alert">{lanes.error}</p> : null}
      {d.ts ? <Hint>As of {when(d.ts)}.</Hint> : null}
      {rows.map(([k, v]) => <div key={k}><h3 className="s2-h3">{k}</h3><pre className="s2developer-pre">{JSON.stringify(v, null, 2)}</pre></div>)}
    </Dialog>
  );
}

/** Try a computer command: node.list for the computers and their commands, node.invoke for one call. */
function NodeDialog({ engine, onClose }: { engine: SettingsPageProps["engine"]; onClose: () => void }) {
  const nodes = useLive<RecordValue>(engine, "node.list", {}, ["node"]);
  const all = list(rec(nodes.data).nodes).filter((n) => n.connected !== false);
  const [nodeId, setNode] = useState("");
  const [command, setCommand] = useState("");
  const [details, setDetails] = useState("{}");
  const call = useCall();
  const node = all.find((n) => str(n.nodeId) === nodeId) ?? all[0];
  const cmds = Array.isArray(node?.commands) ? node.commands.map(String) : [];
  const parsed = parseJson(details);
  const run = () => { if (!node || !parsed.ok) return; void call.run(() => engine.request("node.invoke", { nodeId: str(node.nodeId), command: command || cmds[0], params: parsed.value, idempotencyKey: crypto.randomUUID() }), (r) => JSON.stringify(r, null, 2)); };
  return (
    <Dialog title="Try a computer command" onClose={onClose} footer={<><Btn pri disabled={!node || !(command || cmds[0]) || !parsed.ok || call.busy} onClick={run}>Run</Btn></>}>
      {nodes.error ? <p className="hint s2-err" role="alert">{nodes.error}</p> : nodes.data && !all.length ? <Empty>No computer or phone is connected.</Empty> : null}
      <div className="s2-field"><label htmlFor="s2dev-node">Computer</label>
        <select id="s2dev-node" className="inp" value={str(node?.nodeId)} onChange={(e) => setNode(e.target.value)}>{all.map((n) => <option key={str(n.nodeId)} value={str(n.nodeId)}>{str(n.displayName) || str(n.nodeId)}</option>)}</select></div>
      <div className="s2-field"><label htmlFor="s2dev-cmd">Command</label>
        <input id="s2dev-cmd" className="inp" list="s2dev-cmds" value={command} placeholder={cmds[0] ?? "system.notify"} onChange={(e) => setCommand(e.target.value)} />
        <datalist id="s2dev-cmds">{cmds.map((c) => <option key={c} value={c} />)}</datalist></div>
      <div className="s2-field"><label htmlFor="s2dev-det">Details</label><textarea id="s2dev-det" className="inp s2developer-mono" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} /></div>
      {!parsed.ok ? <p className="hint s2-err">Details must be JSON: {parsed.error}</p> : null}
      {call.error ? <p className="hint s2-err" role="alert">{call.error}</p> : call.note ? <pre className="s2developer-pre">{call.note}</pre> : null}
      <Hint>From a terminal: <code>branch nodes invoke</code></Hint>
    </Dialog>
  );
}

/* ───────────── Settings file editor ───────────── */

const SECTION_NAMES: [string, string, string][] = [
  ["session", "Conversations", "Branch itself"], ["logging", "Logs", "Advanced"], ["telemetry", "Feature counts", "Advanced"], ["memory", "Memory", "Advanced"],
  ["agents", "Trunk defaults", "Advanced"], ["cron", "Schedules", "Advanced"], ["tools", "Tools", "Advanced"], ["skills", "Skills", "Advanced"], ["plugins", "Plugins", "Advanced"],
  ["proxy", "Network", "Advanced"], ["wizard", "Setup", "Advanced"], ["gateway", "Gateway", "Developer"], ["env", "Launch variables", "Developer"], ["commands", "Chat commands", "Developer"],
  ["diagnostics", "Diagnostics", "Developer"], ["discovery", "Finding Branch", "Developer"], ["mcp", "Connectors", "Developer"], ["worktreeRoot", "Working copies", "Developer"],
  ["tts", "Text to speech", "Everything else"], ["attachments", "Attachments", "Everything else"], ["messages", "Messages", "Everything else"], ["talk", "Talk", "Everything else"],
  ["hooks", "Hooks", "Everything else"], ["bindings", "Which Trunk answers", "Everything else"],
];

export function EditorDialog({ engine, config, onClose }: { engine: SettingsPageProps["engine"]; config: Config; onClose: () => void }) {
  const file = useLive<RecordValue>(engine, "config.get", {}, ["config"]);
  const f = rec(file.data);
  const [view, setView] = useState("form");
  const open = useCall();
  const openFile = () => void open.run(() => engine.request<RecordValue>("config.openFile", {}), (r) => { if (rec(r).ok === false) throw new Error(str(rec(r).error)); return `Opened ${str(rec(r).path)}.`; });
  return (
    <Dialog title="Settings file" wide onClose={onClose} footer={<><Btn ghost disabled={open.busy} onClick={openFile}>Open the file</Btn></>}>
      <div className="s2developer-ed">
        <div className="s2developer-edtop"><span>{str(f.path)}</span><Seg label="View" value={view} onChange={setView} options={[{ id: "form", label: "Form" }, { id: "text", label: "Text" }]} /></div>
        <CallLine call={open} />
        {file.error ? <p className="hint s2-err" role="alert">{file.error}</p> : null}
        {f.valid === false ? <Issues issues={f.issues} /> : null}
        {view === "text" ? <TextView engine={engine} file={f} onSaved={() => { void file.reload(); void config.reload(); }} /> : <FormView config={config} />}
      </div>
    </Dialog>
  );
}

function Issues({ issues }: { issues: unknown }) {
  const items = list(issues);
  return (
    <div className="s2developer-issues" role="alert">
      <b>The settings file has problems. The engine keeps its contents back until they are fixed in the file itself.</b>
      <ul>{items.map((i, n) => <li key={n}><code>{Array.isArray(i.path) ? i.path.join(".") : str(i.path)}</code> {str(i.message)}</li>)}</ul>
    </div>
  );
}

/** Text view: the whole file as the engine has it (hidden values stay hidden); saved with config.apply against its hash. */
function TextView({ engine, file, onSaved }: { engine: SettingsPageProps["engine"]; file: RecordValue; onSaved: () => void }) {
  const raw = typeof file.raw === "string" ? file.raw : "";
  const [draft, setDraft] = useState(raw);
  const save = useCall();
  useEffect(() => setDraft(raw), [raw]);
  const hidden = raw.split(HIDDEN).length - 1;
  const changed = draft !== raw;
  const go = () => void save.run(() => engine.request("config.apply", { raw: draft, ...(str(file.hash) ? { baseHash: str(file.hash) } : {}), note: "Settings › Developer › Settings file" }), () => { onSaved(); return "Saved. The Gateway restarts if a change needs it."; });
  if (file.valid === false) return <Hint>Fix the file itself, then open this again.</Hint>;
  return (
    <div className="s2developer-text">
      <Hint>{`${file.exists === false ? "There is no settings file yet; Branch is using its defaults. Saving makes one. " : ""}The whole settings file, as text (JSON5).${hidden ? ` ${hidden} hidden ${hidden === 1 ? "value stays" : "values stay"} hidden; leave ${hidden === 1 ? "it" : "them"} as ${hidden === 1 ? "it is" : "they are"} and Branch keeps ${hidden === 1 ? "it" : "them"}.` : ""}`}</Hint>
      <textarea className="inp s2developer-mono s2developer-edtext" aria-label="Settings file" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} />
      <Acts><span className="s2developer-st">{save.busy ? "Saving…" : changed ? "Not saved" : "Saved"}</span><Btn sm ghost disabled={!changed} onClick={() => { setDraft(raw); save.clear(); }}>Discard</Btn><Btn sm pri disabled={!changed || save.busy} onClick={go}>Save</Btn></Acts>
      <CallLine call={save} />
    </div>
  );
}

/** Form view: each top-level section of the settings, its values drawn as switches, numbers and text; lists and
 *  hidden values are shown, not edited here. Each change saves at once (config.patch). */
function FormView({ config }: { config: Config }) {
  const [q, setQ] = useState("");
  const keys = Object.keys(config.cfg).filter((k) => k !== "meta");
  const named = new Map(SECTION_NAMES.map(([k, l, g]) => [k, [l, g] as const]));
  const groups = ["Branch itself", "Advanced", "Developer", "Everything else"];
  const all = keys.map((k) => ({ k, l: named.get(k)?.[0] ?? k, g: named.get(k)?.[1] ?? "Everything else" })).filter((s) => !q || `${s.k} ${s.l}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => groups.indexOf(a.g) - groups.indexOf(b.g));
  const [sel, setSel] = useState("");
  const cur = all.find((s) => s.k === sel) ?? all[0];
  return (
    <div className="s2developer-edgrid">
      <nav className="s2developer-ednav" aria-label="Sections">
        <input className="inp" aria-label="Filter sections" placeholder="Filter sections" value={q} onChange={(e) => setQ(e.target.value)} />
        {groups.map((g) => all.some((s) => s.g === g) ? <div key={g} className="s2developer-edgrp"><div className="grp">{g}</div>
          {all.filter((s) => s.g === g).map((s) => <button key={s.k} type="button" className="nav" aria-current={s === cur} onClick={() => setSel(s.k)}>{s.l} <code>{s.k}</code></button>)}</div> : null)}
      </nav>
      <div className="s2developer-edmain">{cur ? <><h3 className="s2-h3">{cur.l} <code>{cur.k}</code></h3><Leaves config={config} k={cur.k} /></> : <Empty>No settings match.</Empty>}</div>
    </div>
  );
}

function Leaves({ config, k }: { config: Config; k: string }) {
  const rows = leaves({ [k]: config.cfg[k] });
  return <>{rows.map(([p, v]) => <Leaf key={p.join("\u0000")} config={config} path={p} value={v} />)}</>;
}
function Leaf({ config, path, value }: { config: Config; path: string[]; value: unknown }) {
  const title = path.slice(1).join(".") || path[0];
  if (typeof value === "boolean") return <Ctl title={title}><Switch label={title} checked={value} onChange={(v) => void config.set(path, v)} /></Ctl>;
  if (typeof value === "number") return <Ctl title={title}><Num label={title} value={value} min={-Infinity} onCommit={(v) => void config.set(path, v)} /></Ctl>;
  if (typeof value === "string" && value !== HIDDEN) return <Ctl title={title}><Field label={title} value={value} wide onCommit={(v) => void config.set(path, v)} /></Ctl>;
  return <Ctl title={title} sub={value === HIDDEN ? "Hidden. Change it in the text view or the file." : "A list or group; change it in the text view."}><code className="s2-code">{shown(value)}</code></Ctl>;
}

/* ───────────── Call the gateway, the event stream and the tool playground ───────────── */

const ACTIONS = ["health", "status", "system.info", "config.get", "sessions.list", "models.list", "update.status", "node.list", "tools.catalog"];

export function CallDialog({ engine, onClose }: { engine: SettingsPageProps["engine"]; onClose: () => void }) {
  const [method, setMethod] = useState("");
  const [values, setValues] = useState("{}");
  const call = useCall();
  const parsed = parseJson(values);
  const go = () => { if (parsed.ok) void call.run(() => engine.request(method.trim(), parsed.value), (r) => JSON.stringify(r, null, 2)); };
  return (
    <Dialog title="Call the gateway" onClose={onClose} footer={<><Btn pri disabled={!method.trim() || !parsed.ok || call.busy} onClick={go}>Call</Btn></>}>
      <div className="s2-field"><label htmlFor="s2dev-act">Action</label>
        <input id="s2dev-act" className="inp" list="s2dev-acts" value={method} placeholder="Pick an action" onChange={(e) => setMethod(e.target.value)} />
        <datalist id="s2dev-acts">{ACTIONS.map((a) => <option key={a} value={a} />)}</datalist></div>
      <div className="s2-field"><label htmlFor="s2dev-vals">Values (JSON)</label><textarea id="s2dev-vals" className="inp s2developer-mono" rows={4} value={values} onChange={(e) => setValues(e.target.value)} /></div>
      {!parsed.ok ? <p className="hint s2-err">Values must be JSON: {parsed.error}</p> : null}
      <Hint>Runs with your own rights, like the window.</Hint>
      {call.error ? <p className="hint s2-err" role="alert">{call.error}</p> : call.note ? <pre className="s2developer-pre s2developer-out">{call.note}</pre> : null}
    </Dialog>
  );
}

type Ev = { n: number; t: number; event: string; payload: unknown };
const KINDS: [string, RegExp][] = [["Tools", /tool/i], ["Replies", /chat|message|reply/i], ["Errors", /error|fail/i], ["Start and finish", /start|finish|run|lifecycle/i], ["Approvals", /approval|question/i], ["Changes", /changed|config|update/i]];
const kindOf = (e: string) => KINDS.find(([, re]) => re.test(e))?.[0] ?? "Other";

/** Events for your programs: every engine event this window receives while the dialog is open. */
export function EventsDialog({ engine, onClose }: { engine: SettingsPageProps["engine"]; onClose: () => void }) {
  const [evs, setEvs] = useState<Ev[]>([]);
  const [tab, setTab] = useState("trunks");
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState(-1);
  useEffect(() => engine.onEvent((e) => setEvs((list0) => [{ n: (list0[0]?.n ?? 0) + 1, t: Date.now(), event: e.event, payload: (e as { payload?: unknown }).payload }, ...list0].slice(0, 500))), [engine]);
  const trunk = (e: Ev) => /^(agent|chat|session|sessions|tool|approval|question)/.test(e.event);
  const inTab = evs.filter((e) => (tab === "trunks") === trunk(e));
  const counts = new Map<string, number>(); inTab.forEach((e) => counts.set(kindOf(e.event), (counts.get(kindOf(e.event)) ?? 0) + 1));
  const rows = inTab.filter((e) => !kind || kindOf(e.event) === kind);
  return (
    <Dialog title="Event stream" wide onClose={onClose}>
      <Tabs label="Event stream" value={tab} onChange={(v) => { setTab(v); setKind(""); }} tabs={[{ id: "trunks", label: "Events" }, { id: "gateway", label: "Gateway" }]} />
      <Acts>{[...counts].map(([k, n]) => <button key={k} type="button" className="chip6" aria-pressed={kind === k} onClick={() => setKind(kind === k ? "" : k)}>{`${k} · ${n}`}</button>)}<Btn sm ghost onClick={() => setEvs([])}>Clear</Btn></Acts>
      {!rows.length ? <Empty>Nothing yet. Events show here as they happen while this is open.</Empty> : null}
      <div className="rows">
        {rows.map((e) => (
          <div key={e.n}>
            <button type="button" className="prow s2developer-evrow" aria-expanded={open === e.n} onClick={() => setOpen(open === e.n ? -1 : e.n)}>
              <time>{new Date(e.t).toLocaleTimeString()}</time><span className="grow"><b>{e.event}</b><small>{kindOf(e.event)}</small></span>
            </button>
            {open === e.n ? <pre className="s2developer-pre">{JSON.stringify(e.payload, null, 2)}</pre> : null}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** Tool playground: pick a tool from tools.catalog, fill its parameters, run it with tools.invoke under the usual approvals. */
export function PlaygroundDialog({ engine, onClose }: { engine: SettingsPageProps["engine"]; onClose: () => void }) {
  const cat = useLive<RecordValue>(engine, "tools.catalog", {}, []);
  const tools = list(rec(cat.data).groups).flatMap((g) => list(g.tools));
  const [id, setId] = useState("");
  const [args, setArgs] = useState<Record<string, string>>({});
  const call = useCall();
  const tool = tools.find((t) => str(t.id) === id) ?? tools[0];
  const params = list(tool?.parameters);
  const run = () => { if (tool) void call.run(() => engine.request("tools.invoke", { name: str(tool.id), args: Object.fromEntries(Object.entries(args).filter(([, v]) => v !== "").map(([k, v]) => [k, parseJson(v).ok ? (parseJson(v) as { value: unknown }).value : v])), confirm: true, idempotencyKey: crypto.randomUUID() }), (r) => JSON.stringify(r, null, 2)); };
  return (
    <Dialog title="Tool playground" onClose={onClose} footer={<><Btn pri disabled={!tool || call.busy} onClick={run}>{tool ? `Run ${str(tool.id)}` : "Run"}</Btn></>}>
      <p>Run one tool by hand, under the same approval rules a task has.</p>
      {cat.error ? <p className="hint s2-err" role="alert">{cat.error}</p> : null}
      <div className="s2-field"><label htmlFor="s2dev-tool">Tool</label>
        <select id="s2dev-tool" className="inp" value={str(tool?.id)} onChange={(e) => { setId(e.target.value); setArgs({}); call.clear(); }}>{tools.map((t) => <option key={str(t.id)} value={str(t.id)}>{str(t.label) || str(t.id)}</option>)}</select></div>
      {tool ? <Hint>{str(tool.description)}</Hint> : null}
      {params.map((p) => <Ctl key={str(p.name)} title={str(p.name)} sub={[str(p.description), p.required === true ? "Required." : ""].filter(Boolean).join(" ")}><input className="inp" aria-label={str(p.name)} value={args[str(p.name)] ?? ""} placeholder={str(p.type)} onChange={(e) => setArgs({ ...args, [str(p.name)]: e.target.value })} /></Ctl>)}
      {call.error ? <p className="hint s2-err" role="alert">{call.error}</p> : call.note ? <pre className="s2developer-pre s2developer-out">{call.note}</pre> : null}
    </Dialog>
  );
}
