// Pure schedule helpers for Automations › Scheduled. The schedule shapes, the auto-disabled record and the
// run-log entry are the engine's own (engine/packages/gateway-protocol/src/schema/cron.ts); the "Repeats"
// choices, words and health readout copy preview patch 41-placesap p30-sched/p35-prop (§4.6.3.1).
import { rec, str, type Row } from "./runtime";

export type Repeat = "daily" | "weekdays" | "weekends" | "weekly" | "monthly" | "once" | "every" | "custom";
export const REPEAT_NAMES: Record<Exclude<Repeat, "custom">, string> = { daily: "Every day", weekdays: "Weekdays", weekends: "Weekends", weekly: "Once a week", monthly: "Monthly", once: "Once", every: "Every…" };
export type EveryUnit = "minutes" | "hours" | "days";
export type ScheduleForm = {
  repeat: Repeat; time: string; weekday: number; monthDay: number; at: string;
  everyN: string; everyUnit: EveryUnit; expr: string; tz: string; exact: boolean; spreadN: string; spreadUnit: "seconds" | "minutes";
};
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const UNIT_MS: Record<EveryUnit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
const pad = (n: number) => String(n).padStart(2, "0");
export const localInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function emptyForm(now = Date.now()): ScheduleForm {
  return { repeat: "daily", time: "09:00", weekday: new Date(now).getDay(), monthDay: 1, at: "", everyN: "30", everyUnit: "minutes", expr: "", tz: "", exact: false, spreadN: "", spreadUnit: "seconds" };
}

/** The cron line a Repeats choice stands for (minute hour day month weekday). */
export function cronLine(form: ScheduleForm): string {
  if (form.repeat === "custom") return form.expr.trim();
  const [h, m] = form.time.split(":").map(Number);
  const hm = `${m} ${h}`;
  if (form.repeat === "weekdays") return `${hm} * * 1-5`;
  if (form.repeat === "weekends") return `${hm} * * 0,6`;
  if (form.repeat === "weekly") return `${hm} * * ${form.weekday}`;
  if (form.repeat === "monthly") return `${hm} ${form.monthDay} * *`;
  return `${hm} * * *`;
}

/** The engine schedule for the card's fields; throws the card's own error words. */
export function formToSchedule(form: ScheduleForm, now = Date.now()): Row {
  if (form.repeat === "once") {
    const date = new Date(form.at);
    if (!form.at || !Number.isFinite(date.getTime()) || date.getTime() <= now) throw new Error("Enter a date and time that hasn’t passed.");
    return { kind: "at", at: date.toISOString() };
  }
  if (form.repeat === "every") {
    const n = Number(form.everyN);
    if (!Number.isFinite(n) || n <= 0) throw new Error("Use a number above 0.");
    return { kind: "every", everyMs: Math.round(n * UNIT_MS[form.everyUnit]) };
  }
  if (form.repeat === "custom" && !form.expr.trim()) throw new Error("Write a cron line.");
  if (form.repeat !== "custom" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.time)) throw new Error("Choose a time.");
  if (form.tz.trim()) {
    try { new Intl.DateTimeFormat("en", { timeZone: form.tz.trim() }).format(); } catch { throw new Error("Choose a time zone this computer knows."); }
  }
  let stagger: number | undefined;
  if (form.exact) stagger = 0;
  else if (form.spreadN.trim()) {
    const n = Number(form.spreadN);
    if (!Number.isFinite(n) || n <= 0) throw new Error("Use a number above 0.");
    stagger = Math.round(n * (form.spreadUnit === "minutes" ? 60_000 : 1000));
  }
  return { kind: "cron", expr: cronLine(form), ...(form.tz.trim() ? { tz: form.tz.trim() } : {}), ...(stagger === undefined ? {} : { staggerMs: stagger }) };
}

const PLAIN = /^(\d{1,2}) (\d{1,2}) (\*|\d{1,2}) \* (\*|1-5|0,6|6,0|[0-6])$/;
/** The card's fields for a saved schedule; a cron line the Repeats choices can't show stays "custom". */
export function scheduleToForm(schedule: Row, now = Date.now()): ScheduleForm {
  const form = emptyForm(now);
  if (schedule.kind === "at") return { ...form, repeat: "once", at: str(schedule.at) ? localInput(new Date(str(schedule.at)).getTime()) : "" };
  if (schedule.kind === "every") {
    const ms = Number(schedule.everyMs) || 0;
    const unit: EveryUnit = ms % UNIT_MS.days === 0 ? "days" : ms % UNIT_MS.hours === 0 ? "hours" : "minutes";
    return { ...form, repeat: "every", everyN: String(ms / UNIT_MS[unit]), everyUnit: unit };
  }
  if (schedule.kind !== "cron") return { ...form, repeat: "custom" };
  const expr = str(schedule.expr).trim(), tz = str(schedule.tz);
  const stagger = typeof schedule.staggerMs === "number" ? schedule.staggerMs : undefined;
  const spread = { exact: stagger === 0, spreadN: stagger ? String(stagger % 60_000 === 0 ? stagger / 60_000 : stagger / 1000) : "", spreadUnit: (stagger && stagger % 60_000 === 0 ? "minutes" : "seconds") as "seconds" | "minutes" };
  const m = PLAIN.exec(expr);
  if (!m || Number(m[1]) > 59 || Number(m[2]) > 23) return { ...form, ...spread, repeat: "custom", expr, tz };
  const time = `${pad(Number(m[2]))}:${pad(Number(m[1]))}`, dom = m[3], dow = m[4];
  const base = { ...form, ...spread, time, expr, tz };
  if (dom !== "*") return dow === "*" ? { ...base, repeat: "monthly", monthDay: Number(dom) } : { ...base, repeat: "custom" };
  if (dow === "*") return { ...base, repeat: "daily" };
  if (dow === "1-5") return { ...base, repeat: "weekdays" };
  if (dow === "0,6" || dow === "6,0") return { ...base, repeat: "weekends" };
  return { ...base, repeat: "weekly", weekday: Number(dow) };
}

export function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** "Weekdays at 8:00 AM", "Every 30 minutes", "Runs when <command> ends"… */
export function scheduleWords(schedule: Row): string {
  const kind = str(schedule.kind);
  if (kind === "on-exit") return `Runs when ${str(schedule.command)} ends`;
  if (kind === "stream") return `Runs on each line from ${Array.isArray(schedule.command) ? schedule.command.join(" ") : str(schedule.command)}`;
  if (kind === "at") return `Once · ${when(new Date(str(schedule.at)).getTime())}`;
  if (kind === "every") {
    const f = scheduleToForm(schedule), n = Number(f.everyN);
    return `Every ${n === 1 ? f.everyUnit.slice(0, -1) : `${n} ${f.everyUnit}`}`;
  }
  if (kind !== "cron") return "Schedule not recorded";
  const f = scheduleToForm(schedule), at = clock(f.time);
  const words: Record<Repeat, string> = { daily: `Every day at ${at}`, weekdays: `Weekdays at ${at}`, weekends: `Weekends at ${at}`, weekly: `${DAYS[f.weekday]}s at ${at}`, monthly: `Monthly on the ${ordinal(f.monthDay)} at ${at}`, once: "", every: "", custom: customWords(str(schedule.expr)) };
  return words[f.repeat];
}

/** Plain words for cron lines the Repeats choices can't show; the line itself shows only at Technical. */
export function customWords(expr: string): string {
  const e = expr.trim().split(/\s+/);
  if (e.length === 5 && e.slice(1).every(x => x === "*")) { const m = /^\*\/(\d+)$/.exec(e[0]); if (m) return `Every ${m[1]} minutes`; if (e[0] === "*") return "Every minute"; }
  if (e.length === 5 && /^\d+$/.test(e[0]) && e.slice(2).every(x => x === "*")) { const h = /^\*\/(\d+)$/.exec(e[1]); if (h) return `Every ${h[1]} hours`; if (e[1] === "*") return "Every hour"; }
  return "On its own schedule";
}

/** "today at 8:00 AM", "tomorrow at 9:00 AM", "Mon 5 Oct at 8:00 AM". */
export function when(ms: unknown, now = Date.now()): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "not recorded";
  const d = new Date(ms), t = clock(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date(now))) / 86_400_000);
  if (diff === 0) return `today at ${t}`;
  if (diff === 1) return `tomorrow at ${t}`;
  if (diff === -1) return `yesterday at ${t}`;
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "")} at ${t}`;
}

const TIME_WORDS = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;
/** Branch's guess from your words: only fills the card's visible fields; nothing saves until you confirm. */
export function guessFromWords(text: string, now = Date.now()): { task: string; form: ScheduleForm } {
  const form = emptyForm(now), lower = text.toLowerCase();
  const every = /\bevery\s+(\d+)\s*(minute|min|hour|hr|day)s?\b/.exec(lower);
  if (every) return { task: tidy(text.replace(every[0], "")), form: { ...form, repeat: "every", everyN: every[1], everyUnit: every[2].startsWith("h") ? "hours" : every[2].startsWith("d") ? "days" : "minutes" } };
  if (/\b(every )?weekdays?\b/.test(lower)) form.repeat = "weekdays";
  else if (/\b(every )?weekends?\b/.test(lower)) form.repeat = "weekends";
  else if (/\b(monthly|every month)\b/.test(lower)) form.repeat = "monthly";
  else {
    const day = DAYS.findIndex(d => new RegExp(`\\b(every )?${d.toLowerCase()}s?\\b`).test(lower));
    if (day >= 0) { form.repeat = "weekly"; form.weekday = day; } else if (/\bweekly|every week\b/.test(lower)) form.repeat = "weekly";
  }
  const scheduleText = lower.match(/\b(every|each|on|at)\b[^,.]*/)?.[0] ?? "";
  const t = TIME_WORDS.exec(scheduleText);
  if (t && (t[3] || /\bat\s/.test(t[0]) || t[2])) {
    let h = Number(t[1]); const m = Number(t[2] ?? 0), mer = (t[3] ?? "").toLowerCase();
    if (mer.startsWith("p") && h < 12) h += 12;
    if (mer.startsWith("a") && h === 12) h = 0;
    if (h <= 23 && m <= 59) form.time = `${pad(h)}:${pad(m)}`;
  }
  const task = text.split(",").length > 1 && /\b(every|each|weekday|weekend|monthly|daily|at \d)/i.test(text.split(",")[0]) ? text.split(",").slice(1).join(",") : text;
  return { task: tidy(task), form };
}
const tidy = (s: string) => { const t = s.trim().replace(/^[,.\s]+|[,.\s]+$/g, ""); return t ? t[0].toUpperCase() + t.slice(1) : ""; };

export type Health = { count: number; failed: number; text: string; warn: boolean; points: string };
/** Old history marked skips as failed completion; execution status wins for those records. */
export const failedRun = (run: Row): boolean => run.status !== "skipped" && (run.status === "error" || run.completionStatus === "failed");
/** "12 runs · all fine" / "7 runs · 7 failed", and the sparkline of run lengths (only from 8 runs up). */
export function health(runs: Row[], total = runs.length): Health | null {
  if (!runs.length) return null;
  const failed = runs.filter(failedRun).length, skipped = runs.filter(r => r.status === "skipped").length;
  // The failure count is page-local: never compare it to a lifetime run total.
  const count = runs.length, recent = Number.isFinite(total) && total > count;
  const text = `${count}${recent ? " recent" : ""} run${count === 1 ? "" : "s"} · ${failed ? `${failed} failed` : skipped ? "" : "all fine"}${skipped ? `${failed ? " · " : ""}${skipped} skipped` : ""}`;
  const last = runs.slice(0, 12).reverse().map(r => Number(r.durationMs) || 0);
  let points = "";
  if (runs.length >= 8 && last.some(v => v > 0)) {
    const max = Math.max(...last), min = Math.min(...last), span = max - min || 1;
    points = last.map((v, i) => `${((i / Math.max(1, last.length - 1)) * 64).toFixed(1)},${(8.6 - ((v - min) / span) * 6.6).toFixed(1)}`).join(" ");
  }
  return { count, failed, text, warn: failed > 0, points };
}

/** The "Turned itself off" pill words, or null when the engine has not switched it off. */
export function autoDisabledWords(job: Row): string | null {
  const auto = rec(rec(job.state).autoDisabled);
  if (!auto.reason) return null;
  const n = Number(auto.consecutiveErrors) || 0;
  return auto.reason === "schedule-errors" ? `Turned itself off · ${n} schedule error${n === 1 ? "" : "s"}` : `Turned itself off · ${n} failed run${n === 1 ? "" : "s"}`;
}

export function failing(job: Row): boolean {
  const s = rec(job.state);
  return Boolean(s.autoDisabled) || (s.lastRunStatus ?? s.lastStatus) === "error" || (s.lastRunStatus !== "skipped" && s.lastCompletionStatus === "failed");
}

/** Active failure streak, not the first historical failure. A skip ends the streak. */
export function failureDetails(job: Row, runs: Row[]): { since: unknown; error: string } | null {
  if (!failing(job)) return null;
  const s = rec(job.state), streak: Row[] = [];
  for (const run of runs) { if (!failedRun(run)) break; streak.push(run); }
  const first = streak.at(-1), last = streak[0];
  return {
    since: s.failingSinceMs ?? first?.runAtMs ?? first?.ts ?? s.lastRunAtMs,
    error: str(s.lastError) || str(s.lastDeliveryError) || str(last?.error) || str(last?.deliveryError),
  };
}

export function copyName(name: string, names: string[]): string {
  const taken = new Set(names);
  if (!taken.has(`${name} copy`)) return `${name} copy`;
  let i = 2;
  while (taken.has(`${name} copy ${i}`)) i++;
  return `${name} copy ${i}`;
}

export const jobName = (job: Row): string => str(job.displayName) || str(job.name) || str(job.id);
export const isTrigger = (job: Row): boolean => Boolean(job.trigger) || ["stream", "on-exit"].includes(str(rec(job.schedule).kind));

/** When a Repeats choice first runs from now, in this computer's time (null when the engine alone can tell). */
export function firstRun(form: ScheduleForm, now = Date.now()): number | null {
  if (form.repeat === "once") { const t = new Date(form.at).getTime(); return Number.isFinite(t) && t > now ? t : null; }
  if (form.repeat === "every") { const n = Number(form.everyN); return Number.isFinite(n) && n > 0 ? now + n * UNIT_MS[form.everyUnit] : null; }
  if (form.repeat === "custom" || form.tz.trim() || !/^\d{2}:\d{2}$/.test(form.time)) return null;
  const [h, m] = form.time.split(":").map(Number);
  for (let i = 0; i < 400; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0);
    if (d.getTime() <= now) continue;
    const day = d.getDay();
    const ok = form.repeat === "daily" || (form.repeat === "weekdays" && day >= 1 && day <= 5) || (form.repeat === "weekends" && (day === 0 || day === 6)) || (form.repeat === "weekly" && day === form.weekday) || (form.repeat === "monthly" && d.getDate() === form.monthDay);
    if (ok) return d.getTime();
  }
  return null;
}

/** The card's summary words for a form: "Weekdays at 8:00 AM". */
export function formWords(form: ScheduleForm): string {
  try { return scheduleWords(formToSchedule(form)); } catch { return form.repeat === "custom" ? form.expr : REPEAT_NAMES[form.repeat]; }
}
