// Settings › Updates: the plain up-to-date line (Private #1102, after Hermes A-157). One sentence with the check's time
// in it, so a Check now that finds nothing still visibly answers, and the time is never said twice ("just now - just now").
import { useEffect, useState } from "react";

export const LATEST_VERSION = "You’re on the latest version";

/** How long ago a check finished, in plain words: "just now", "5 min ago", "2 hours ago", "yesterday", "3 days ago". */
export function checkedAgo(at: number, now: number): string {
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `on ${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** "You’re on the latest version, checked just now"; without a finished check, just the first half. */
export function latestVersionLine(checkedAt: number | null | undefined, now: number): string {
  return typeof checkedAt === "number" && checkedAt > 0 ? `${LATEST_VERSION}, checked ${checkedAgo(checkedAt, now)}` : LATEST_VERSION;
}

/** The current time, re-read every 30 s so "checked just now" becomes "checked 1 min ago" on its own. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  return now;
}
