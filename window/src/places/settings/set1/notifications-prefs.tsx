// Notifications › your defaults: the engine keeps them in your profile under `notifications.web.v1` (the same key
// push.web.preferences.set writes for scope "user"). The window has no push subscription of its own, so it reads and
// writes the key through users.prefs.get / users.prefs.set. Normalising copies the engine's
// infra/push-web-preferences.ts so every write is the whole, valid object.
import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { errorText, record, visible } from "../adapter";
import { useSaveRunner } from "../kit";

export const PREFS_KEY = "notifications.web.v1";
export const CATEGORY_KEYS = ["approvalRequested", "agentFinished", "agentQuestion", "humanMentioned", "scheduledTaskFailed"] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];
export type Detail = "private" | "identified" | "detailed";
export type Quiet = { enabled: boolean; startMinute: number; endMinute: number; timeZone: string };
export type NotifyPrefs = { categories: Record<CategoryKey, boolean>; detailLevel: Detail; quietHours: Quiet; agentIds: string[] };

/** The engine's own defaults (DEFAULT_WEB_PUSH_NOTIFICATION_PREFERENCES). */
export const DEFAULT_PREFS: NotifyPrefs = {
  categories: { approvalRequested: true, agentFinished: true, agentQuestion: true, humanMentioned: true, scheduledTaskFailed: true },
  detailLevel: "private",
  quietHours: { enabled: false, startMinute: 22 * 60, endMinute: 7 * 60, timeZone: "UTC" },
  agentIds: [],
};

export function validZone(zone: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0); return true; } catch { return false; }
}
const minute = (v: unknown) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 1439;

export function normalizeQuiet(value: unknown): Quiet | undefined {
  const q = record(value);
  const zone = typeof q.timeZone === "string" ? q.timeZone.trim() : "";
  if (typeof q.enabled !== "boolean" || !minute(q.startMinute) || !minute(q.endMinute) || !zone || zone.length > 128 || !validZone(zone)) return undefined;
  return { enabled: q.enabled, startMinute: Number(q.startMinute), endMinute: Number(q.endMinute), timeZone: zone };
}
export function detailOf(value: unknown): Detail | undefined {
  return value === "private" || value === "identified" || value === "detailed" ? value : undefined;
}
export function agentIdsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter((v) => v && v.length <= 128))].slice(0, 128);
}

export function normalizePrefs(value: unknown): NotifyPrefs {
  const src = record(value);
  const cats = record(src.categories);
  const categories = { ...DEFAULT_PREFS.categories };
  for (const key of CATEGORY_KEYS) if (typeof cats[key] === "boolean") categories[key] = cats[key] as boolean;
  return {
    categories,
    detailLevel: detailOf(src.detailLevel) ?? DEFAULT_PREFS.detailLevel,
    quietHours: normalizeQuiet(src.quietHours) ?? DEFAULT_PREFS.quietHours,
    agentIds: agentIdsOf(src.agentIds) ?? [],
  };
}

/** The engine's isWebPushQuietHours: inside the window in its own time zone; equal ends mean never. */
export function quietNow(q: Quiet, now = Date.now()): boolean {
  if (!q.enabled || q.startMinute === q.endMinute) return false;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: q.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const at = Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return q.startMinute < q.endMinute ? at >= q.startMinute && at < q.endMinute : at >= q.startMinute || at < q.endMinute;
}

export type PrefsState = { status: "loading" | "ok" | "none" | "error"; prefs: NotifyPrefs; error?: string };
const NONE_WHY = "Saving these needs your Branch profile, and this connection has none.";
const CONFLICT = "Your notification settings changed somewhere else. They’re up to date now; try again.";

/** Why the profile-backed rows are greyed, or undefined when they work. */
export function prefsOff(state: PrefsState): string | undefined {
  if (state.status === "loading") return "Reading your notification settings…";
  if (state.status === "none") return NONE_WHY;
  if (state.status === "error") return state.error ?? "Branch couldn’t read your notification settings.";
  return undefined;
}

async function readPrefs(engine: WindowEngine): Promise<{ state: PrefsState; raw: unknown }> {
  const r = record(await engine.request("users.prefs.get", { keys: [PREFS_KEY] }));
  if (r.status === "no_durable_identity") return { state: { status: "none", prefs: DEFAULT_PREFS }, raw: null };
  if (r.status !== "ok") return { state: { status: "error", prefs: DEFAULT_PREFS, error: "Branch couldn’t read your notification settings." }, raw: null };
  const raw = record(r.entries)[PREFS_KEY] ?? null;
  return { state: { status: "ok", prefs: normalizePrefs(raw) }, raw };
}

/** Your notification defaults: read, change (queued, whole object, guarded by the last saved value) and live reloads. */
export function useNotifyPrefs(engine: WindowEngine) {
  const run = useSaveRunner();
  const [state, setState] = useState<PrefsState>({ status: "loading", prefs: DEFAULT_PREFS });
  const latest = useRef<NotifyPrefs>(DEFAULT_PREFS);
  const saved = useRef<unknown>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const load = useCallback(async () => {
    try {
      const { state: next, raw } = await readPrefs(engine);
      latest.current = next.prefs; saved.current = raw; setState(next);
    } catch (error) {
      setState({ status: "error", prefs: latest.current, error: visible(errorText(error)) });
    }
  }, [engine]);
  useEffect(() => { void load(); }, [load]);
  // Our own saves echo back as users.prefs.changed: while writes are queued, note it and reload once they finish.
  const pending = useRef(0);
  const stale = useRef(false);
  useEffect(() => engine.onEvent((e) => {
    const keys = record(e.payload).keys;
    if (e.event !== "users.prefs.changed" || !Array.isArray(keys) || !keys.includes(PREFS_KEY)) return;
    if (pending.current > 0) stale.current = true; else void load();
  }), [engine, load]);
  const write = useCallback(async (next: NotifyPrefs) => {
    try {
      const r = record(await engine.request("users.prefs.set", { entries: { [PREFS_KEY]: next }, expectedEntries: { [PREFS_KEY]: saved.current } }));
      if (r.status === "ok") { saved.current = next; return; }
      throw new Error(r.status === "conflict" ? CONFLICT : r.status === "no_durable_identity" ? NONE_WHY : "The engine didn’t save your notification settings.");
    } catch (error) {
      stale.current = true; // what's on screen isn't saved: show what is
      throw error;
    } finally {
      pending.current -= 1;
      if (pending.current === 0 && stale.current) { stale.current = false; await load(); }
    }
  }, [engine, load]);
  const change = useCallback((edit: (p: NotifyPrefs) => NotifyPrefs) => run(() => {
    const next = normalizePrefs(edit(latest.current));
    latest.current = next;
    setState((s) => ({ ...s, prefs: next }));
    pending.current += 1;
    const done = chain.current.then(() => write(next));
    chain.current = done.catch(() => undefined);
    return done;
  }), [run, write]);
  return { ...state, change, reload: load };
}
