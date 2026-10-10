// Settings › Data & usage (DESIGN-SPEC §4.7.14): the spend card and its report (sessions.usage, usage.cost,
// sessions.usage.timeseries/logs), what each connection has left (usage.status), spend per Trunk, keeping
// conversations (config `session.*`), backups (backup.status) and the rest, greyed with why where the engine has none.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SettingsPageProps } from "../index";
import type { WindowEngine } from "../../../connect/engine";
import { Acts, Btn, Ctl, Empty, Field, Hint, Num, Page, Pick, Pill, Plist, Prow, Sec, Seg, Switch, useConfig, type RowEntry } from "../kit";
import { errorText, list } from "../adapter";
import { Dialog } from "../../../shell/Dialog";
import { Menu, type MenuAnchor } from "../../../shell/Menu";
import { CallLine, CodeRow, CopyBtn, Kv, Tile, bytes, lvOf, openPlace, rec, span, str, useCall, useLive, useResource, when, type RecordValue } from "./common";
import { Ico } from "./icons";
import { Logo } from "../set1/service";
import { readLimits, resetWords as sharedResetWords, type LimitRow } from "../../../shell/status-data";
import { ModelPrices } from "./usage-prices";
import { ReportProblem } from "./report-problem";
import { CKPT_PREF, CKPT_SHOW, useCkptOn } from "../../../shell/SaveProgress";
import { lookStore } from "../set1/appearance-store";
import "./usage.css";
import { DesktopCtl } from "../desktop-ctl";
import { formatMoney } from "../../../format/money";
import { forgetDeletedConversationWindow } from "../../../shell/own-window";

/* ---------- figures ---------- */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const LOCAL = { mode: "specific", timeZone: TZ };
const ALL = { agentScope: "all" };
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const money = (v: unknown): string => formatMoney(num(v));
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
/** "4.7M", "472k", "262". */
export function tok(n: unknown): string {
  const v = num(n);
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v));
}
/** "2026-09-14" read as a local calendar day. */
const dayOf = (date: string) => new Date(`${date}T12:00:00`);
const short = (date: string) => dayOf(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** One engine read that can be switched off (params null) and keeps its last answer while it reloads. */
function useQuery(engine: WindowEngine, method: string, params: unknown) {
  const key = params === null ? "" : JSON.stringify(params);
  const [st, setSt] = useState<{ data?: RecordValue; error?: string; loading: boolean }>({ loading: key !== "" });
  useEffect(() => {
    if (!key) { setSt({ loading: false }); return; }
    let live = true;
    setSt((s) => ({ data: s.data, loading: true }));
    engine.request(method, JSON.parse(key)).then(
      (d) => { if (live) setSt({ data: rec(d), loading: false }); },
      (e: unknown) => { if (live) setSt({ error: errorText(e), loading: false }); },
    );
    return () => { live = false; };
  }, [engine, method, key]);
  return st;
}

/** Trunk names by id, from agents.list. */
function useNames(engine: WindowEngine): Map<string, string> {
  const agents = useLive<RecordValue>(engine, "agents.list", {}, []);
  return useMemo(() => new Map(list(rec(agents.data).agents).map((a) => [str(a.id), str(rec(a.identity).name) || str(a.name) || str(a.id)])), [agents.data]);
}

const CHANNEL: Record<string, string> = {
  webchat: "This window", "control-ui": "This window", telegram: "Telegram", whatsapp: "WhatsApp", discord: "Discord", slack: "Slack",
  signal: "Signal", imessage: "iMessage", cron: "Automations", unknown: "Not recorded",
};
const channelName = (id: string) => CHANNEL[id] ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : "Not recorded");
const PROVIDER: Record<string, string> = { openai: "OpenAI", "openai-codex": "ChatGPT", anthropic: "Anthropic", google: "Google", "google-gemini-cli": "Google Gemini", openrouter: "OpenRouter", ollama: "This computer", lmstudio: "This computer", xai: "xAI", deepseek: "DeepSeek", mistral: "Mistral" };
const providerName = (id: string) => PROVIDER[id] ?? id;
function creatorName(c: RecordValue): string {
  const actor = rec(c.actor);
  return str(rec(actor.identity).displayName) || str(actor.label) || str(actor.id) || "Not recorded";
}

/* ---------- the page ---------- */
export function UsagePage(props: SettingsPageProps) {
  const lv = lvOf(props.level);
  const [days, setDays] = useState("30");
  const [report, setReport] = useState(false);
  const names = useNames(props.engine);
  const spend = useResource<RecordValue>(props.engine, "sessions.usage", { range: `${days}d`, ...ALL, ...LOCAL, limit: 1 });
  return (
    <Page title={props.title} lede="What each account has left, what Branch spent, what it keeps.">
      <SpendCard spend={spend} days={days} setDays={setDays} onOpen={() => setReport(true)} />
      <Allowances engine={props.engine} />
      <TrunkSpend spend={spend} names={names} days={days} />
      <Keeping engine={props.engine} lv={lv} />
      <TestModel />
      <Evals lv={lv} />
      <MovingInOut engine={props.engine} lv={lv} />
      {lv >= 1 ? <MoneyMore engine={props.engine} lv={lv} /> : null}
      {lv >= 1 ? <ModelPrices engine={props.engine} /> : null}
      {lv >= 1 ? <KeepingMore engine={props.engine} lv={lv} /> : null}
      {lv >= 2 ? <EverySetting engine={props.engine} /> : null}
      <Flagged lv={lv} />
      <YourData engine={props.engine} />
      <ReportProblem />
      {report ? <ReportDialog engine={props.engine} lv={lv} days={days} names={names} onClose={() => setReport(false)} /> : null}
    </Page>
  );
}

/** The card at the top: what Branch spent in the period, how many tasks, and "Open the report". */
type SpendResult = { data?: RecordValue; error?: string | null };
function SpendCard({ spend, days, setDays, onOpen }: { spend: SpendResult; days: string; setDays: (d: string) => void; onOpen: () => void }) {
  const data = rec(spend.data);
  const tasks = num(rec(rec(data.aggregates).messages).user);
  const stale = str(rec(data.cacheStatus).status);
  return (
    <div className="s2usage-rep">
      <div className="s2usage-reph">
        <span>
          <small>Last {days} days</small>
          <b>{spend.data ? money(rec(data.totals).totalCost) : spend.error ? "" : "…"}</b>
          {spend.error ? <em className="s2-err" role="alert">{spend.error}</em> : spend.data ? <em>{tasks} {tasks === 1 ? "task" : "tasks"} · estimated from each model’s price</em> : null}
          {stale && stale !== "fresh" ? <em className="s2usage-inc">Usage may be incomplete. Branch is checking for updated totals.</em> : null}
        </span>
        <Seg label="Spend period" value={days} options={["7", "30", "90"].map((d) => ({ id: d, label: `${d} days` }))} onChange={setDays} />
      </div>
      <Btn sm onClick={onOpen}>Open the report</Btn>
    </div>
  );
}

/* ---------- what each connection has left ---------- */
/** Use the same reset wording as the status bar and its usage popover. */
export function resetWords(ms: unknown, now = Date.now()): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  return sharedResetWords(ms, 1, now);
}

/** "4 min ago", "1 h ago", "just now", "yesterday". */
function ago(ms: unknown, now = Date.now()): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  return min < 48 * 60 ? "Yesterday" : `${Math.floor(min / 1440)} days ago`;
}

function LimWindow({ label, left, words }: { label: string; left: number; words: string }) {
  const l = Math.max(0, Math.min(100, left));
  return (
    <div className="s2usage-limw">
      <span>{label}</span>
      <span className="s2usage-limbar" role="meter" aria-label={`${label} left`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(l)}><i style={{ width: `${l}%` }} /></span>
      <span>{`${Math.round(l)}% left · ${l >= 100 && !words ? "full" : words}`}</span>
    </div>
  );
}

const measuredNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function billingMeasured(b: RecordValue): boolean {
  return b.type === "budget"
    ? measuredNumber(b.used) && measuredNumber(b.limit) && b.limit > 0
    : measuredNumber(b.amount);
}

function Billing({ b }: { b: RecordValue }) {
  const unit = str(b.unit);
  const amount = (v: unknown) => measuredNumber(v) ? unit === "USD" ? formatMoney(v) : `${v.toLocaleString()} ${unit}` : "Unknown";
  if (b.type === "budget") {
    const label = str(b.label) || "Budget";
    return measuredNumber(b.used) && measuredNumber(b.limit) && b.limit > 0
      ? <LimWindow label={label} left={100 - (b.used / b.limit) * 100} words={`${amount(b.used)} of ${amount(b.limit)}${b.resetAt ? ` · ${resetWords(b.resetAt)}` : ""}`} />
      : <div className="s2usage-limw"><span>{label}</span><span>Unknown</span></div>;
  }
  const label = str(b.label) || (b.type === "balance" ? "Balance" : "Spent");
  return <div className="s2usage-limw"><span>{label}</span><span>{amount(b.amount)}{str(b.period) ? ` · ${str(b.period)}` : ""}</span></div>;
}

function Provider({ p, limit, updatedAt }: { p: RecordValue; limit: LimitRow; updatedAt: unknown }) {
  const name = limit.name;
  const windows = limit.windows.map((window) => ({ label: window.name, left: window.left, words: window.reset }));
  const billing = list(p.billing);
  const told = windows.length > 0 || billing.some(billingMeasured);
  const sub = [str(p.accountEmail), str(p.plan)].filter(Boolean).join(" · ");
  return (
    <div className="s2usage-lim" data-provider={str(p.provider)}>
      <Logo id={str(p.provider)} name={name} />
      <div>
        <div className="s2usage-limh">
          <b>{name}</b>
          {sub ? <span className="s2usage-muted">{sub}</span> : null}
          <span className={`pill ${p.error ? "bad" : told ? "ok" : "idle"}`}>{p.error ? "Couldn’t check" : told ? "Measured" : "Not published"}</span>
        </div>
        {windows.map((w, i) => <LimWindow key={i} {...w} />)}
        {billing.map((b, i) => <Billing key={`b${i}`} b={b} />)}
        {p.error ? <small className="s2-err">{str(p.error)}</small>
          : told ? <small>{`as of ${ago(updatedAt)}, asked ${name}`}</small>
          : <small>{str(p.summary) || "This service does not say what it allows."}</small>}
      </div>
    </div>
  );
}

function Allowances({ engine }: { engine: WindowEngine }) {
  const res = useLive<RecordValue>(engine, "usage.status", {}, []);
  const data = rec(res.data);
  const providers = list(data.providers);
  const limits = readLimits(res.data);
  return (
    <Sec title="Account allowances" hint="What each account has left. Every figure comes from its service.">
      {res.error ? <p className="hint s2-err" role="alert">{res.error}</p> : null}
      {res.loading && !res.data ? <Hint>Checking accounts…</Hint> : null}
      {res.data && !providers.length ? <Empty>No account reports an allowance yet.</Empty> : null}
      {providers.length ? <div className="s2usage-lims">{providers.map((p, i) => <Provider key={`${str(p.provider)}-${i}`} p={p} limit={limits.rows[i]} updatedAt={data.updatedAt} />)}</div> : null}
      {data.refreshing === true ? <Hint>Checking accounts again…</Hint> : null}
      <AllowanceRows engine={engine} />
    </Sec>
  );
}

/* ---------- spend per Trunk ---------- */
function TrunkSpend({ spend, names, days }: { spend: SpendResult; names: Map<string, string>; days: string }) {
  const rows = list(rec(rec(spend.data).aggregates).byAgent).map((a) => ({ id: str(a.agentId), cost: num(rec(a.totals).totalCost) })).sort((a, b) => b.cost - a.cost);
  const max = Math.max(0, ...rows.map((r) => r.cost));
  return (
    <Sec title={`Spend by Trunk · last ${days} days`}>
      {spend.error ? <p className="hint s2-err" role="alert">{spend.error}</p> : null}
      {spend.data && !rows.length ? <Empty>Nothing was spent in the last {days} days.</Empty> : null}
      {rows.length ? (
        <div className="s2usage-bars">
          {rows.map((r) => (
            <div className="s2usage-brow" key={r.id}>
              <span>{names.get(r.id) ?? r.id}</span>
              <span className="s2usage-track"><u style={{ width: `${max ? Math.max(1.5, (r.cost / max) * 100) : 0}%` }} /></span>
              <span className="s2usage-v">{money(r.cost)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Sec>
  );
}

/* ======================================================================================================
   The usage report ("Open the report")
   ====================================================================================================== */
type Period = "Today" | "7 days" | "30 days" | "90 days" | "1 year" | "All" | "Custom…";
const PERIODS: Period[] = ["Today", "7 days", "30 days", "90 days", "1 year", "All", "Custom…"];
const RANGE: Partial<Record<Period, string>> = { "7 days": "7d", "30 days": "30d", "90 days": "90d", "1 year": "1y", All: "all" };
const NO_SPLIT = "Splitting usage by provider, model, tool or chat app needs the engine to filter by them.";
type Sel = { from: string; to: string } | null;
type RepState = {
  period: Period; from: string; to: string; agent: string; creator: string; utc: boolean; lineage: "family" | "instance";
  days: [number, number] | null; measure: "Tokens" | "Cost"; split: "Total" | "By type"; view: "All" | "Recently viewed";
  sort: "Cost" | "Errors" | "Messages" | "Recent" | "Tokens"; desc: boolean; open: string; seen: string[]; q: string; pin: boolean;
};

function initial(days: string): RepState {
  return {
    period: `${days} days` as Period, from: "", to: "", agent: "", creator: "", utc: false, lineage: "family", days: null,
    measure: "Tokens", split: "By type", view: "All", sort: "Recent", desc: true, open: "", seen: [], q: "", pin: false,
  };
}

function periodDates(s: RepState): RecordValue {
  if (s.period === "Today") { const t = ymd(new Date()); return { startDate: t, endDate: t }; }
  if (s.period === "Custom…") return { startDate: s.from <= s.to ? s.from : s.to, endDate: s.from <= s.to ? s.to : s.from };
  return { range: RANGE[s.period] ?? "30d" };
}

/** The sessions.usage request for the report: who (Trunk, person), the time zone, the lineage, then the dates. */
export function reportParams(s: RepState, sel: Sel): RecordValue {
  return {
    ...(s.agent ? { agentId: s.agent } : ALL), ...(s.creator ? { creatorKey: s.creator } : {}),
    ...(s.utc ? { mode: "utc" } : LOCAL), groupBy: s.lineage, limit: 1000,
    ...(sel ? { startDate: sel.from, endDate: sel.to } : periodDates(s)),
  };
}

function title(s: RepState): string {
  if (s.period === "Today") return "Usage · today";
  if (s.period === "All") return "Usage · everything";
  if (s.period === "1 year") return "Usage · last year";
  if (s.period === "Custom…") return `Usage · ${s.from || "…"} to ${s.to || "…"}`;
  return `Usage · last ${s.period}`;
}

/** Every calendar day from start to end (at most 400), so quiet days still get a bar. */
function dayList(start: string, end: string, have: string[]): string[] {
  if (!start || !end) return have;
  const out: string[] = [];
  for (let d = dayOf(start); ymd(d) <= end && out.length < 400; d.setDate(d.getDate() + 1)) out.push(ymd(d));
  return out.length >= 400 ? have : out;
}

type Day = { date: string; tokens: number; cost: number; inp: number; out: number; cr: number; cw: number; messages: number; errors: number };
function daysOf(data: RecordValue): Day[] {
  const agg = rec(data.aggregates);
  const cost = new Map(list(agg.costDaily).map((d) => [str(d.date), d]));
  const daily = new Map(list(agg.daily).map((d) => [str(d.date), d]));
  return dayList(str(data.startDate), str(data.endDate), [...new Set([...cost.keys(), ...daily.keys()])].sort()).map((date) => {
    const c = rec(cost.get(date)); const d = rec(daily.get(date));
    return { date, tokens: num(c.totalTokens) || num(d.tokens), cost: num(c.totalCost) || num(d.cost), inp: num(c.input), out: num(c.output), cr: num(c.cacheRead), cw: num(c.cacheWrite), messages: num(d.messages), errors: num(d.errors) };
  });
}

export function ReportDialog({ engine, lv, days, names, onClose }: { engine: WindowEngine; lv: number; days: string; names: Map<string, string>; onClose: () => void }) {
  const [s, setS] = useState<RepState>(() => initial(days));
  const set = (patch: Partial<RepState>) => setS((o) => ({ ...o, ...patch }));
  const waiting = s.period === "Custom…" && !(s.from && s.to);
  const period = useQuery(engine, "sessions.usage", waiting ? null : reportParams(s, null));
  const all = useMemo(() => daysOf(rec(period.data)), [period.data]);
  const sel: Sel = s.days && all[s.days[0]] && all[s.days[1]] ? { from: all[s.days[0]].date, to: all[s.days[1]].date } : null;
  const picked = useQuery(engine, "sessions.usage", sel ? reportParams(s, sel) : null);
  const data = rec(sel ? picked.data : period.data);
  const year = useQuery(engine, "usage.cost", lv >= 1 ? { days: 365, ...ALL, ...LOCAL } : null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const error = period.error ?? picked.error;
  return (
    <Dialog title={title(s)} wide onClose={onClose} footer={<><Btn ghost aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.top - 120 }); }}>Export</Btn></>}>
      <ReportTop s={s} set={set} lv={lv} />
      {lv >= 1 ? <ReportFilters s={s} set={set} names={names} creators={list(rec(period.data).creatorOptions)} all={all} /> : null}
      {lv >= 2 ? <QueryBox s={s} set={set} /> : null}
      {error ? <p className="s2usage-err" role="alert">{error}</p> : null}
      {waiting ? <p className="hint">Pick both dates.</p> : null}
      {(period.loading && !period.data) || (sel && !picked.data && !picked.error) ? <p className="hint">Counting…</p> : null}
      {period.data && !waiting && (!sel || picked.data) ? <ReportBody s={s} set={set} lv={lv} data={data} all={all} year={rec(year.data)} names={names} filtered={Boolean(sel || s.agent || s.creator)} engine={engine} /> : null}
      <p className="hint">Estimated from each model’s published price. Plans are billed by their own sites.</p>
      {menu ? <Menu label="Export" at={menu} onClose={() => setMenu(null)} items={exportItems(data, all, names)} /> : null}
    </Dialog>
  );
}

function ReportTop({ s, set, lv }: { s: RepState; set: (p: Partial<RepState>) => void; lv: number }) {
  return (
    <div className="s2usage-top">
      <Seg label="Period" value={s.period} options={PERIODS.map((p) => ({ id: p, label: p }))} onChange={(p) => set({ period: p as Period, days: null })} />
      {s.period === "Custom…" ? (
        <>
          <label className="s2usage-tsel"><span>From</span><input className="inp" type="date" aria-label="From" value={s.from} onChange={(e) => set({ from: e.target.value, days: null })} /></label>
          <label className="s2usage-tsel"><span>To</span><input className="inp" type="date" aria-label="To" value={s.to} onChange={(e) => set({ to: e.target.value, days: null })} /></label>
        </>
      ) : null}
      {lv >= 2 ? (
        <>
          <label className="s2usage-tsel"><span>Times in</span>
            <select className="inp" aria-label="Times in" value={s.utc ? "UTC" : "Local"} onChange={(e) => set({ utc: e.target.value === "UTC", days: null })}><option>Local</option><option>UTC</option></select>
          </label>
          <Seg label="Count a conversation" value={s.lineage} options={[{ id: "instance", label: "As it is now" }, { id: "family", label: "With its earlier parts" }]} onChange={(v) => set({ lineage: v as RepState["lineage"] })} />
        </>
      ) : null}
    </div>
  );
}

function ReportFilters({ s, set, names, creators, all }: { s: RepState; set: (p: Partial<RepState>) => void; names: Map<string, string>; creators: RecordValue[]; all: Day[] }) {
  const chip = s.days && all[s.days[0]] ? (s.days[0] === s.days[1] ? short(all[s.days[0]].date) : `${short(all[s.days[0]].date)}–${short(all[s.days[1]].date)}`) : "";
  return (
    <div className="s2usage-filt" style={s.pin ? { position: "sticky", top: -18, zIndex: 2, background: "var(--raise)", padding: "6px 0", borderBottom: "1px solid var(--line)" } : undefined}>
      <label className="s2usage-tsel"><span>Trunk</span>
        <select className="inp" aria-label="Trunk" value={s.agent} onChange={(e) => set({ agent: e.target.value, days: null })}>
          <option value="">All Trunks</option>
          {[...names].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label className="s2usage-tsel"><span>Started by</span>
        <select className="inp" aria-label="Started by" value={s.creator} onChange={(e) => set({ creator: e.target.value, days: null })}>
          <option value="">Everyone</option>
          {creators.map((c) => <option key={str(c.key)} value={str(c.key)}>{creatorName(c)}</option>)}
        </select>
      </label>
      <label className="s2usage-tsel" title={NO_SPLIT}><span>Chat app</span><select className="inp" aria-label="Chat app" disabled><option>All</option></select></label>
      {["Provider", "Model", "Tool"].map((k) => <span key={k} className="s2usage-ms"><button type="button" className="chip6" disabled title={NO_SPLIT}>{k}: All</button></span>)}
      <Btn ghost sm aria-pressed={s.pin} onClick={() => set({ pin: !s.pin })}>Pin</Btn>
      {chip ? <span className="s2usage-chips"><span className="chip6">{chip}<button type="button" aria-label="Remove days filter" onClick={() => set({ days: null })}><Ico name="x" s /></button></span></span> : null}
    </div>
  );
}

const Q_KEYS = new Set(["agent", "channel", "model", "provider", "has", "minCost", "maxCost", "minTokens", "maxTokens", "minMessages", "maxMessages"]);
/** The Technical query box: words and key:value terms that narrow the conversation list below. */
export function parseQuery(q: string): { terms: [string, string][]; warns: string[] } {
  const terms: [string, string][] = []; const warns: string[] = [];
  for (const t of q.split(/\s+/).filter(Boolean)) {
    const m = /^([A-Za-z]+):(.*)$/.exec(t);
    if (!m) { terms.push(["", t]); continue; }
    if (!Q_KEYS.has(m[1])) warns.push(`Unknown filter: ${m[1]}`);
    else if (!m[2]) warns.push(`Missing value for ${m[1]}`);
    else if (/^(min|max)/.test(m[1]) && !/^\$?\d+(\.\d+)?$/.test(m[2])) warns.push(`Not a number for ${m[1]}`);
    else if (m[1] === "has" && !["errors", "tools"].includes(m[2])) warns.push(`Unknown has: ${m[2]}`);
    else terms.push([m[1], m[2]]);
  }
  return { terms, warns };
}

function QueryBox({ s, set }: { s: RepState; set: (p: Partial<RepState>) => void }) {
  const [draft, setDraft] = useState(s.q);
  const { warns } = parseQuery(s.q);
  return (
    <div className="s2usage-q">
      <input className="inp" type="search" placeholder="model:gpt has:errors minCost:0.50" aria-label="Filter conversations" value={draft}
        onChange={(e) => setDraft(e.target.value)} onBlur={() => set({ q: draft.trim() })} onKeyDown={(e) => { if (e.key === "Enter") set({ q: draft.trim() }); }} />
      {warns.map((w) => <small key={w} className="s2usage-err">{w}</small>)}
    </div>
  );
}

type BodyProps = { s: RepState; set: (p: Partial<RepState>) => void; lv: number; data: RecordValue; all: Day[]; year: RecordValue; names: Map<string, string>; filtered: boolean; engine: WindowEngine };

function ReportBody(p: BodyProps) {
  const agg = rec(p.data.aggregates);
  return (
    <>
      <Tiles data={p.data} />
      {p.lv >= 1 ? <Tiles2 data={p.data} /> : null}
      {p.lv >= 1 ? <DayChart {...p} /> : null}
      {p.lv >= 1 ? <ByType s={p.s} totals={rec(p.data.totals)} /> : null}
      {p.lv >= 1 && !p.filtered ? <CostWindows all={p.all} /> : null}
      {p.lv >= 1 && p.all.length > 1 ? <Heat year={p.year} /> : null}
      {p.lv >= 1 ? <ByTime rows={list(p.data.sessions)} utc={p.s.utc} /> : null}
      <Bars title="By model" rows={list(agg.byModel).map((m) => [str(m.model) || str(m.provider) || "Not recorded", num(rec(m.totals).totalCost)])} unit={(v) => (v ? money(v) : "free")} />
      <Bars title="By where it came from" rows={shares(list(agg.byChannel).map((c) => [channelName(str(c.channel)), num(rec(c.totals).totalTokens)]))} unit={pctU} />
      <Bars title="By person" rows={shares(list(agg.byCreator).map((c) => [creatorName(c), num(rec(c.totals).totalTokens)]))} unit={pctU} />
      {p.lv >= 1 ? <MoreBars agg={agg} rows={list(p.data.sessions)} names={p.names} utc={p.s.utc} /> : null}
      {p.lv >= 1 ? <Conversations {...p} /> : null}
    </>
  );
}

const pctU = (v: number) => pct(v);
/** Turns amounts into shares of their sum, largest first. */
function shares(rows: [string, number][]): [string, number][] {
  const sum = rows.reduce((a, [, v]) => a + v, 0);
  return rows.map(([n, v]): [string, number] => [n, sum ? v / sum : 0]).sort((a, b) => b[1] - a[1]);
}

function Bars({ title, rows, unit, empty, limit = 8 }: { title: string; rows: [string, number][]; unit: (v: number) => string; empty?: string; limit?: number }) {
  const top = [...rows].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const max = Math.max(0, ...top.map(([, v]) => v));
  return (
    <div className="s2usage-g" data-group={title}>
      <h3>{title}</h3>
      {top.length ? top.map(([n, v]) => (
        <div className="s2usage-r" key={n}><span title={n}>{n}</span><span className="s2usage-b"><u style={{ width: `${max ? Math.max(1.5, (v / max) * 100) : 0}%` }} /></span><b>{unit(v)}</b></div>
      )) : <p className="hint">{empty ?? "Nothing in this period."}</p>}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: ReactNode }) { return <div><small>{k}</small><b>{v}</b></div>; }

function Tiles({ data }: { data: RecordValue }) {
  const agg = rec(data.aggregates);
  const models = list(agg.byModel).filter((m) => num(m.count) > 0).map((m) => ({ n: str(m.model) || str(m.provider), per: num(rec(m.totals).totalCost) / num(m.count) }));
  const cheap = models.sort((a, b) => a.per - b.per)[0];
  const busy = list(agg.daily).reduce<RecordValue | null>((a, d) => (!a || num(d.tokens) > num(a.tokens) ? d : a), null);
  return (
    <div className="s2usage-tiles">
      <Stat k="Spent" v={money(rec(data.totals).totalCost)} />
      <Stat k="Tasks" v={num(rec(agg.messages).user).toLocaleString()} />
      <Stat k="Cheapest per task" v={cheap ? `${cheap.n} · ${cheap.per ? money(cheap.per) : "free"}` : "—"} />
      <Stat k="Busiest day" v={busy && num(busy.tokens) ? dayOf(str(busy.date)).toLocaleDateString(undefined, { weekday: "long" }) : "—"} />
    </div>
  );
}

function Tiles2({ data }: { data: RecordValue }) {
  const agg = rec(data.aggregates); const t = rec(data.totals); const m = rec(agg.messages);
  const total = num(m.total); const tokens = num(t.totalTokens);
  const minutes = list(data.sessions).reduce((a, r) => a + num(rec(r.usage).durationMs), 0) / 60_000;
  const cacheBase = num(t.cacheRead) + num(t.input);
  return (
    <div className="s2usage-tiles s2usage-tiles2">
      <Stat k="Messages" v={`${num(m.user)} / ${num(m.assistant)}`} />
      <Stat k="Tool calls" v={num(rec(agg.tools).totalCalls).toLocaleString()} />
      <Stat k="Errors" v={num(m.errors).toLocaleString()} />
      <Stat k="Error rate" v={total ? pct(num(m.errors) / total, 1) : "0%"} />
      <Stat k="Average tokens per message" v={total ? tok(tokens / total) : "0"} />
      <Stat k="Average cost per message" v={money(total ? num(t.totalCost) / total : 0)} />
      <Stat k="Conversations" v={num(agg.sessionCount ?? list(data.sessions).length).toLocaleString()} />
      <Stat k="Tokens a minute" v={minutes >= 1 ? tok(tokens / minutes) : "—"} />
      <Stat k="Cache hit rate" v={cacheBase ? pct(num(t.cacheRead) / cacheBase) : "—"} />
    </div>
  );
}

function DayChart({ s, set, all }: BodyProps) {
  const cost = s.measure === "Cost"; const byType = s.split === "By type" && !cost;
  const vals = all.map((d) => (cost ? d.cost : d.tokens));
  const max = Math.max(0, ...vals);
  const pick = (i: number, shift: boolean) => set({ days: shift && s.days ? [Math.min(s.days[0], i), Math.max(s.days[1], i)] : [i, i] });
  return (
    <div className="s2usage-g">
      <h3>Each day</h3>
      <div className="acts">
        <Seg label="Measure" value={s.measure} options={[{ id: "Tokens", label: "Tokens" }, { id: "Cost", label: "Cost" }]} onChange={(v) => set({ measure: v as RepState["measure"] })} />
        <Seg label="Split" value={s.split} options={[{ id: "Total", label: "Total" }, { id: "By type", label: "By type" }]} onChange={(v) => set({ split: v as RepState["split"] })} />
      </div>
      {max ? (
        <div className="s2usage-chart" role="group" aria-label="Each day">
          {all.map((d, i) => {
            const label = `${short(d.date)} · ${cost ? money(vals[i]) : `${tok(vals[i])} tokens`}`;
            const on = s.days !== null && i >= s.days[0] && i <= s.days[1];
            return (
              <button key={d.date} type="button" className={`s2usage-bar${on ? " on" : ""}`} aria-label={label} title={label} style={{ height: `${Math.max(2, (vals[i] / max) * 100)}%` }} onClick={(e) => pick(i, e.shiftKey)}>
                {byType && d.tokens ? <><u style={{ height: `${(d.cr / d.tokens) * 100}%` }} /><u style={{ height: `${(d.inp / d.tokens) * 100}%` }} /><u style={{ height: `${(d.cw / d.tokens) * 100}%` }} /></> : null}
              </button>
            );
          })}
        </div>
      ) : <p className="hint">Nothing in this period.</p>}
      {max ? <p className="hint">Click a bar to pick that day; Shift-click picks a range.</p> : null}
    </div>
  );
}

function ByType({ s, totals: t }: { s: RepState; totals: RecordValue }) {
  const cost = s.measure === "Cost";
  const rows: [string, number][] = cost
    ? [["Output · What the model wrote", num(t.outputCost)], ["Input · What you and tools sent", num(t.inputCost)], ["Cache write · Saved for reuse", num(t.cacheWriteCost)], ["Cache read · Reused from the cache", num(t.cacheReadCost)], ["Total", num(t.totalCost)]]
    : [["Output · What the model wrote", num(t.output)], ["Input · What you and tools sent", num(t.input)], ["Cache write · Saved for reuse", num(t.cacheWrite)], ["Cache read · Reused from the cache", num(t.cacheRead)], ["Total", num(t.totalTokens)]];
  const max = Math.max(0, ...rows.map(([, v]) => v));
  return (
    <div className="s2usage-g" data-group={cost ? "Cost by type" : "Tokens by type"}>
      <h3>{cost ? "Cost by type" : "Tokens by type"}</h3>
      {rows.map(([n, v]) => <div className="s2usage-r" key={n}><span title={n}>{n}</span><span className="s2usage-b"><u style={{ width: `${max ? Math.max(1.5, (v / max) * 100) : 0}%` }} /></span><b>{cost ? money(v) : tok(v)}</b></div>)}
    </div>
  );
}

function CostWindows({ all }: { all: Day[] }) {
  if (!all.length) return null;
  const wins = ([["This period", all.length], ["Today", 1], ["Last 7 days", 7], ["Last 30 days", 30], ["Last 90 days", 90]] as [string, number][]).filter(([l, n]) => l === "This period" || n < all.length);
  return (
    <div className="s2usage-g">
      <h3>Cost windows</h3>
      <p className="hint">Calendar windows ending {short(all[all.length - 1].date)}</p>
      <div className="s2usage-tiles">
        {wins.map(([l, n]) => {
          const part = all.slice(-n); const c = part.reduce((a, d) => a + d.cost, 0); const t = part.reduce((a, d) => a + d.tokens, 0);
          return <div key={l}><small>{l}</small><b>{money(c)}</b><small>{tok(t)} tokens · {money(c / n)} a day</small></div>;
        })}
      </div>
    </div>
  );
}

const level = (v: number, max: number) => (max && v ? Math.min(4, Math.max(1, Math.floor((v / max) * 5))) : 0);

function Heat({ year }: { year: RecordValue }) {
  const daily = list(year.daily).map((d) => ({ date: str(d.date), tokens: num(d.totalTokens) }));
  if (!daily.length) return null;
  const days = dayList(daily[0].date, daily[daily.length - 1].date, daily.map((d) => d.date)).slice(-364);
  const by = new Map(daily.map((d) => [d.date, d.tokens]));
  const max = Math.max(0, ...daily.map((d) => d.tokens));
  return (
    <div className="s2usage-g">
      <h3>Token activity</h3>
      <p className="hint">Tokens each day, up to a year.</p>
      <div className="s2usage-heat">
        {Array.from({ length: dayOf(days[0]).getDay() }, (_, i) => <i key={`p${i}`} />)}
        {days.map((d) => <i key={d} className={`s2usage-hm h${level(by.get(d) ?? 0, max)}`} title={`${short(d)} · ${tok(by.get(d) ?? 0)} tokens`} />)}
      </div>
      <p className="hint s2usage-legend">Less {[0, 1, 2, 3, 4].map((h) => <i key={h} className={`s2usage-hm h${h}`} />)} More</p>
    </div>
  );
}

/** Tokens and errors by local (or UTC) weekday and hour, from each conversation's quarter-hour buckets. */
export function timeBuckets(rows: RecordValue[], utc: boolean) {
  const dow = Array<number>(7).fill(0); const hours = Array<number>(24).fill(0);
  const hourMsgs = Array<number>(24).fill(0); const hourErrs = Array<number>(24).fill(0);
  const at = (b: RecordValue) => { const d = new Date(`${str(b.date)}T00:00:00Z`); d.setTime(d.getTime() + num(b.quarterIndex) * 900_000); return d; };
  for (const r of rows) {
    const u = rec(r.usage);
    for (const b of list(u.utcQuarterHourTokenUsage)) { const d = at(b); dow[utc ? d.getUTCDay() : d.getDay()] += num(b.totalTokens); hours[utc ? d.getUTCHours() : d.getHours()] += num(b.totalTokens); }
    for (const b of list(u.utcQuarterHourMessageCounts)) { const h = utc ? at(b).getUTCHours() : at(b).getHours(); hourMsgs[h] += num(b.total); hourErrs[h] += num(b.errors); }
  }
  return { dow, hours, hourMsgs, hourErrs };
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_LABEL: Record<number, string> = { 0: "Midnight", 4: "4 am", 8: "8 am", 12: "Noon", 16: "4 pm", 20: "8 pm" };

function ByTime({ rows, utc }: { rows: RecordValue[]; utc: boolean }) {
  const { dow, hours } = timeBuckets(rows, utc);
  const md = Math.max(0, ...dow); const mh = Math.max(0, ...hours);
  return (
    <div className="s2usage-g">
      <h3>Activity by time</h3>
      <p className="hint">From when each conversation used tokens. Times in {utc ? "UTC" : TZ}.</p>
      <div className="s2usage-dow">{DOW.map((d, i) => <span key={d}><i className={`s2usage-hm h${level(dow[i], md)}`} />{d}</span>)}</div>
      <div className="s2usage-hours">{hours.map((v, h) => <button key={h} type="button" disabled className={`s2usage-hm h${level(v, mh)}`} title={`${h}:00 · ${tok(v)} tokens`} aria-label={`${h}:00`}>{HOUR_LABEL[h] ?? ""}</button>)}</div>
      <p className="hint">Fewer → more tokens</p>
    </div>
  );
}

function MoreBars({ agg, rows, names, utc }: { agg: RecordValue; rows: RecordValue[]; names: Map<string, string>; utc: boolean }) {
  const { hourMsgs, hourErrs } = timeBuckets(rows, utc);
  const tools = rec(agg.tools);
  const calls = num(tools.totalCalls);
  const errDays = list(agg.daily).filter((d) => num(d.errors) && num(d.messages)).map((d): [string, number] => [short(str(d.date)), num(d.errors) / num(d.messages)]);
  const errHours = hourErrs.map((e, h): [string, number] => [`${h}:00`, hourMsgs[h] ? e / hourMsgs[h] : 0]).filter(([, v]) => v > 0);
  return (
    <>
      <Bars title="Top providers" rows={shares(list(agg.byProvider).map((m) => [providerName(str(m.provider)) || "Not recorded", num(rec(m.totals).totalTokens)]))} unit={pctU} empty="No provider data" limit={5} />
      <Bars title="Top tools" rows={list(tools.tools).map((t) => [str(t.name), calls ? num(t.count) / calls : 0])} unit={pctU} empty="No tool calls" limit={6} />
      <Bars title="Top Trunks" rows={shares(list(agg.byAgent).map((a) => [names.get(str(a.agentId)) ?? str(a.agentId), num(rec(a.totals).totalTokens)]))} unit={pctU} empty="No Trunk data" limit={5} />
      <Bars title="Top chat apps" rows={shares(list(agg.byChannel).map((c) => [channelName(str(c.channel)), num(rec(c.totals).totalTokens)]))} unit={pctU} empty="No chat app data" limit={5} />
      <Bars title="Days with most errors" rows={errDays} unit={(v) => pct(v, 1)} empty="No errors" limit={5} />
      <Bars title="Hours with most errors" rows={errHours} unit={(v) => pct(v, 1)} empty="No errors" limit={5} />
    </>
  );
}

/* ---------- conversations in this period ---------- */
type Conv = { key: string; agentId: string; name: string; trunk: string; tokens: number; cost: number; messages: number; errors: number; updated: number; model: string; provider: string; channel: string; tools: number };
function convs(rows: RecordValue[], names: Map<string, string>): Conv[] {
  return rows.map((r) => {
    const u = rec(r.usage); const m = rec(u.messageCounts);
    return {
      key: str(r.key), agentId: str(r.agentId), name: str(r.label) || str(r.key), trunk: names.get(str(r.agentId)) ?? str(r.agentId),
      tokens: num(u.totalTokens), cost: num(u.totalCost), messages: num(m.total), errors: num(m.errors), updated: num(r.updatedAt),
      model: str(r.model), provider: str(r.modelProvider), channel: str(r.channel), tools: num(m.toolCalls),
    };
  });
}

/** Applies the Technical query box to the conversation list. */
export function matches(c: Conv, q: string): boolean {
  return parseQuery(q).terms.every(([k, v]) => {
    const n = Number(v.replace("$", ""));
    if (!k) return c.name.toLowerCase().includes(v.toLowerCase());
    if (k === "has") return v === "errors" ? c.errors > 0 : c.tools > 0;
    if (k.startsWith("min") || k.startsWith("max")) {
      const val = k.endsWith("Cost") ? c.cost : k.endsWith("Tokens") ? c.tokens : c.messages;
      return k.startsWith("min") ? val >= n : val <= n;
    }
    const field = { agent: c.trunk, channel: c.channel, model: c.model, provider: c.provider }[k] ?? "";
    return field.toLowerCase().includes(v.toLowerCase());
  });
}

const SORT: Record<RepState["sort"], (c: Conv) => number> = { Cost: (c) => c.cost, Errors: (c) => c.errors, Messages: (c) => c.messages, Recent: (c) => c.updated, Tokens: (c) => c.tokens };

function Conversations({ s, set, data, names, engine }: BodyProps) {
  let cs = convs(list(data.sessions), names).filter((c) => matches(c, s.q));
  if (s.view === "Recently viewed") cs = s.seen.map((k) => cs.find((c) => c.key === k)).filter((c): c is Conv => Boolean(c));
  else cs.sort((a, b) => (s.desc ? -1 : 1) * (SORT[s.sort](a) - SORT[s.sort](b)));
  const count = num(rec(data.aggregates).sessionCount);
  const open = (k: string) => set({ open: s.open === k ? "" : k, seen: k ? [k, ...s.seen.filter((x) => x !== k)].slice(0, 8) : s.seen });
  return (
    <div className="s2usage-g">
      <h3>Conversations in this period</h3>
      <div className="acts">
        <Seg label="Which" value={s.view} options={[{ id: "All", label: "All" }, { id: "Recently viewed", label: "Recently viewed" }]} onChange={(v) => set({ view: v as RepState["view"] })} />
        <label className="s2usage-tsel"><span>Sort</span>
          <select className="inp" aria-label="Sort" value={s.sort} onChange={(e) => set({ sort: e.target.value as RepState["sort"] })}>{Object.keys(SORT).map((k) => <option key={k}>{k}</option>)}</select>
        </label>
        <button type="button" className="ib" aria-label={s.desc ? "Highest first" : "Lowest first"} onClick={() => set({ desc: !s.desc })}>{s.desc ? "↓" : "↑"}</button>
      </div>
      {cs.length ? (
        <div className="rows">
          {cs.slice(0, 50).map((c) => (
            <div key={c.key}>
              <div className="prow s2usage-conv">
                <button type="button" className="link-k" onClick={() => open(c.key)}><b>{c.name}</b><small>{c.trunk}</small></button>
                <span className="s2-meta">{tok(c.tokens)}</span>
                <span className="s2-meta">{money(c.cost)}</span>
                <CopyBtn text={`${c.name} · ${tok(c.tokens)} tokens · ${money(c.cost)}`} />
              </div>
              {s.open === c.key ? <ConvDetail engine={engine} c={c} row={list(data.sessions).find((r) => str(r.key) === c.key) ?? {}} /> : null}
            </div>
          ))}
        </div>
      ) : <p className="hint">{s.view === "Recently viewed" ? "No conversations viewed yet." : "No conversations in this period."}</p>}
      {cs.length > 50 ? <p className="hint">+{cs.length - 50} more</p> : null}
      {count > list(data.sessions).length ? <p className="hint">Showing the first {list(data.sessions).length} of {count} conversations.</p> : null}
    </div>
  );
}

/** One conversation: its counts, tools and models, usage over time (sessions.usage.timeseries) and messages (sessions.usage.logs). */
function ConvDetail({ engine, c, row }: { engine: WindowEngine; c: Conv; row: RecordValue }) {
  const who = { key: c.key, ...(c.agentId ? { agentId: c.agentId } : {}) };
  const series = useQuery(engine, "sessions.usage.timeseries", who);
  const logs = useQuery(engine, "sessions.usage.logs", { ...who, limit: 200 });
  const [run, setRun] = useState(false);
  const [find, setFind] = useState("");
  const u = rec(row.usage);
  const pts = list(rec(series.data).points).map((p) => num(run ? p.cumulativeTokens : p.totalTokens));
  const max = Math.max(0, ...pts);
  const msgs = list(rec(logs.data).logs).filter((l) => !find || str(l.content).toLowerCase().includes(find.toLowerCase()));
  return (
    <div className="s2usage-det">
      <b>{c.name} · {tok(c.tokens)} tokens · {money(c.cost)}</b>
      <div className="s2usage-tiles">
        <Stat k="Messages" v={c.messages} /><Stat k="Tool calls" v={c.tools} /><Stat k="Errors" v={c.errors} />
        <Stat k="Duration" v={num(u.durationMs) ? `${Math.max(1, Math.round(num(u.durationMs) / 60_000))} min` : "—"} />
      </div>
      <div className="s2usage-two">
        <div><h3>Top tools</h3>{list(rec(u.toolUsage).tools).slice(0, 6).map((t) => <small key={str(t.name)}>{str(t.name)} · {num(t.count)}</small>)}</div>
        <div><h3>Model mix</h3>{list(u.modelUsage).slice(0, 6).map((m, i) => <small key={i}>{str(m.model) || str(m.provider)} · {tok(rec(m.totals).totalTokens)}</small>)}</div>
      </div>
      <h3>Usage over time</h3>
      <Seg label="Over time" value={run ? "run" : "each"} options={[{ id: "each", label: "Each turn" }, { id: "run", label: "Running total" }]} onChange={(v) => setRun(v === "run")} />
      {series.error ? <p className="s2usage-err">{series.error}</p> : max ? <div className="s2usage-chart" style={{ height: 60 }}>{pts.map((v, i) => <span key={i} className="s2usage-bar" style={{ height: `${Math.max(3, (v / max) * 100)}%` }} />)}</div> : <p className="hint">{series.loading ? "Loading…" : "No usage over time recorded."}</p>}
      <h3>Messages</h3>
      <input className="inp" type="search" placeholder="Search messages" aria-label="Search messages" value={find} onChange={(e) => setFind(e.target.value)} />
      {logs.error ? <p className="s2usage-err">{logs.error}</p> : null}
      <div className="rows">{msgs.slice(0, 50).map((l, i) => <div className="prow" key={i}><span className="grow"><b>{l.role === "assistant" ? c.trunk : ROLE[str(l.role)] ?? str(l.role)}</b><small>{str(l.content).slice(0, 240)}</small></span></div>)}</div>
      {logs.data && !msgs.length ? <p className="hint">No messages match.</p> : null}
    </div>
  );
}
const ROLE: Record<string, string> = { user: "You", tool: "Tool", toolResult: "Tool result" };

/* ---------- export ---------- */
const cell = (v: unknown) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, "\"\"")}"` : t; };
export function csv(rows: unknown[][]): string { return rows.map((r) => r.map(cell).join(",")).join("\n"); }

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function exportItems(data: RecordValue, all: Day[], names: Map<string, string>) {
  const stamp = `${str(data.startDate)}_${str(data.endDate)}`;
  const conv = () => download(`usage-conversations-${stamp}.csv`, csv([["Conversation", "Trunk", "Tokens", "Cost (USD)", "Messages", "Errors", "Last active"],
    ...convs(list(data.sessions), names).map((c) => [c.name, c.trunk, c.tokens, c.cost.toFixed(4), c.messages, c.errors, c.updated ? new Date(c.updated).toISOString() : ""])]), "text/csv");
  const days = () => download(`usage-days-${stamp}.csv`, csv([["Date", "Tokens", "Cost (USD)", "Input", "Output", "Cache read", "Cache write", "Messages", "Errors"],
    ...all.map((d) => [d.date, d.tokens, d.cost.toFixed(4), d.inp, d.out, d.cr, d.cw, d.messages, d.errors])]), "text/csv");
  const everything = () => download(`usage-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
  return [{ label: "Conversations (CSV)", run: conv }, { label: "Each day (CSV)", run: days }, { label: "Everything (JSON)", run: everything }];
}

/* ======================================================================================================
   Settings rows
   ====================================================================================================== */
type Cfg = ReturnType<typeof useConfig>;
const flag = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
// TODO(engine-lane): turning off "Asking a service what is left" needs a usage setting (old usage/limits/settings).
const NO_ASK = "The engine asks each connected service when this page opens; turning that off needs an engine setting.";
const NO_CKPT = "Listing checkpoints needs a checkpoint method in the engine.";
const NO_EVAL = "Test sets and graders need evals in the engine.";
const NO_EXPORT = "Exporting everything needs an export method in the engine; today it runs as branch backup create in a terminal.";
const CLI_BACKUP = "This runs from a terminal (branch backup) or the Branch app; the engine has no method for it.";
// TODO(engine-lane): spend caps per service need the engine to pause at a limit (old usage/budget).
const NO_CAPS = "Spend caps need the engine to pause work at a limit.";
const NO_PROJECT = "Cost by project needs the engine to count usage by project.";
const NO_SAVE_FIRST = "Saving conversations before they are removed needs an engine setting.";
const NO_HELD = "Holding what a restore left out needs the engine’s restore.";
const NO_DRY = "A dry run needs the engine; today it runs from a terminal.";
const NO_FLAG = "Sending a flagged reply needs a way to reach the Branch team in the engine.";
const NO_RESET = "Resetting runs from a terminal (branch reset) or the Branch app; the engine has no reset method.";
const NO_WIPE = "Deleting everything runs from a terminal (branch reset --scope full) or the Branch app; the engine has no method for it.";
const NOT_INSTALLED = "Its plugin isn’t installed; add it in Plugins.";
const NO_MEDIA = "The engine doesn’t count picture and video spend on its own.";

/** "30" from "30d", "12h" → "0.5", a number of days → itself. */
export function daysFrom(v: unknown): string {
  if (typeof v === "number") return String(v);
  const m = /^(\d+(?:\.\d+)?)\s*(ms|d|h|m|s)?$/i.exec(str(v).trim());
  if (!m) return str(v);
  const per: Record<string, number> = { d: 1, h: 24, m: 1440, s: 86_400, ms: 86_400_000 };
  return String(Math.round((Number(m[1]) / per[(m[2] ?? "d").toLowerCase()]) * 100) / 100);
}
/** "10" from "10gb", 10737418240 → "10"; false → "". */
export function gbFrom(v: unknown): string {
  if (v === false) return "";
  const m = /^(\d+(?:\.\d+)?)\s*([kmgt]?b?)?$/i.exec(typeof v === "number" ? String(v) : str(v).trim());
  if (!m) return str(v);
  const unit = (m[2] ?? "b").toLowerCase().replace(/b$/, "") || "b";
  const per: Record<string, number> = { b: 1024 ** 3, k: 1024 ** 2, m: 1024, g: 1, t: 1 / 1024 };
  return String(Math.round((Number(m[1]) / per[unit]) * 100) / 100);
}

/** Read the same duration units as session.maintenance.pruneAfter (bare numbers mean days). */
function retentionDays(v: unknown): number | null {
  const raw = str(v).trim().toLowerCase();
  const per: Record<string, number> = { ms: 86_400_000, s: 86_400, m: 1440, h: 24, d: 1 };
  const single = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(raw);
  if (single) return Number(single[1]) / per[single[2] ?? "d"];
  const parts = [...raw.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)];
  if (!parts.length || parts.map(([token]) => token).join("") !== raw) return null;
  return parts.reduce((days, [, amount, unit]) => days + Number(amount) / per[unit], 0);
}

/** A config value as a number for Num: undefined (engine default) when unset or unreadable. */
const asNum = (v: string): number | undefined => (v.trim() === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));

/** The connection rows under the allowances: what the engine doesn't do yet is greyed with why. */
function AllowanceRows({ engine }: { engine: WindowEngine }) {
  const ckptOn = useCkptOn(engine);
  return (
    <>
      <Ctl title="Offer to save progress at 95%" sub={<>It asks once per account window, never for an estimate. <button type="button" className="link-k" onClick={() => window.dispatchEvent(new Event(CKPT_SHOW))}>Show me</button></>}><Switch label="Offer to save progress at 95%" checked={ckptOn} onChange={(on) => void lookStore(engine).set(CKPT_PREF, on)} /></Ctl>
      <Ctl title="Asking a service what is left" off={NO_ASK}><Switch label="Asking a service what is left" checked onChange={() => undefined} /></Ctl>
      <DesktopCtl title="Show usage in the tray" sub="A small ring by the clock opens the same list." name="trayUsage" />
    </>
  );
}

function Keeping({ engine, lv }: { engine: WindowEngine; lv: number }) {
  const config = useConfig(engine);
  const [manage, setManage] = useState(false);
  const maintenance = rec(config.get("session.maintenance"));
  const pruneAfter = maintenance.pruneAfter;
  const days = pruneAfter == null || pruneAfter === "" ? null : retentionDays(pruneAfter);
  const keep = maintenance.mode === "warn" || pruneAfter == null || pruneAfter === "" || days === 0
    ? "forever"
    : days === 30 ? "30" : days === 365 ? "365" : "";
  const sub = `Older ones are deleted for good.${keep ? "" : ` Now: ${days === null ? str(pruneAfter) : `${days} day${days === 1 ? "" : "s"}`}.`}`;
  const setKeep = (v: string) => void config.set("session.maintenance", {
    ...maintenance,
    mode: v === "forever" ? "warn" : "enforce",
    ...(v === "forever" ? {} : { pruneAfter: `${v}d` }),
  });
  return (
    <Sec title="Keeping things">
      <Ctl title="Keep conversations" sub={sub}>
        <Seg label="Keep conversations" value={keep} options={[{ id: "30", label: "30 days" }, { id: "365", label: "1 year" }, { id: "forever", label: "Forever" }]} disabled={config.loading} onChange={setKeep} />
      </Ctl>
      <Ctl title="Checkpoints" sub="Kept before a Trunk changes files. Put any of them back." off={NO_CKPT}><Btn sm>See all</Btn></Ctl>
      {lv >= 1 ? <Ctl title="Conversations" sub="Pick several to delete, or clear the archive."><Btn sm onClick={() => setManage(true)}>Manage</Btn></Ctl> : null}
      {manage ? <ManageDialog engine={engine} onClose={() => setManage(false)} /> : null}
    </Sec>
  );
}

/** Manage conversations: sessions.list (active or archived), several deleted with sessions.delete. */
function ManageDialog({ engine, onClose }: { engine: WindowEngine; onClose: () => void }) {
  const [arch, setArch] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ask, setAsk] = useState<"" | "some" | "archived">("");
  const res = useLive<RecordValue>(engine, "sessions.list", { archived: arch ? true : "all", limit: 200, includeDerivedTitles: true }, ["sessions"]);
  const call = useCall();
  const rows = list(rec(res.data).sessions);
  const keys = rows.map((r) => str(r.key));
  const toggle = (k: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n; });
  const del = (which: string[], archivedOnly: boolean) => void call.run(async () => {
    for (const k of which) { const r = rows.find((x) => str(x.key) === k); await engine.request("sessions.delete", { key: k, ...(str(r?.agentId) ? { agentId: str(r?.agentId) } : {}), ...(archivedOnly ? { archivedOnly: true } : {}) }); await forgetDeletedConversationWindow(k); }
    setSel(new Set()); setAsk(""); void res.reload();
  }, () => `Deleted ${which.length} ${which.length === 1 ? "conversation" : "conversations"}.`);
  if (ask) {
    const which = ask === "archived" ? keys : [...sel];
    return (
      <Dialog title={ask === "archived" ? "Delete all archived?" : `Delete ${which.length} conversations?`} onClose={() => setAsk("")} footer={<><Btn ghost onClick={() => setAsk("")}>Cancel</Btn><Btn className="bad" disabled={call.busy} onClick={() => del(which, ask === "archived")}>Delete</Btn></>}>
        <p>{ask === "archived" ? `Delete ${which.length} archived conversations and their transcripts? ` : ""}Any task still running in them stops safely first.</p>
        <CallLine call={call} />
      </Dialog>
    );
  }
  return (
    <Dialog title="Conversations" wide onClose={onClose}>
      <Acts><Seg label="Which conversations" value={arch ? "Archived" : "All"} options={[{ id: "All", label: "All" }, { id: "Archived", label: "Archived" }]} onChange={(v) => { setArch(v === "Archived"); setSel(new Set()); }} /></Acts>
      {sel.size ? <div className="s2-find"><b>{sel.size} selected</b><Btn ghost sm onClick={() => setSel(new Set())}>Unselect</Btn><Btn sm className="bad" onClick={() => setAsk("some")}>Delete</Btn></div> : null}
      {res.error ? <p className="s2-err" role="alert">{res.error}</p> : null}
      {rows.length ? (
        <>
          <label className="chk"><input type="checkbox" checked={sel.size === keys.length} onChange={(e) => setSel(new Set(e.target.checked ? keys : []))} /> Select all on this page</label>
          <div className="rows">{rows.map((r) => (
            <label className="prow" key={str(r.key)}>
              <input type="checkbox" checked={sel.has(str(r.key))} onChange={(e) => toggle(str(r.key), e.target.checked)} />
              <span className="grow"><b>{str(r.label) || str(r.derivedTitle) || str(r.displayName) || str(r.key)}</b><small>{when(r.updatedAt)}{r.archived === true ? " · archived" : ""}</small></span>
            </label>
          ))}</div>
        </>
      ) : res.data ? <Empty>{arch ? "Nothing is archived." : "No conversations."}</Empty> : null}
      {arch && rows.length ? <Acts><Btn sm className="bad" onClick={() => setAsk("archived")}>Delete all archived…</Btn></Acts> : null}
      <CallLine call={call} />
    </Dialog>
  );
}

const SUITES: [string, string][] = [
  ["Right actions", "Picks the right tools, helpers and safety steps · Exact and judge graders · passes at 90%"],
  ["Memory recall", "Answers from what it remembers, and how fast · Judge model · passes at 90%"],
  ["Recall after tidying up", "What survives when a long conversation is tidied · Judge model · passes at 90%"],
  ["Does it follow the skill", "Steps a skill requires, checked in the tool calls · From each skill · Tool-call grader · passes at 90%"],
  ["Pretend users", "A model plays a user with a goal; a judge decides · Judge model · passes at 90%"],
  ["Memory attacks", "Poisoning attempts against memory, blocked or not · Exact grader · passes at 90%"],
  ["Scenarios", "Scripted runs against the running app · Checks · passes at 90%"],
  ["Check a change by running it", "Builds, tests and the page itself, before and after · Per change · Evidence · passes at 90%"],
];
const BENCH: [string, string][] = [
  ["Terminal tasks", "Terminal-Bench style tasks, failures sorted"], ["Coding exercises", "Exercises in many languages, in throwaway folders"],
  ["Desktop tasks", "OSWorld, in virtual machines"], ["Web tasks", "WebVoyager"], ["Research questions", "FRAMES, graded by a judge"], ["Public benchmarks", "Several suites, run head to head"],
];
const EVAL_ROWS: [string, string, string][] = [
  ["Test sets", "Make from conversations", "Inputs and expected answers, versioned."], ["Write tests for me", "Start", "Reads what a Trunk does, writes scenarios, and keeps only the ones proved to work."],
  ["Grade past runs", "Choose runs", ""], ["Compare two versions", "Choose versions", "Same seeded tasks; cost, cache and tool trouble side by side."], ["Coverage report", "Open", "Which tools and rules have cases."],
];
const GRADERS = ["Exact: matches, coverage of key words, tone", "Judge model: faithful, relevant, no made-up facts, rubric, whole conversations", "Right tools in the right order", "Was it really done (from the steps and screenshots)", "Before-and-after screenshots described", "Coding sessions: outcome and effort"];

function TestModel() {
  return (
    <Sec title="Test the model you use" hint="Check your model against a ready-made test set." help="Run a ready-made set of tasks against the model you use now, see which it got right, what it cost, and whether anything that used to work has stopped.">
      <Ctl title="Test set" sub="Each task is checked the same way every time." off={NO_EVAL}>
        <Seg label="Test set" value="everyday" options={[{ id: "everyday", label: "Everyday" }, { id: "money", label: "Money" }, { id: "research", label: "Research" }]} onChange={() => undefined} />
      </Ctl>
      <Acts><Btn disabled title={NO_EVAL}>Run the test</Btn></Acts>
    </Sec>
  );
}

function Evals({ lv }: { lv: number }) {
  const run = <Btn sm disabled title={NO_EVAL}>Run</Btn>;
  return (
    <Sec title="Evals" hint="Test sets you can run against your own model. Nothing runs by itself.">
      <Plist>{SUITES.map(([t, s]) => <Prow key={t} icon={<Tile><Ico name="check" s /></Tile>} title={t} sub={s}>{run}</Prow>)}</Plist>
      <Ctl title="Run each suite" sub="Repeated runs reveal cases that change." help="Several runs show which cases flip, and whether the Trunk or the judge is to blame." off={NO_EVAL}>
        <select className="inp" aria-label="Run each suite"><option>Once</option><option>3 times</option><option>5 times</option></select>
      </Ctl>
      <Ctl title="Replay recorded tool calls" sub="Tools aren’t run again; a call that doesn’t match stops the case." off={NO_EVAL}><Switch label="Replay recorded tool calls" checked={false} onChange={() => undefined} /></Ctl>
      <Ctl title="Rehearse without running tools" sub="A model writes what each tool would have returned." off={NO_EVAL}><Switch label="Rehearse without running tools" checked={false} onChange={() => undefined} /></Ctl>
      {lv >= 1 ? (
        <>
          <Hint>Graders</Hint>
          <ul className="s2usage-cmds">{GRADERS.map((g) => <li key={g}>{g}</li>)}</ul>
          {EVAL_ROWS.map(([t, b, sub]) => <Ctl key={t} title={t} sub={sub || undefined} off={NO_EVAL}><Btn sm disabled>{b}</Btn></Ctl>)}
          <Hint>Benchmarks</Hint>
          <Plist>{BENCH.map(([t, s]) => <Prow key={t} title={t} sub={s}>{run}</Prow>)}</Plist>
          <Hint>Results over time and the hardest tasks show here after a run.</Hint>
        </>
      ) : null}
    </Sec>
  );
}

const CATALOGS: [string, string][] = [["anthropic", "Show Claude Code conversations"], ["codex", "Show Codex conversations"], ["opencode", "Show OpenCode conversations"]];
const catalogPath = (id: string) => `plugins.entries.${id}.config.sessionCatalog.enabled`;

function MovingInOut({ engine, lv }: { engine: WindowEngine; lv: number }) {
  const config = useConfig(engine);
  const [move, setMove] = useState(false);
  const plugins = useLive<RecordValue>(engine, "plugins.list", {}, ["plugins"]);
  const installed = new Set(list(rec(plugins.data).plugins).filter((p) => p.installed === true).map((p) => str(p.id)));
  const present = CATALOGS.filter(([id]) => installed.has(id));
  const on = (id: string) => flag(config.get(catalogPath(id)), true);
  const all = present.length > 0 && present.every(([id]) => on(id));
  const setAll = async (v: boolean) => { for (const [id] of present) if (!(await config.set(catalogPath(id), v))) return; };
  const busy = config.loading || !plugins.data;
  return (
    <Sec title="Moving in and out">
      <Ctl title="Move in from another assistant" sub="Bring in memories from other coding apps." help="Memory and instructions from Claude Code or Hermes Agent, as the engine finds them on this computer."><Btn sm onClick={() => setMove(true)}>Move in…</Btn></Ctl>
      <Ctl title="Show other assistants’ conversations" sub="Show other coding-app conversations without copying them." help="Claude Code, Codex, OpenCode and other assistants on this computer and your paired computers, in their own group in the list. Shown, not copied. Off until you choose: it reads other assistants’ conversation history on this computer.">
        <Switch label="Show other assistants’ conversations" checked={all} disabled={busy || !present.length} onChange={(v) => void setAll(v)} />
      </Ctl>
      {plugins.error ? <p className="hint s2-err" role="alert">{plugins.error}</p> : null}
      <Ctl title="Take everything with you" sub="Your Trunks, skills, procedures, memory and settings as one file." help="Your Trunks, skills, procedures, memory and settings as one file. Keys never go in it." off={NO_EXPORT}><Btn sm>Export…</Btn></Ctl>
      {lv >= 1 ? (
        <>
          <Hint>Show the conversations other coding apps keep, from this computer and your paired computers, in the sidebar. Applies to everyone on this Gateway.</Hint>
          {CATALOGS.map(([id, t]) => (
            <Ctl key={id} title={t} sub={`Lists that app’s conversations in the sidebar.${id === "opencode" ? "" : " Off until you choose: it reads another app’s conversations."}${id === "codex" ? " Takes effect after the Gateway restarts." : ""}`} off={plugins.data && !installed.has(id) ? NOT_INSTALLED : undefined}>
              <Switch label={t} checked={installed.has(id) && on(id)} disabled={busy} onChange={(v) => void config.set(catalogPath(id), v)} />
            </Ctl>
          ))}
          <Ctl title="Plugins that read other apps" sub="Each app’s conversations come through its plugin."><Btn sm onClick={() => openPlace("customize", "Plugins")}>Manage plugins</Btn></Ctl>
        </>
      ) : null}
      {lv >= 2 ? <CodexFolders config={config} /> : null}
      {move ? <MoveInDialog engine={engine} onClose={() => setMove(false)} /> : null}
    </Sec>
  );
}

/** More Codex folders: plugins.entries.codex.config.sessionCatalog.homes (paths, or {path, label}). */
function CodexFolders({ config }: { config: Cfg }) {
  const path = "plugins.entries.codex.config.sessionCatalog.homes";
  const homes = Array.isArray(config.get(path)) ? (config.get(path) as unknown[]) : [];
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const name = (h: unknown) => str(h) || str(rec(h).path);
  const add = () => {
    const v = draft.trim();
    if (!v) { setErr("Enter a folder."); return; }
    if (homes.some((h) => name(h) === v)) { setErr("That folder is already listed."); return; }
    setErr(""); setDraft(""); void config.set(path, [...homes, v]);
  };
  return (
    <Ctl title="More Codex folders" sub="Folders Branch also reads Codex conversations from." help="Folders Branch also reads Codex conversations from. Takes effect after the Gateway restarts." after={
      <div className="s2usage-x">
        <div className="s2usage-list">{homes.length ? homes.map((h) => <span className="chip6" key={name(h)}>{name(h)}<button type="button" className="ib" aria-label={`Remove ${name(h)}`} onClick={() => void config.set(path, homes.filter((x) => x !== h))}><Ico name="x" s /></button></span>) : <small>None.</small>}</div>
        <div className="acts"><input className="inp" aria-label="More Codex folders: add" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} /><Btn sm onClick={add}>Add</Btn></div>
        {err ? <small className="s2-err" role="alert">{err}</small> : null}
      </div>
    } />
  );
}

/** Move in: migrations.memory.plan finds what each assistant has; migrations.memory.apply brings the planned items in. */
export function MoveInDialog({ engine, onClose }: { engine: WindowEngine; onClose: () => void }) {
  const agentId = engine.agentId || "main";
  const plan = useQuery(engine, "migrations.memory.plan", { agentId });
  const [pick, setPick] = useState("");
  const [done, setDone] = useState<RecordValue | null>(null);
  const call = useCall();
  const providers = list(rec(plan.data).providers);
  const chosen = providers.find((p) => str(p.providerId) === pick);
  const items = list(chosen?.items).filter((i) => i.status === "planned");
  const go = () => void call.run(async () => setDone(rec(await engine.request("migrations.memory.apply", { idempotencyKey: crypto.randomUUID(), agentId, providerId: pick, planFingerprint: str(chosen?.planFingerprint), itemIds: items.map((i) => str(i.id)) }))));
  if (done) {
    const s = rec(done.summary);
    return <Dialog title="Move-in complete" onClose={onClose}><p>{num(s.migrated)} brought in · {num(s.errors)} failed · {num(s.conflicts)} clashes</p>{str(done.reportDir) ? <Kv rows={[["Report", <code key="r">{str(done.reportDir)}</code>]]} /> : null}</Dialog>;
  }
  return (
    <Dialog title="Move in from another assistant" wide onClose={onClose} footer={<><Btn ghost onClick={onClose}>Not now</Btn><Btn pri disabled={!items.length || call.busy} onClick={go}>Bring it in</Btn></>}>
      <p>Branch looked on this computer. Everything comes in as a copy; the other assistant keeps working.</p>
      {plan.error ? <p className="s2-err" role="alert">{plan.error}</p> : null}
      {plan.loading ? <p className="hint">Looking…</p> : null}
      <div className="s2-opts">{providers.map((p) => (
        <button key={str(p.providerId)} type="button" className="s2-opt" role="radio" aria-checked={pick === str(p.providerId)} disabled={p.found !== true} onClick={() => setPick(str(p.providerId))}>
          <b>{str(p.label) || str(p.providerId)}</b><small>{p.found === true ? "Found on this computer" : str(p.message) || "Not found here"}</small>
        </button>
      ))}</div>
      {plan.data && !providers.length ? <Empty>No other service has memories to bring in.</Empty> : null}
      {chosen ? (
        <div className="rows">
          {items.map((i) => <Prow key={str(i.id)} title={str(i.target) || str(i.id)} sub={str(i.source)}><Pill tone="ok">Comes in</Pill></Prow>)}
          <Prow title="Keys and passwords" sub="Never copied; you sign in again where needed"><Pill>Left out</Pill></Prow>
        </div>
      ) : <Hint>Pick one to see what comes in.</Hint>}
      <CallLine call={call} />
    </Dialog>
  );
}

/** Money and keeping, more (Advanced). */
// TODO(engine-lane): metering export (the old app's usage/metering and usage/metering/now: write the usage figures to
// a workspace folder on a schedule, or now). The artifact has no row for it; add one here, styled like "Backups",
// once the engine has the method.
function MoneyMore({ engine, lv }: { engine: WindowEngine; lv: number }) {
  const [backups, setBackups] = useState(false);
  const usage = useLive<RecordValue>(engine, "usage.status", {}, []);
  const balances = list(rec(usage.data).providers).flatMap((p) => list(p.billing).filter((b) => b.type === "balance").map((b) => `${str(p.displayName)}: ${str(b.unit) === "USD" ? money(b.amount) : `${num(b.amount)} ${str(b.unit)}`}`));
  return (
    <Sec title="Money and keeping, more" group="Keeping things" showHeading={false}>
      <Ctl title="Spend caps per service" sub="Pauses work when a service reaches its monthly limit." help="A monthly limit for each service that bills per use; work pauses and asks when one is reached." off={NO_CAPS}><Btn sm>Set caps</Btn></Ctl>
      <Ctl title="Prepaid balances" sub={balances.length ? balances.join(" · ") : "For services that sell credit, how much is left, checked when you open this page."}>
        <Btn sm disabled={usage.loading} onClick={() => void usage.reload()}>Check now</Btn>
      </Ctl>
      <Ctl title="What each project cost" sub="Spend by project and by conversation, for the period you pick." off={NO_PROJECT}><Btn sm>See projects</Btn></Ctl>
      <Ctl title="Backups" sub="Back up conversations, memory and settings on a schedule." help="A copy of your conversations, memory and settings, on a schedule you choose."><Btn sm onClick={() => setBackups(true)}>See backups</Btn></Ctl>
      <Ctl title="Saved before it’s deleted" sub="Export old conversations before removing them." help="Conversations older than your limit are exported to a file first, then removed." off={NO_SAVE_FIRST}><Btn sm>See the next one</Btn></Ctl>
      <Ctl title="Things held for your yes" sub="Hold restore conflicts here for your review." help="After a restore, anything that didn’t match waits here instead of being overwritten." off={NO_HELD}><Btn sm>See them</Btn></Ctl>
      {backups ? <BackupsDialog engine={engine} lv={lv} onClose={() => setBackups(false)} /> : null}
    </Sec>
  );
}

const KIND: Record<string, string> = { archive: "Archive", "sqlite-snapshot": "Database snapshot", git: "Git", external: "Made by another program" };

/** Backups: backup.status (each place's newest run, schedules, places) and storage.locations.probe for Check. */
function BackupsDialog({ engine, lv, onClose }: { engine: WindowEngine; lv: number; onClose: () => void }) {
  const res = useLive<RecordValue>(engine, "backup.status", {}, ["cron"]);
  const run = useCall();
  const data = rec(res.data);
  const targets = list(data.targets); const schedules = list(data.schedules); const places = list(data.locations);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const check = async (name: string) => {
    try { const r = rec(await engine.request("storage.locations.probe", { name })); setProbe((p) => ({ ...p, [name]: str(r.message) || str(r.state) })); }
    catch (e) { setProbe((p) => ({ ...p, [name]: errorText(e) })); }
  };
  return (
    <Dialog title="Backups" wide onClose={onClose}>
      {res.error ? <p className="s2-err" role="alert">{res.error}</p> : null}
      <h3 className="s2-h3">Backups</h3>
      {targets.length ? <div className="rows">{targets.map((t, i) => <BackupRow key={i} t={t} />)}</div> : res.data ? <Empty>No backups yet.</Empty> : null}
      <p className="hint">If the newest success is older than 14 days, it says “No backup in 14 days”.</p>
      <div className="acts"><Btn sm disabled={!schedules.some((s) => s.mode === "git") || run.busy} title={schedules.some((s) => s.mode === "git") ? undefined : "Choose where backups go in Settings › Backups first."} onClick={() => void run.run(async () => rec(await engine.request("backup.run", {})), (r) => r.started === true ? "Backing up…" : `Didn’t start: ${str(r.reason) || "the engine declined"}.`)}>Back up now</Btn>{["Check a backup", "Restore…"].map((b) => <Btn key={b} sm disabled title={CLI_BACKUP}>{b}</Btn>)}</div>
      <CallLine call={run} />
      <h3 className="s2-h3">On a schedule</h3>
      {schedules.length ? <div className="rows">{schedules.map((s) => <Prow key={str(s.id)} title={s.mode === "git" ? "Git" : "Copy elsewhere"} sub={`${str(s.target)} · every ${span(s.everyMs)}${s.nextRunAtMs ? ` · next ${when(s.nextRunAtMs)}` : ""}`}><Pill tone={s.enabled === true ? "ok" : "idle"}>{s.enabled === true ? "On" : "Off"}</Pill></Prow>)}</div> : <p className="hint">Nothing is scheduled. Choose a schedule in Settings › Backups.</p>}
      <h3 className="s2-h3">Where backups go</h3>
      {places.length ? <div className="rows">{places.map((p) => (
        <Prow key={str(p.name)} icon={<Tile><Ico name={str(p.provider) === "local" ? "folder" : "globe"} s /></Tile>} title={str(p.name)} sub={`${str(p.provider)}${str(p.displayTarget) ? ` · ${str(p.displayTarget)}` : ""} · encryption: ${p.encrypted === true ? "passphrase" : "none"}${probe[str(p.name)] ? ` · ${probe[str(p.name)]}` : ""}`}>
          <Btn ghost sm onClick={() => void check(str(p.name))}>Check</Btn>
        </Prow>
      ))}</div> : <p className="hint">None yet.</p>}
      {lv >= 2 ? <CodeRow title="Record a backup another program made" code="branch backup record --status ok --target ‹label›" /> : null}
    </Dialog>
  );
}

function BackupRow({ t }: { t: RecordValue }) {
  const latest = rec(t.latest); const ok = rec(t.latestOk);
  const sub = [str(t.target), latest.createdAt ? `last ${when(latest.createdAt)}` : "", ok.createdAt && ok.createdAt !== latest.createdAt ? `last success ${when(ok.createdAt)}` : "", latest.bytes ? bytes(latest.bytes) : "", str(latest.error)].filter(Boolean).join(" · ");
  return <Prow icon={<Tile><Ico name={t.kind === "git" ? "branch" : "disk"} s /></Tile>} title={KIND[str(t.kind)] ?? str(t.kind)} sub={sub}><Pill tone={latest.status === "ok" ? "ok" : "bad"}>{latest.status === "ok" ? "Succeeded" : "Failed"}</Pill></Prow>;
}

const M = "session.maintenance";

/** Keeping things, more (Advanced): session.maintenance.*, sessions.cleanup, sessions.storage.*, attachments.ttlHours. */
function KeepingMore({ engine, lv }: { engine: WindowEngine; lv: number }) {
  const config = useConfig(engine);
  const [store, setStore] = useState(false);
  const tidy = useCall(); const cold = useCall();
  const g = (k: string) => config.get(`${M}.${k}`);
  const compress = flag(g("coldStorage.enabled"), false);
  const ttl = config.get("attachments.ttlHours");
  const runTidy = () => void tidy.run(async () => rec(await engine.request("sessions.cleanup", { allAgents: true })), tidyNote);
  const runCold = () => void cold.run(async () => rec(await engine.request("sessions.storage.run", {})), (r) => coldNote(rec(r.maintenance)));
  return (
    <Sec title="Keeping things, more" group="Keeping things" showHeading={false}>
      <Ctl title="Tidy the list" sub={str(g("mode")) === "warn" ? "Branch only tells you what it would tidy." : "Idle conversations leave the list; search still finds them."}>
        <Seg label="Tidy the list" value={str(g("mode")) === "warn" ? "warn" : "enforce"} options={[{ id: "enforce", label: "Do it" }, { id: "warn", label: "Only warn" }]} disabled={config.loading} onChange={(v) => void config.set(`${M}.mode`, v)} />
      </Ctl>
      <Ctl title="Archive conversations idle for" sub="They leave the list; search still finds them."><Num label="Archive conversations idle for" unit="days" min={1} placeholder="30" value={asNum(daysFrom(g("pruneAfter") ?? ""))} onCommit={(v) => void config.set(`${M}.pruneAfter`, v === null ? null : `${v}d`)} /></Ctl>
      <Ctl title="Most conversations in the list" sub="The oldest idle ones are archived first past this."><Num label="Most conversations in the list" min={1} placeholder="5000" value={asNum(str(g("maxEntries")))} onCommit={(v) => void config.set(`${M}.maxEntries`, v === null ? null : Math.round(v))} /></Ctl>
      <Ctl title="Space for conversations, per Trunk" sub="Past 80%, the oldest archived transcripts are removed first."><Num label="Space for conversations, per Trunk" unit="GB" min={1} placeholder="10" value={asNum(gbFrom(g("maxDiskBytes") ?? ""))} onCommit={(v) => void config.set(`${M}.maxDiskBytes`, v === null ? null : `${v}gb`)} /></Ctl>
      <Ctl title="Try a tidy-up" sub="Lists what would be archived or removed, changing nothing." off={NO_DRY}><Btn sm>Show me</Btn></Ctl>
      <Ctl title="Tidy now" sub={tidy.error ?? tidy.note ?? "Archives and removes what the rules above say, now."}><Btn sm disabled={tidy.busy} onClick={runTidy}>Tidy</Btn></Ctl>
      {lv >= 2 ? <CodeRow title="From a terminal" code="branch sessions cleanup --dry-run" sub="Shows what a tidy-up would do." /> : null}
      <Ctl title="Conversation storage" sub="Transcripts, databases and the archive."><Btn sm onClick={() => setStore(true)}>See it</Btn></Ctl>
      <Ctl title="Compress older transcripts" sub="Packs older transcripts into the archive." help="Packs older transcripts into the archive. Off until you choose: it uses processor and disk while it works."><Switch label="Compress older transcripts" checked={compress} disabled={config.loading} onChange={(v) => void config.set(`${M}.coldStorage.enabled`, v)} /></Ctl>
      <Ctl title="After" sub="At least 1 day."><Num label="After" unit="days" min={1} placeholder="30" value={asNum(str(g("coldStorage.afterDays")))} onCommit={(v) => void config.set(`${M}.coldStorage.afterDays`, v === null ? null : Math.round(v))} /></Ctl>
      <Ctl title="Run now" sub={!compress ? "Turn on “Compress older transcripts” first." : cold.error ?? cold.note ?? "Packs transcripts older than the time above, now."}><Btn sm disabled={!compress || cold.busy} onClick={runCold}>Run now</Btn></Ctl>
      <Ctl title="Delete uploaded files after" sub="Files you and chat apps send in." help="Files you and chat apps send in. Pictures Trunks make are not affected. Off until you choose: it deletes files.">
        <Pick label="Delete uploaded files after" value={typeof ttl === "number" ? String(ttl) : "never"} options={[{ id: "never", label: "Never" }, ...[1, 6, 12, 24, 48, 72, 168].map((h) => ({ id: String(h), label: `${h} hour${h > 1 ? "s" : ""}` }))]} onChange={(v) => void config.set("attachments.ttlHours", v === "never" ? null : Number(v))} />
      </Ctl>
      {store ? <StorageDialog engine={engine} onClose={() => setStore(false)} /> : null}
    </Sec>
  );
}

/** What sessions.cleanup did, in words. */
export function tidyNote(r: RecordValue): string {
  const stores = r.allAgents === true ? list(r.stores) : [r];
  const sum = (k: string) => stores.reduce((a, s) => a + num(s[k]), 0);
  const archived = sum("archived") + sum("capArchived");
  const removed = sum("pruned") + sum("capped") + sum("modelRunPruned");
  const freed = stores.reduce((a, s) => a + num(rec(s.diskBudget).freedBytes) + num(rec(s.unreferencedArtifacts).freedBytes), 0);
  const warn = stores.some((s) => s.mode === "warn");
  return `${warn ? "Only warn is on: " : ""}${archived} archived, ${removed} removed${freed ? `, ${bytes(freed)} freed` : ""}.`;
}
function coldNote(m: RecordValue): string {
  if (m.running === true) return "Packing transcripts now.";
  return m.lastCompletedAt ? `Last finished ${when(m.lastCompletedAt)} · ${num(m.archivedTranscripts)} transcripts archived` : "Asked the engine to pack transcripts now.";
}

function StorageDialog({ engine, onClose }: { engine: WindowEngine; onClose: () => void }) {
  const res = useLive<RecordValue>(engine, "sessions.storage.status", {}, []);
  const agents = list(rec(res.data).agents); const m = rec(rec(res.data).maintenance);
  const names = useNames(engine);
  const sum = (k: string) => agents.reduce((a, x) => a + num(x[k]), 0);
  return (
    <Dialog title="Conversation storage" onClose={onClose}>
      {res.error ? <p className="s2-err" role="alert">{res.error}</p> : null}
      {res.data ? (
        <Kv rows={[
          ["Transcripts", `${sum("hotTranscripts")} uncompressed · ${sum("coldTranscripts")} archived`], ["Databases", bytes(sum("databaseBytes"))],
          ["Write-ahead logs", bytes(sum("walBytes"))], ["Archive files", sum("archiveBytes") ? bytes(sum("archiveBytes")) : "none"],
          ["Compressed in the database", bytes(sum("embeddedArchiveBytes"))],
          ...agents.map((a): [string, string] => [names.get(str(a.agentId)) ?? str(a.agentId), bytes(num(a.databaseBytes) + num(a.walBytes) + num(a.archiveBytes))]),
          ["Background upkeep", m.running === true ? "Running" : "Idle"],
          ["Last finished", m.lastCompletedAt ? `${when(m.lastCompletedAt)} · ${num(m.archivedTranscripts)} transcripts archived` : "not run yet"],
          ["Last error", str(m.lastError)],
        ]} />
      ) : null}
    </Dialog>
  );
}

/* ---------- Technical: every conversation setting ---------- */
type Key = [path: string, sub: string, kind: "sel" | "txt" | "json" | "num" | "bool", opts: string[] | null, def: string];
const SESSKEYS: Key[] = [
  ["session.scope", "How conversations are split: one per person, or one for everyone.", "sel", ["per-sender", "global"], "per-sender"],
  ["session.dmScope", "Which direct messages share one conversation.", "sel", ["main", "per-peer", "per-channel-peer", "per-account-channel-peer"], "main"],
  ["session.groupScope", "Group chats: one conversation per group, or all in the main one.", "sel", ["per-group", "main"], "per-group"],
  ["session.notifyOnCreate", "Say so when a chat app starts a new conversation.", "bool", null, "true"],
  ["session.identityLinks", "People who are the same across chat apps, so they share one conversation.", "json", null, "{}"],
  ["session.resetTriggers", "Words that start a conversation fresh.", "json", null, "[\"/new\",\"/reset\"]"],
  ["session.reset.mode", "When a conversation starts fresh by itself.", "sel", ["none", "daily", "idle"], "none"],
  ["session.reset.atHour", "The hour a daily fresh start happens. Set without a mode, it turns on daily fresh starts.", "num", null, "4"],
  ["session.reset.idleMinutes", "Minutes of quiet before an idle fresh start. Set without a mode, it turns on daily fresh starts.", "num", null, "0"],
  ["session.resetByType", "The same, per kind of chat (direct, group, thread).", "json", null, "{}"],
  ["session.resetByChannel", "The same, per chat app.", "json", null, "{}"],
  ["session.maintenance.mode", "Tidy the list, or only warn.", "sel", ["enforce", "warn"], "enforce"],
  ["session.maintenance.pruneAfter", "Time before an untouched conversation is archived.", "txt", null, "30d"],
  ["session.maintenance.archiveDashboardAfter", "Time before an idle conversation in this window is archived.", "txt", null, "7d"],
  ["session.maintenance.maxEntries", "Most conversations in the list.", "num", null, "5000"],
  ["session.maintenance.preserveRecent", "Conversations active within this time are never tidied.", "txt", null, "unset"],
  ["session.maintenance.resetArchiveRetention", "How long archived transcripts are kept before they are deleted.", "txt", null, "until the space limit"],
  ["session.maintenance.maxDiskBytes", "Space for conversations, per Trunk.", "txt", null, "10gb"],
  ["session.maintenance.highWaterBytes", "What a clean-up brings the space down to.", "txt", null, "80% of the space"],
  ["session.sharing.readOnly", "Conversations may be made read-only for others.", "bool", null, "true"],
  ["session.sharing.suggest", "Conversations may take suggestions from others.", "bool", null, "true"],
  ["session.sharing.drafts", "Conversations may be kept as drafts only you see.", "bool", null, "true"],
];

/** The value as typed: numbers for num, JSON for json, booleans for bool; "" means back to default. */
export function parseKey(kind: Key[2], raw: string): unknown {
  if (raw.trim() === "") return null;
  if (kind === "num") { const n = Number(raw); if (!Number.isFinite(n)) throw new Error("Enter a number."); return n; }
  if (kind === "json") return JSON.parse(raw) as unknown;
  if (kind === "bool") return raw === "true";
  return raw;
}

function KeyRow({ k, config }: { k: Key; config: Cfg }) {
  const [path, sub, kind, opts, def] = k;
  const v = path === "session.reset.mode" && config.get(path) === undefined && config.get("session.reset") !== undefined ? "daily" : config.get(path);
  const shown = v === undefined ? (kind === "json" || kind === "num" || kind === "txt" ? "" : def) : kind === "json" ? JSON.stringify(v) : str(v) || String(v);
  const [err, setErr] = useState("");
  const save = (raw: string) => { try { setErr(""); void config.set(path, parseKey(kind, raw)); } catch (e) { setErr(e instanceof SyntaxError ? "That isn’t valid JSON." : errorText(e)); } };
  const control = kind === "sel" ? <Pick label={path} value={shown} options={(opts ?? []).map((o) => ({ id: o, label: o }))} onChange={save} />
    : kind === "bool" ? <Switch label={path} checked={shown !== "false"} onChange={(on) => save(String(on))} />
    : <span className="s2usage-txt"><Field label={path} value={shown} placeholder={def} type={kind === "num" ? "number" : "text"} wide onCommit={save} /></span>;
  return (
    <Ctl id={path} title={path} sub={err || `${sub} Default: ${def}.`}>
      {control}
      {config.get(path) !== undefined ? <Btn ghost sm onClick={() => void config.set(path, null)}>Back to default</Btn> : null}
    </Ctl>
  );
}

function EverySetting({ engine }: { engine: WindowEngine }) {
  const config = useConfig(engine);
  return (
    <Sec title="Conversations, every setting" group="Keeping things" showHeading={false} hint="Every conversation setting the engine has, by its key." help="Every conversation setting the engine has, by its key. Archive conversations idle for (above) sets when they leave the list.">
      {SESSKEYS.map((k) => <KeyRow key={k[0]} k={k} config={config} />)}
    </Sec>
  );
}

/* ---------- flagged replies, reset, your data ---------- */
function Flagged({ lv }: { lv: number }) {
  return (
    <Sec title="Flagged replies">
      <Ctl title="Let me send a flagged reply to the Branch team" sub="Even then each flag asks, and only that reply and your note go." help="Even then each flag asks, and only that reply and your note go. Off until you choose: it sends them outside Branch, to the Branch team." off={NO_FLAG}><Switch label="Let me send a flagged reply to the Branch team" checked={false} onChange={() => undefined} /></Ctl>
      {lv >= 1 ? <Ctl title="Reset Branch" sub="Start over on this computer." off={NO_RESET}><Btn sm className="bad">Reset…</Btn></Ctl> : null}
    </Sec>
  );
}

function YourData({ engine }: { engine: WindowEngine }) {
  const config = useConfig(engine);
  const storage = useLive<RecordValue>(engine, "sessions.storage.status", {}, []);
  const backup = useLive<RecordValue>(engine, "backup.status", {}, []);
  const used = useLive<RecordValue>(engine, "sessions.usage", { range: "30d", ...ALL, ...LOCAL, limit: 1 }, []);
  const agents = list(rec(storage.data).agents);
  const transcripts = agents.reduce((a, x) => a + num(x.hotTranscripts) + num(x.coldTranscripts), 0);
  const size = agents.reduce((a, x) => a + num(x.databaseBytes) + num(x.walBytes) + num(x.archiveBytes), 0);
  const copies = list(rec(backup.data).targets).filter((t) => rec(t.latestOk).createdAt).length;
  const providers = list(rec(rec(used.data).aggregates).byProvider).map((p) => providerName(str(p.provider))).filter(Boolean);
  const search = config.get("tools.web.search.enabled") === false ? "Off" : str(config.get("tools.web.search.provider")) || "Chosen from your keys";
  const git = list(rec(backup.data).schedules).find((s) => s.mode === "git" && s.enabled === true);
  return (
    <Sec title="Your data">
      <Ctl title="What’s kept on this computer" stack after={<ul className="s2usage-data">
        <li><span>Conversations</span><span className="hint">{storage.data ? `${transcripts} · ${bytes(size)}` : ""}</span></li>
        <li><span>Memory</span><span className="hint" /></li>
        <li><span>Files you attached, kept as originals (CSV too)</span><span className="hint" /></li>
        <li><span>Library documents and what Trunks made</span><span className="hint" /></li>
        <li><span>Settings, Trunks and personality files</span><span className="hint" /></li>
        <li><span>Backups</span><span className="hint">{backup.data ? `${copies} ${copies === 1 ? "copy" : "copies"}` : ""}</span></li>
      </ul>} />
      <Ctl title="What leaves this computer" stack after={<ul className="s2usage-data">
        <li><span>Each message, to the model service you picked</span><span className="hint">{providers.join(", ")}</span></li>
        <li><span>Web searches</span><span className="hint">{search}</span></li>
        <li><span>Nothing else, unless you connect it</span><span className="hint" /></li>
      </ul>} />
      <Ctl title="Export everything" sub="Export your conversations, memory and files in one .zip." help="Conversations, memory, Library, attached originals, personality files and household defaults, in one .zip." off={NO_EXPORT}><Btn sm disabled>Export (.zip)</Btn></Ctl>
      <Ctl title="Move to another computer" sub="A locked copy without keys or passwords." help="A locked copy without keys or passwords. Paste it into setup on the other computer and Branch rebuilds itself." off={CLI_BACKUP}><Btn sm disabled>Make a secure snapshot…</Btn></Ctl>
      <BackupsGo data={rec(backup.data)} />
      <Ctl title="Back up to GitHub" sub="Back up to a private repository on a schedule." help="A private repository of yours, on a schedule or just before each update." off={CLI_BACKUP}>
        <Seg label="Back up to GitHub" value={git ? "daily" : "off"} options={[{ id: "off", label: "Off" }, { id: "daily", label: "Every day" }, { id: "update", label: "Before each update" }]} onChange={() => undefined} />
      </Ctl>
      <Ctl title="Restore from a backup" sub="Restore newer files and list what could not be restored." help="A restore keeps this computer’s Trunks and any newer files, and lists exactly what it left out." off={CLI_BACKUP}><Btn sm disabled>Restore…</Btn></Ctl>
      <Ctl title="Pictures and video this month" sub="Counted in the month’s cost with everything else." off={NO_MEDIA} />
      <Ctl title="Delete everything" sub="See every copy of your conversations, files and memory." help="Every conversation, memory, file and backup, and what outside memory services hold for you." off={NO_WIPE}><Btn sm className="bad">Delete everything…</Btn></Ctl>
    </Sec>
  );
}

function BackupsGo({ data }: { data: RecordValue }) {
  const places = list(data.locations).map((l) => str(l.name));
  return (
    <Ctl title="Backups go to" sub="Where scheduled backups are written." off={CLI_BACKUP}>
      <select className="inp" aria-label="Backups go to">{["This computer", ...places].map((p) => <option key={p}>{p}</option>)}</select>
    </Ctl>
  );
}

export const ROWS: RowEntry[] = ([
  ["Offer to save progress at 95%", "Account allowances", 0],
  ["Asking a service what is left", "Account allowances", 0], ["Show usage in the tray", "Account allowances", 0],
  ["Keep conversations", "Keeping things", 0], ["Checkpoints", "Keeping things", 0], ["Conversations", "Keeping things", 1],
  ["Test set", "Test the model you use", 0],
  ...SUITES.map(([t]): [string, string, number] => [t, "Evals", 0]),
  ["Run each suite", "Evals", 0], ["Replay recorded tool calls", "Evals", 0], ["Rehearse without running tools", "Evals", 0],
  ["Test sets", "Evals", 1], ["Write tests for me", "Evals", 1], ["Grade past runs", "Evals", 1], ["Compare two versions", "Evals", 1], ["Coverage report", "Evals", 1],
  ...BENCH.map(([t]): [string, string, number] => [t, "Evals", 1]),
  ["Move in from another assistant", "Moving in and out", 0], ["Show other assistants’ conversations", "Moving in and out", 0], ["Take everything with you", "Moving in and out", 0],
  ...CATALOGS.map(([, t]): [string, string, number] => [t, "Moving in and out", 1]), ["Plugins that read other apps", "Moving in and out", 1], ["More Codex folders", "Moving in and out", 2],
  ["Spend caps per service", "Money and keeping, more", 1], ["Prepaid balances", "Money and keeping, more", 1], ["What each project cost", "Money and keeping, more", 1],
  ["Backups", "Money and keeping, more", 1], ["Saved before it’s deleted", "Money and keeping, more", 1], ["Things held for your yes", "Money and keeping, more", 1],
  ["Tidy the list", "Keeping things, more", 1], ["Archive conversations idle for", "Keeping things, more", 1], ["Most conversations in the list", "Keeping things, more", 1],
  ["Space for conversations, per Trunk", "Keeping things, more", 1], ["Try a tidy-up", "Keeping things, more", 1], ["Tidy now", "Keeping things, more", 1],
  ["From a terminal", "Keeping things, more", 2], ["Conversation storage", "Keeping things, more", 1], ["Compress older transcripts", "Keeping things, more", 1],
  ["After", "Keeping things, more", 1], ["Run now", "Keeping things, more", 1], ["Delete uploaded files after", "Keeping things, more", 1],
  ...SESSKEYS.map(([p]): [string, string, number] => [p, "Conversations, every setting", 2]),
  ["Let me send a flagged reply to the Branch team", "Flagged replies", 0], ["Reset Branch", "Flagged replies", 1],
  ["What’s kept on this computer", "Your data", 0], ["What leaves this computer", "Your data", 0], ["Export everything", "Your data", 0],
  ["Move to another computer", "Your data", 0], ["Backups go to", "Your data", 0], ["Back up to GitHub", "Your data", 0], ["Restore from a backup", "Your data", 0],
  ["Pictures and video this month", "Your data", 0], ["Delete everything", "Your data", 0],
] as [string, string, number][]).map(([title, sec, lv]) => ({ page: "usage", title, ...(sec ? { sec } : {}), group: ({ "Money and keeping, more": "Keeping things", "Keeping things, more": "Keeping things", "Conversations, every setting": "Keeping things" } as Record<string, string>)[sec] ?? (sec || "Data & usage"), lv: lv as 0 | 1 | 2 }));
