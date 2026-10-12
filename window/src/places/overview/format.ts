// Words for times, lengths and amounts, worded as the preview's places do (41-placesap helpers dayWordPD18,
// hmPD18, agoPD18). Shared by Overview and Inbox.
import { formatMoney } from "../../format/money";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function clock(at: Date): string {
  const h = at.getHours(), m = at.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Today", "Yesterday", "Tomorrow", or "Mon, Sep 28". */
export function dayWord(at: Date, now = new Date()): string {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(at); b.setHours(0, 0, 0, 0);
  const diff = Math.round((b.getTime() - a.getTime()) / 864e5);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return `${DAYS[b.getDay()].slice(0, 3)}, ${MONTHS[b.getMonth()]} ${b.getDate()}`;
}

/** "Last night, 2:00 AM" (small hours of today), "Today, 9:40 AM", "Mon, Sep 28, 5:02 PM". */
export function whenWord(ms: number, now = new Date()): string {
  const at = new Date(ms), day = dayWord(at, now);
  return day === "Today" && at.getHours() < 6 ? `Last night, ${clock(at)}` : `${day}, ${clock(at)}`;
}

/** "just now", "4 min", "2 h", "3 d". */
export function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 6e4));
  return m < 1 ? "just now" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}

/** A run's length: "40s", "1m 12s", "1h 04m". */
export function runLength(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function money(amount: number): string {
  return formatMoney(amount);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
