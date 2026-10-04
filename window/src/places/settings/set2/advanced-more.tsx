// Settings › Advanced, the row kit: most rows are one engine config path drawn as a switch, number, segment, pick,
// text or list (saved at once through config.patch, empty = the engine's own default). A row the engine can't back
// is drawn greyed with why. Plugin rows read plugins.list and save plugins.entries.<id>.enabled.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState, type ReactNode } from "react";
import type { SettingsPageProps } from "../index";
import { Btn, Ctl, Field, Num, Pick, Sec, Seg, Switch, useConfig, type Lv, type Opt, type RowEntry } from "../kit";
import type { ConfigPath } from "../config-store";
import { rec, str, type RecordValue } from "./common";

export type Config = ReturnType<typeof useConfig>;
/** What every Advanced row may read: the engine, its config, the level and the installed plugins. */
export type Ctx = SettingsPageProps & { config: Config; lv: Lv; agent: string; plugins: RecordValue[] };

/** One row. `k` is the config path it reads (and writes, unless `w` says where); `off` greys it with why. */
export type Spec = {
  t: string; s?: ReactNode; lv?: Lv; k?: ConfigPath; w?: ConfigPath;
  kind?: "sw" | "num" | "seg" | "pick" | "text" | "list" | "btn" | "none";
  def?: unknown; opts?: Opt[]; unit?: string; ph?: string; min?: number; max?: number;
  /** Stored value → shown value, and back (MB ↔ bytes, inverted switches). */
  read?: (v: unknown) => unknown; write?: (v: unknown, saved: unknown) => unknown;
  off?: string; btn?: string; add?: string; plug?: string; mono?: boolean;
  /** Greys a wired row for a moment (e.g. a switch that needs another one on first). */
  hold?: (c: Ctx) => string | undefined;
  /** A row drawn by its own component. */
  draw?: (c: Ctx) => ReactNode;
};
/** A section: its rows in order, or `whole` when one component draws it (its rows then only feed the search). */
export type SecSpec = { title: string; hint?: ReactNode; lv: Lv; rows: Spec[]; after?: (c: Ctx) => ReactNode; whole?: (c: Ctx) => ReactNode };

export const NOSET = "The engine has no setting for this.";
export const APP = "Set by the Branch app on this computer.";

/** The rows a section shows at this level. */
export const shown = (rows: Spec[], lv: Lv) => rows.filter((r) => (r.lv ?? 0) <= lv);

export function Section({ spec, c }: { spec: SecSpec; c: Ctx }) {
  if (spec.lv > c.lv) return null;
  if (spec.whole) return <>{spec.whole(c)}</>;
  return (
    <Sec title={spec.title} hint={spec.hint}>
      {shown(spec.rows, c.lv).map((r) => <Row key={r.t} r={r} c={c} />)}
      {spec.after?.(c)}
    </Sec>
  );
}

export function Row({ r, c }: { r: Spec; c: Ctx }) {
  if (r.draw) return <>{r.draw(c)}</>;
  if (r.off) return <Ctl title={r.t} sub={r.s} off={r.off}>{greyControl(r)}</Ctl>;
  if (r.plug) return <PlugRow r={r} c={c} />;
  const hold = r.hold?.(c);
  return <Ctl title={r.t} sub={hold ?? r.s} after={r.kind === "list" ? <ListEditor r={r} c={c} /> : undefined}>{r.kind === "list" ? null : <Control r={r} c={c} disabled={Boolean(hold)} />}</Ctl>;
}

/** The control a greyed row draws (inert), showing the engine's default where there is one. */
function greyControl(r: Spec): ReactNode {
  const noop = () => undefined;
  switch (r.kind ?? "sw") {
    case "sw": return <Switch label={r.t} checked={r.def === true} onChange={noop} />;
    case "num": return <Num label={r.t} value={typeof r.def === "number" ? r.def : undefined} unit={r.unit} placeholder={r.ph ?? "Default"} onCommit={noop} />;
    case "seg": return <Seg label={r.t} value={str(r.def) || r.opts?.[0]?.id || ""} options={r.opts ?? []} onChange={noop} />;
    case "pick": return <Pick label={r.t} value={str(r.def) || r.opts?.[0]?.id || ""} options={r.opts ?? []} onChange={noop} />;
    case "text": return <Field label={r.t} value="" placeholder={r.ph ?? "Not set"} onCommit={noop} />;
    case "btn": return <Btn sm>{r.btn}</Btn>;
    default: return null;
  }
}

/** The shown value of a wired row: the saved one, or the engine's default when nothing is saved. */
export function valueOf(r: Spec, config: Config): unknown {
  const raw = r.k ? config.get(r.k) : undefined;
  return r.read ? r.read(raw) : raw ?? r.def;
}

function Control({ r, c, disabled }: { r: Spec; c: Ctx; disabled: boolean }) {
  const { config } = c;
  const v = valueOf(r, config);
  const save = (next: unknown) => void config.set((r.w ?? r.k) as ConfigPath, next === null ? null : r.write ? r.write(next, r.k ? config.get(r.k) : undefined) : next);
  const off = disabled || config.loading;
  switch (r.kind ?? "sw") {
    case "sw": return <Switch label={r.t} checked={v === true} disabled={off} onChange={save} />;
    case "num": { const n = r.read ? r.read(r.k ? config.get(r.k) : undefined) : r.k ? config.get(r.k) : undefined; return <Num label={r.t} value={typeof n === "number" ? n : undefined} unit={r.unit} min={r.min} max={r.max} placeholder={r.ph ?? (typeof r.def === "number" ? r.def.toLocaleString("en-US") : undefined)} disabled={off} onCommit={save} />; }
    case "seg": return <Seg label={r.t} value={str(v)} options={r.opts ?? []} disabled={off} onChange={save} />;
    case "pick": return <Pick label={r.t} value={str(v)} options={r.opts ?? []} disabled={off} onChange={(x) => save(x === "" ? null : x)} />;
    case "text": return <span className={`s2advanced-txt${r.mono ? " s2advanced-tmono" : ""}`}><Field label={r.t} value={str(v)} placeholder={r.ph} disabled={off} onCommit={(x) => save(x.trim() || null)} /></span>;
    default: return null;
  }
}

/** A list of strings (folders, plugin ids, patterns): chips with ×, and an add field. */
export function ListEditor({ r, c }: { r: Spec; c: Ctx }) {
  const raw = r.k ? c.config.get(r.k) : undefined;
  const saved: unknown[] = Array.isArray(raw) ? raw : [];
  const items = saved.map((x) => (typeof x === "string" ? x : str(rec(x).path)));
  const [draft, setDraft] = useState("");
  const put = (next: unknown[]) => void c.config.set(r.k as ConfigPath, next.length ? next : null);
  const add = () => { const v = draft.trim(); if (!v || items.includes(v)) return; put([...saved, v]); setDraft(""); };
  return (
    <div className="s2advanced-lst">
      {items.length ? items.map((x, i) => <span key={`${x}-${i}`} className="chip6">{x}<button type="button" className="s2-x" aria-label={`Remove ${x}`} onClick={() => put(saved.filter((_, j) => j !== i))}>×</button></span>) : <span className="hint">Nothing here yet.</span>}
      <span className="s2advanced-add">
        <input className="inp s2advanced-mono" aria-label={`${r.t}: new item`} placeholder={r.ph} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <Btn sm disabled={c.config.loading} onClick={add}>{r.add ?? "Add"}</Btn>
      </span>
    </div>
  );
}

/** A plugin switch: on/off is the plugin's own entry (plugins.entries.<id>.enabled), read from plugins.list until saved. */
function PlugRow({ r, c }: { r: Spec; c: Ctx }) {
  const id = r.plug as string;
  const entry = c.plugins.find((p) => p.id === id);
  const saved = c.config.get(["plugins", "entries", id, "enabled"]);
  if (!entry && saved === undefined) return <Ctl title={r.t} sub={r.s} off="Its plugin isn’t installed in this engine."><Switch label={r.t} checked={false} onChange={() => undefined} /></Ctl>;
  const on = typeof saved === "boolean" ? saved : entry?.enabled === true;
  return <Ctl title={r.t} sub={r.s}><Switch label={r.t} checked={on} disabled={c.config.loading} onChange={(x) => void c.config.set(["plugins", "entries", id, "enabled"], x)} /></Ctl>;
}

/** The search-index rows of a list of sections. */
export function rowsOf(page: string, secs: SecSpec[]): RowEntry[] {
  return secs.flatMap((s) => s.rows.map((r) => ({ page, title: r.t, sec: s.title, lv: Math.max(s.lv, r.lv ?? 0) as Lv })));
}

const sw = (t: string, s: string, k: ConfigPath, def: boolean, extra: Partial<Spec> = {}): Spec => ({ t, s, k, def, kind: "sw", ...extra });
const no = (t: string, s: string, kind: Spec["kind"] = "sw", extra: Partial<Spec> = {}): Spec => ({ t, s, kind, off: NOSET, ...extra });
export const SPEC = { sw, no };

const MB = 1024 * 1024;
const LEVELS: Opt[] = [["silent", "Nothing"], ["fatal", "Fatal"], ["error", "Errors"], ["warn", "Warnings"], ["info", "Info"], ["debug", "Debug"], ["trace", "Trace"]].map(([id, label]) => ({ id, label }));
const auditOff = (c: Ctx) => (c.config.get("logging.audit.enabled") === false ? "Turn on “Keep an activity log” first." : undefined);
const onOff = (v: unknown) => (v ?? "off") !== "off";

export const SEEING: SecSpec = { title: "Seeing more", lv: 1, rows: [
  sw("Show the thinking", "Adds the model’s reasoning under each reply, folded.", "agents.defaults.reasoningDefault", false, { read: onOff, write: (on) => (on ? "on" : "off") }),
  sw("Show tool steps", "Each reply keeps a folded list of the tools it used. The ⋯ › View row overrides it for one window.", "agents.defaults.verboseDefault", false, { read: onOff, write: (on) => (on ? "on" : "off") }),
  no("Keep progress notes", "The short notes a Trunk writes between steps stay after it finishes. The ⋯ › View row overrides it for one window."),
  sw("Keep an activity log", "Every step, kept for 30 days on this computer.", "logging.audit.enabled", true),
  sw("Record who ran each task", "Keeps who started each run, from where, and what allowed it, for “What happened in this run”. Off until you choose: it records more about each person. Takes effect after the gateway restarts; records already kept stay readable until they are 30 days old.", "logging.audit.executionIdentity", false, { hold: auditOff }),
  { t: "Record messages", s: "Who sent what to whom and when, never the text. Takes effect after the gateway restarts.", k: "logging.audit.messages", def: "off", kind: "seg", hold: auditOff, opts: [{ id: "off", label: "Off" }, { id: "direct", label: "Direct messages" }, { id: "all", label: "All" }] },
  { t: "Send crash reports", s: "Only the error, never your conversations. Off until you choose: it sends the error outside this computer.", kind: "sw", off: "The engine doesn’t send crash reports." },
  sw("Share anonymous feature counts", "Counts only, never messages or names: once a day, with the update check, which chat apps and model services are on, how many plugins, and how many conversations were started. It stays off whenever DO_NOT_TRACK=1 is set on this computer. Off until you choose: it sends counts outside this computer.", "telemetry.enabled", false),
  { t: "Report for a bug", s: "A zip of status, health, recent log lines, the shape of your settings and the stability record. Passwords, keys and message text are left out. It stays on this computer until you share it. Not the same as “Send crash reports”, which sends only errors.", kind: "btn", btn: "Make a report", off: "Made from a terminal: branch gateway diagnostics export." },
  sw("Keep a stability record", "A small record of stalls and crashes, without message text, kept on this computer.", "diagnostics.enabled", true, { lv: 2 }),
] };

export const LOG_ROWS = {
  level: { t: "How much the log keeps", s: "Info is enough unless you are chasing a problem.", k: "logging.level", def: "info", kind: "pick", opts: LEVELS } as Spec,
  console: { t: "In the terminal", k: "logging.consoleLevel", def: "info", kind: "pick", opts: LEVELS } as Spec,
  size: { t: "Start a new file at", s: "Keeps the last five files.", k: "logging.maxFileBytes", kind: "num", unit: "MB", def: 100, min: 1, read: (v) => (typeof v === "number" ? Math.round(v / MB) : undefined), write: (v) => Number(v) * MB } as Spec,
  hide: { t: "Also hide these in logs", s: "Passwords, keys, tokens and card numbers are always hidden.", k: "logging.redactPatterns", kind: "list", ph: "a pattern, like invoice-\\d+" } as Spec,
};

export const COMMANDS: SecSpec = { title: "Commands", lv: 1, rows: [
  { t: "Where commands run", draw: (c) => <WhereRun c={c} /> },
  no("Shell", "Automatic: PowerShell on Windows, bash on Mac and Linux.", "pick", { opts: [{ id: "auto", label: "Automatic" }] }),
  { t: "Longest a command may run", s: "Never longer than the sealed box waits before closing for being idle.", k: "tools.exec.timeoutSeconds", kind: "num", unit: "seconds", def: 1800, min: 1 },
  { t: "Close an idle sealed box after", s: "It’s made again the next time it’s needed, and the Trunk is told.", k: "agents.defaults.sandbox.prune.idleHours", kind: "num", unit: "hours", def: 24, min: 0 },
  no("Shorten long output: most characters", "The start and the end are kept; the rest is saved to a file the Trunk can read.", "num", { unit: "characters" }),
  no("Shorten long output: most lines", "", "num", { unit: "lines" }),
  no("Longest line", "", "num", { unit: "characters" }),
  { t: "Compress output by command", s: "Git, npm, test runners and about 80 more keep their errors and drop the noise.", plug: "tokenjuice" },
  no("Sum up long output with a model", "Uses the model to make room. Off: output is shortened as above."),
  sw("Tell the Trunk when a background command finishes", "When it asked to be told, it carries on from the result.", "tools.exec.notifyOnExit", true),
  no("Keep background commands through a restart", "Running ones are picked up again after Branch restarts."),
  no("Ask before typing into a running program", "So a Trunk can’t quietly answer a password prompt."),
  no("Ask for each command inside a script", "Each program a script starts can be allowed or refused on its own.", "sw", { lv: 2 }),
  no("Password for sudo", "Asked in the window when a command needs it, kept only until the conversation ends.", "pick", { lv: 2, opts: [{ id: "ask", label: "Ask in the window" }, { id: "never", label: "Never use sudo" }] }),
  no("Wait for the shell to be ready", "Fixes for shells whose output arrives late.", "num", { lv: 2, unit: "seconds" }),
  no("Fix a missing end-of-line in zsh", "", "sw", { lv: 2 }),
] };

const GB = (v: unknown): unknown => {
  if (typeof v === "number") return Math.round((v / 1024 ** 3) * 10) / 10;
  const m = /^(\d+(?:\.\d+)?)\s*([kmgt]?)b?$/i.exec(str(v));
  if (!m) return undefined;
  const scale: Record<string, number> = { "": 1 / 1024 ** 3, k: 1 / 1024 ** 2, m: 1 / 1024, g: 1, t: 1024 };
  return Math.round(Number(m[1]) * scale[m[2].toLowerCase()] * 10) / 10;
};
const DOCKER = "agents.defaults.sandbox.docker";
export const DOCKER_SEC: SecSpec = { title: "Docker", lv: 2, hint: "For “Where commands run: Docker”. Every container drops extra rights and can’t gain new ones.", rows: [
  { t: "CPUs", s: "Empty: no limit.", k: `${DOCKER}.cpus`, kind: "num", ph: "No limit", min: 0 },
  { t: "Memory", s: "Empty: no limit.", k: `${DOCKER}.memory`, kind: "num", unit: "GB", ph: "No limit", min: 0, read: GB, write: (v) => `${Math.round(Number(v) * 1024)}m` },
  no("Disk", "Empty: no limit.", "num", { unit: "GB", ph: "No limit" }),
  { t: "Network", k: `${DOCKER}.network`, def: "none", kind: "pick", opts: [{ id: "bridge", label: "On" }, { id: "none", label: "Off" }] },
  sw("Keep keys outside the container", "Requests that need a key go through a guard on this computer; the container never holds the key.", "secrets.egressProxy.enabled", false),
] };

export const FILES: SecSpec = { title: "Files", lv: 1, rows: [
  no("Read a file before changing it", "An edit is refused if the file wasn’t read, or changed on disk since."),
  no("Never read .env files", "Except .env.example."),
  no("Refuse “rest of the code unchanged” edits", "Edits that would replace code with a placeholder are sent back."),
  no("Read each write back", "The result says whether what’s on disk matches."),
  no("Where a Trunk’s files live", "", "pick", { lv: 2, opts: [{ id: "local", label: "On this computer" }] }),
  no("Your services as folders", "Mail, chat, Drive, Notion and more show up as folders a Trunk can list and read.", "sw", { lv: 2 }),
] };

export const WEB_MORE: SecSpec = { title: "Web search, more", lv: 1, rows: [
  { t: "Free search when no key is set", s: "Tried last, after every search you set up.", plug: "duckduckgo" },
  sw("Use the model’s own search when it has one", "Answers come with the sources it used.", "tools.web.search.openaiCodex.enabled", false),
  { t: "Keep results for", s: "The same search within this time isn’t paid for twice.", k: "tools.web.search.cacheTtlMinutes", kind: "num", unit: "minutes", def: 15, min: 0 },
] };

export const SKILLS_MORE: SecSpec = { title: "Skills, more", lv: 1, rows: [
  no("Start a skill by itself when it clearly fits", "Only when one skill clearly fits better than the next."),
  no("Run !`command` lines in skills", "A skill may fill itself in with a command’s output when it loads. Code blocks never run.", "sw", { lv: 2 }),
  no("Where new skills are saved", "Skills Trunks write go here. A synced folder works.", "text", { lv: 2 }),
] };

/** Where commands run: this computer (sandbox off) or a sandbox backend the engine has. */
function WhereRun({ c }: { c: Ctx }) {
  const mode = str(c.config.get("agents.defaults.sandbox.mode")) || "off";
  const backend = str(c.config.get("agents.defaults.sandbox.backend")) || "docker";
  const value = mode === "off" ? "local" : backend;
  const pick = (id: string) => void c.config.set("agents.defaults.sandbox", id === "local" ? { mode: "off" } : { mode: mode === "off" ? "all" : mode, backend: id });
  const none = "Not in this engine.";
  const opts: Opt[] = [{ id: "local", label: "This computer" }, { id: "docker", label: "Docker" }, { id: "ssh", label: "SSH" }, { id: "singularity", label: "Singularity", off: none }, { id: "modal", label: "Modal", off: none }, { id: "daytona", label: "Daytona", off: none }];
  return (
    <Ctl title="Where commands run" sub="This computer, or a separate place: a container, another computer over SSH, or a cloud sealed box.">
      <Pick label="Where commands run" value={value} options={opts} disabled={c.config.loading} onChange={pick} />
    </Ctl>
  );
}
