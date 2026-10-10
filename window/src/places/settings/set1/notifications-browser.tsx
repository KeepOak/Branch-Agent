// Notifications › This browser and this device's own choices: the browser's push subscription, registered with the
// engine through push.web.vapidPublicKey / push.web.subscribe / push.web.unsubscribe, its device overrides through
// push.web.preferences.get / .set (scope "device") and a test through push.web.test. Copied from the engine's own
// Control UI (ui/src/app/web-push.runtime.ts, pages/config/notifications-section.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { errorText, list, record, visible } from "../adapter";
import { Btn, Ctl, Field, Hint, Pick, Sec, Switch, useSaveRunner, type Opt } from "../kit";
import { CATEGORY_KEYS, agentIdsOf, detailOf, normalizeQuiet, type CategoryKey, type Detail, type Quiet } from "./notifications-prefs";
import { shownWhy } from "../../../shell/shown-why";
import { noticesHereOn, setNoticesHere } from "../../../shell/notify";

export type DevicePrefs = { enabled: boolean; label: string; categories?: Partial<Record<CategoryKey, boolean>>; detailLevel?: Detail; quietHours?: Quiet; agentIds?: string[] };
type Perm = NotificationPermission | "unsupported";
type PushState = { supported: boolean; permission: Perm; reg: ServiceWorkerRegistration | null; sub: PushSubscription | null; device: DevicePrefs | null; loading: boolean; error?: string };

function facts(): Pick<PushState, "supported" | "permission"> {
  const hasN = typeof window !== "undefined" && "Notification" in window;
  const sw = typeof navigator !== "undefined" && "serviceWorker" in navigator;
  return { supported: hasN && sw && "PushManager" in window, permission: hasN ? Notification.permission : "unsupported" };
}

async function current(): Promise<{ reg: ServiceWorkerRegistration | null; sub: PushSubscription | null }> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return { reg: null, sub: null };
  const reg = (await navigator.serviceWorker.getRegistration()) ?? null;
  const sub = reg?.pushManager ? await reg.pushManager.getSubscription() : null;
  return { reg, sub };
}

export function normalizeDevice(value: unknown): DevicePrefs {
  const src = record(value);
  const cats = record(src.categories);
  const categories = Object.fromEntries(CATEGORY_KEYS.filter((k) => typeof cats[k] === "boolean").map((k) => [k, cats[k]]));
  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : true,
    label: typeof src.label === "string" ? src.label.slice(0, 80) : "",
    ...(Object.keys(categories).length ? { categories } : {}),
    ...(detailOf(src.detailLevel) ? { detailLevel: detailOf(src.detailLevel) } : {}),
    ...(normalizeQuiet(src.quietHours) ? { quietHours: normalizeQuiet(src.quietHours) } : {}),
    ...(agentIdsOf(src.agentIds) ? { agentIds: agentIdsOf(src.agentIds) } : {}),
  };
}

function keyBytes(base64: string): Uint8Array {
  const b64 = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Why this device's own rows can't change yet, or undefined once this browser is registered. */
export function deviceOff(p: PushState): string | undefined {
  if (p.loading) return "Checking this computer…";
  if (!p.supported) return "This computer can’t show notifications.";
  if (!p.reg) return "This computer isn’t set up for notifications yet.";
  if (!p.device) return "Turn on notifications on this computer first.";
  return undefined;
}

async function subscribe(engine: WindowEngine, reg: ServiceWorkerRegistration) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications weren’t allowed for Branch.");
  const { vapidPublicKey } = record(await engine.request("push.web.vapidPublicKey", {}));
  if (typeof vapidPublicKey !== "string" || !vapidPublicKey) throw new Error("The engine didn’t give a push key.");
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey).buffer as ArrayBuffer });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("Notification setup on this computer is incomplete. Try again.");
  await engine.request("push.web.subscribe", { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
}

/** This browser's push subscription and its device choices, read from the browser and the engine. */
export function useWebPush(engine: WindowEngine) {
  const run = useSaveRunner();
  const [state, setState] = useState<PushState>({ ...facts(), reg: null, sub: null, device: null, loading: true });
  const latest = useRef<DevicePrefs | null>(null);
  const load = useCallback(async () => {
    const base = facts();
    try {
      const { reg, sub } = await current();
      const device = sub ? normalizeDevice(record(await engine.request("push.web.preferences.get", { endpoint: sub.endpoint })).device) : null;
      latest.current = device;
      setState({ ...base, reg, sub, device, loading: false });
    } catch (error) {
      latest.current = null;
      setState({ ...base, reg: null, sub: null, device: null, loading: false, error: visible(errorText(error)) });
    }
  }, [engine]);
  useEffect(() => { void load(); }, [load]);
  const turnOn = () => run(async () => { if (state.reg) await subscribe(engine, state.reg); await load(); });
  const turnOff = () => run(async () => {
    if (state.sub) { await engine.request("push.web.unsubscribe", { endpoint: state.sub.endpoint }); await state.sub.unsubscribe(); }
    await load();
  });
  const setDevice = (edit: (d: DevicePrefs) => DevicePrefs) => run(async () => {
    if (!state.sub || !latest.current) throw new Error("Turn on notifications on this computer first.");
    const next = normalizeDevice(edit(latest.current));
    latest.current = next;
    setState((s) => ({ ...s, device: next }));
    try {
      await engine.request("push.web.preferences.set", { endpoint: state.sub.endpoint, scope: "device", preferences: next });
    } catch (error) {
      await load(); // what's on screen isn't saved: show what is
      throw error;
    }
  });
  return { ...state, turnOn, turnOff, setDevice, reload: load };
}
export type WebPush = ReturnType<typeof useWebPush>;

/** Sends a real test through push.web.test and says what happened on the row itself. */
export function useTestSend(engine: WindowEngine) {
  const [line, setLine] = useState<{ busy: boolean; text?: string }>({ busy: false });
  const send = async () => {
    setLine({ busy: true, text: "Sending…" });
    try {
      const results = list(record(await engine.request("push.web.test", {})).results);
      const ok = results.filter((r) => r.ok === true).length;
      setLine({ busy: false, text: `Sent to ${ok} ${ok === 1 ? "device" : "devices"}.` });
    } catch (error) {
      const why = errorText(error);
      setLine({ busy: false, text: /no web push subscriptions/i.test(why) ? "No computer or phone has notifications on yet." : visible(why) });
    }
  };
  return { ...line, send };
}

/** The desktop app has no push subscription: its own windows show this computer's notices directly. */
export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && (window as unknown as { branchDesktop?: unknown }).branchDesktop !== undefined;
}

/** Desktop app: this computer's own notices, through the window's Notification API (no service worker needed). */
export function DesktopNotices() {
  const [perm, setPerm] = useState<Perm>(() => facts().permission);
  const [on, setOn] = useState(noticesHereOn);
  const [line, setLine] = useState("");
  const off = perm === "unsupported" ? "This Branch window can’t show notifications." : perm === "denied" ? "Notifications for Branch are off in your computer’s settings." : undefined;
  const flip = async (next: boolean) => {
    if (next && perm !== "granted") {
      const answer = await Notification.requestPermission();
      setPerm(answer);
      if (answer !== "granted") return;
    }
    setNoticesHere(next);
    setOn(next);
  };
  const test = () => {
    try {
      new Notification("Branch", { body: "Notifications are working on this computer." });
      setLine("Sent.");
    } catch {
      setLine("Branch couldn’t show a notification here.");
    }
  };
  const live = on && perm === "granted";
  return (
    <>
      <Ctl title="Notifications on this computer" sub="Off keeps this computer quiet." off={off}>
        <Switch checked={live} disabled={Boolean(off)} label="Notifications on this computer" onChange={(v) => void flip(v)} />
      </Ctl>
      <Ctl title="Send a test notification" sub={line || undefined} off={live ? undefined : "Turn on notifications here first."}>
        <Btn sm disabled={!live} onClick={test}>Send test</Btn>
      </Ctl>
    </>
  );
}

const PERM_WORD: Record<Perm, string> = { granted: "Allowed", denied: "Blocked", default: "Not asked yet", unsupported: "Not supported" };

export function ThisBrowser({ engine, push }: { engine: WindowEngine; push: WebPush }) {
  const test = useTestSend(engine);
  const ios = typeof navigator !== "undefined" && /iPhone|iPad/.test(navigator.userAgent);
  const why = push.loading ? "Checking this computer…" : !push.supported ? "This computer can’t show notifications." : push.permission === "denied" ? "Notifications are off for Branch in System Settings." : !push.reg ? "This computer isn’t set up for notifications yet." : undefined;
  const hint = !push.supported ? "This computer can’t show notifications." : ios ? "Use Share › Add to Home Screen, then open Branch from there." : push.permission === "denied" ? "Open System Settings and allow notifications for Branch." : "";
  const on = Boolean(push.device);
  return (
    <Sec title="This computer">
      <dl className="kv nt-kv">
        <dt>Notification support</dt><dd>{push.supported ? "Available" : "Not supported"}</dd>
        <dt>Permission</dt><dd>{PERM_WORD[push.permission]}</dd>
        <dt>Status</dt><dd>{push.loading ? "Checking…" : on ? "On" : "Off"}</dd>
      </dl>
      <div className="acts nt-acts">
        <Btn sm disabled={Boolean(why) || on} title={shownWhy(why)} onClick={() => void push.turnOn()}>Turn on notifications</Btn>
        <Btn sm ghost disabled={!push.sub} title={push.sub ? undefined : "This computer isn’t set up for notifications yet."} onClick={() => void push.turnOff()}>Turn off here</Btn>
        <Btn sm ghost disabled={!on || test.busy} title={on ? undefined : "Turn on notifications on this computer first."} onClick={() => void test.send()}>Send test</Btn>
      </div>
      {why && why !== hint ? <Hint>{why}</Hint> : null}
      {hint ? <Hint>{hint}</Hint> : null}
      {push.error ? <Hint>{push.error}</Hint> : null}
      {test.text ? <Hint>{test.text}</Hint> : null}
      <p className="hint nt-tight">Branch asks for permission before showing notifications.</p>
    </Sec>
  );
}

const ON_OFF: Opt[] = [{ id: "def", label: "Use my default" }, { id: "on", label: "On" }, { id: "off", label: "Off" }];
const onOff = (v: boolean | undefined) => (v === undefined ? "def" : v ? "on" : "off");
const fromOnOff = (v: string) => (v === "def" ? undefined : v === "on");

export type Trunk = { id: string; name: string };
export type TellRow = { title: string; key?: CategoryKey; off?: string };

/** This device's own choices (Advanced): "Use my default" leaves your defaults in charge. */
export function ThisDevice({ push, trunks, tell, name }: { push: WebPush; trunks: Trunk[]; tell: TellRow[]; name: string }) {
  const off = deviceOff(push);
  const d = push.device ?? { enabled: true, label: "" };
  const set = (patch: Partial<DevicePrefs>) => void push.setDevice((cur) => ({ ...cur, ...patch }));
  const ids = d.agentIds;
  const only = ids === undefined ? "def" : ids.length === 0 ? "*" : ids.length === 1 ? ids[0] : "many";
  const onlyOpts: Opt[] = [{ id: "def", label: "Use my default" }, { id: "*", label: "Every Trunk" }, ...trunks.map((t) => ({ id: t.id, label: t.name })), ...(only === "many" ? [{ id: "many", label: `${ids?.length ?? 0} Trunks` }] : [])];
  const quiet = d.quietHours;
  return (
    <Sec title={name}>
      <Ctl title="Name on its notifications" sub="Changes only this device. Your defaults above stay." off={off}>
        <Field label="Name on its notifications" value={d.label} placeholder="Work laptop" disabled={Boolean(off)} onCommit={(v) => set({ label: v.slice(0, 80) })} />
      </Ctl>
      <Ctl title="On a locked screen" sub="" keep="everywhere" off={off}>
        <Pick label="On a locked screen" value={d.detailLevel ?? "def"} disabled={Boolean(off)} options={[{ id: "def", label: "Use my default" }, ...DETAIL_OPTS]} onChange={(v) => set({ detailLevel: v === "def" ? undefined : detailOf(v) })} />
      </Ctl>
      <Ctl title="Quiet hours" sub="" off={off}>
        <Pick label="Quiet hours" value={onOff(quiet?.enabled)} options={ON_OFF} disabled={Boolean(off)} onChange={(v) => set({ quietHours: v === "def" ? undefined : { startMinute: 22 * 60, endMinute: 7 * 60, timeZone: "UTC", ...quiet, enabled: v === "on" } })} />
      </Ctl>
      <Ctl title="Only these Trunks" sub="" off={off}>
        <Pick label="Only these Trunks" value={only} options={onlyOpts} disabled={Boolean(off)} onChange={(v) => v !== "many" && set({ agentIds: v === "def" ? undefined : v === "*" ? [] : [v] })} />
      </Ctl>
      {tell.map((row) => <DeviceTell key={row.title} row={row} off={off} d={d} set={set} />)}
    </Sec>
  );
}

function DeviceTell({ row, off, d, set }: { row: TellRow; off?: string; d: DevicePrefs; set: (p: Partial<DevicePrefs>) => void }) {
  const why = row.key ? off : row.off;
  const key = row.key;
  const value = key ? onOff(d.categories?.[key]) : "def";
  const change = (v: string) => {
    if (!key) return;
    const cats = { ...d.categories };
    const next = fromOnOff(v);
    if (next === undefined) delete cats[key]; else cats[key] = next;
    set({ categories: cats });
  };
  return (
    <Ctl title={row.title} sub="" off={why}>
      <Pick label={row.title} value={value} options={ON_OFF} disabled={Boolean(why)} onChange={change} />
    </Ctl>
  );
}

export const DETAIL_OPTS: Opt[] = [{ id: "private", label: "Private" }, { id: "identified", label: "Names only" }, { id: "detailed", label: "Detailed" }];
