// Settings › Notifications: the controls the R1 page draws itself (slots.ts controls), on the calls Classic
// Notifications makes (set1/notifications*.tsx). Your defaults and this computer's push subscription are each one shared
// store per engine, so every row reads the same state and changes queue one after another instead of racing.
import { useId, useSyncExternalStore, useEffect, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { availability } from "../../../connect/capabilities";
import { list, record, visible } from "../../../places/settings/adapter";
import { current, deviceOff, facts, isDesktopApp, normalizeDevice, showTestNotice, subscribe, TEST_SENDING, testLine, type DevicePrefs } from "../../../places/settings/set1/notifications-browser";
import { hourOpts, zoneOpts } from "../../../places/settings/set1/notifications";
import { DEFAULT_PREFS, PREFS_KEY, normalizePrefs, prefsOff, type CategoryKey, type Detail, type NotifyPrefs, type Quiet } from "../../../places/settings/set1/notifications-prefs";
import { noticesHereOn, setNoticesHere } from "../../../shell/notify";
import { Segmented, Toggle } from "../RowView";
import type { SlotControlProps } from "../slots";
import { useLevel } from "../SettingsFrame";
import { COMING_FROM } from "../rows";
import { useRead } from "./accounts-live";
import { Failed, Needs, useFailure } from "./appearance-live";

/** A value many rows read: subscribe, snapshot, set. */
class Shared<T> {
  snap: T;
  private subs = new Set<() => void>();
  private start: () => void;
  constructor(first: T, start: () => void) { this.snap = first; this.start = start; }
  subscribe = (fn: () => void) => { if (!this.subs.size) this.start(); this.subs.add(fn); return () => void this.subs.delete(fn); };
  set(next: T) { this.snap = next; for (const fn of [...this.subs]) fn(); }
}

type PrefsSnap = { status: "loading" | "ok" | "none" | "error"; prefs: NotifyPrefs };
class PrefsStore {
  readonly s: Shared<PrefsSnap>;
  private saved: unknown = null;
  private chain: Promise<unknown> = Promise.resolve();
  private off?: () => void;
  private engine: WindowEngine;
  constructor(engine: WindowEngine) {
    this.engine = engine;
    this.s = new Shared<PrefsSnap>({ status: "loading", prefs: DEFAULT_PREFS }, () => {
      void this.load();
      this.off ??= engine.onEvent((e) => { const keys = record(e.payload).keys; if (e.event === "users.prefs.changed" && Array.isArray(keys) && keys.includes(PREFS_KEY)) void this.load(); });
    });
  }
  async load() {
    try {
      const r = record(await this.engine.request("users.prefs.get", { keys: [PREFS_KEY] }));
      if (r.status === "no_durable_identity") return this.s.set({ status: "none", prefs: DEFAULT_PREFS });
      if (r.status !== "ok") return this.s.set({ status: "error", prefs: this.s.snap.prefs });
      const raw = record(r.entries)[PREFS_KEY] ?? null;
      this.saved = raw;
      this.s.set({ status: "ok", prefs: normalizePrefs(raw) });
    } catch { this.s.set({ status: "error", prefs: this.s.snap.prefs }); }
  }
  /** Changes your defaults: shown at once, saved in order against the last saved value. */
  change(edit: (p: NotifyPrefs) => NotifyPrefs): Promise<void> {
    const next = normalizePrefs(edit(this.s.snap.prefs));
    this.s.set({ ...this.s.snap, prefs: next });
    const done = this.chain.then(async () => {
      const r = record(await this.engine.request("users.prefs.set", { entries: { [PREFS_KEY]: next }, expectedEntries: { [PREFS_KEY]: this.saved } }));
      if (r.status !== "ok") { await this.load(); throw new Error(String(r.status ?? "Not saved.")); }
      this.saved = next;
    });
    this.chain = done.catch(() => this.load());
    return done;
  }
}

type PushSnap = { supported: boolean; permission: NotificationPermission | "unsupported"; reg: ServiceWorkerRegistration | null; sub: PushSubscription | null; device: DevicePrefs | null; loading: boolean };
class PushStore {
  readonly s: Shared<PushSnap>;
  private chain: Promise<unknown> = Promise.resolve();
  private engine: WindowEngine;
  constructor(engine: WindowEngine) {
    this.engine = engine;
    this.s = new Shared<PushSnap>({ ...facts(), reg: null, sub: null, device: null, loading: true }, () => void this.load());
  }
  async load() {
    try {
      const { reg, sub } = await current();
      const device = sub ? normalizeDevice(record(await this.engine.request("push.web.preferences.get", { endpoint: sub.endpoint })).device) : null;
      this.s.set({ ...facts(), reg, sub, device, loading: false });
    } catch { this.s.set({ ...facts(), reg: null, sub: null, device: null, loading: false }); }
  }
  async turnOn() { if (this.s.snap.reg) await subscribe(this.engine, this.s.snap.reg); await this.load(); }
  async turnOff() {
    const sub = this.s.snap.sub;
    if (sub) { await this.engine.request("push.web.unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    await this.load();
  }
  setDevice(edit: (d: DevicePrefs) => DevicePrefs): Promise<void> {
    const { sub, device } = this.s.snap;
    if (!sub || !device) return Promise.reject(new Error("Turn them on in the system’s settings"));
    const next = normalizeDevice(edit(device));
    this.s.set({ ...this.s.snap, device: next });
    const done = this.chain.then(() => this.engine.request("push.web.preferences.set", { endpoint: sub.endpoint, scope: "device", preferences: next })).then(() => undefined);
    this.chain = done.catch(() => this.load());
    return done;
  }
}

const prefsStores = new WeakMap<WindowEngine, PrefsStore>();
const pushStores = new WeakMap<WindowEngine, PushStore>();
function usePrefs(engine: WindowEngine) {
  let st = prefsStores.get(engine);
  if (!st) { st = new PrefsStore(engine); prefsStores.set(engine, st); }
  const snap = useSyncExternalStore(st.s.subscribe, () => st!.s.snap, () => st!.s.snap);
  return { ...snap, off: snap.status !== "ok", change: (e: (p: NotifyPrefs) => NotifyPrefs) => st!.change(e) };
}
function usePush(engine: WindowEngine) {
  let st = pushStores.get(engine);
  if (!st) { st = new PushStore(engine); pushStores.set(engine, st); }
  const snap = useSyncExternalStore(st.s.subscribe, () => st!.s.snap, () => st!.s.snap);
  return { ...snap, store: st };
}

const PREFS = ["users.prefs.get", "users.prefs.set"];
const DEVICE = ["push.web.preferences.get", "push.web.preferences.set"];
const DETAIL = [{ v: "private", label: "Private" }, { v: "identified", label: "Names only" }, { v: "detailed", label: "Detailed" }];
const ON_OFF = [{ v: "def", label: "Use my default" }, { v: "on", label: "On" }, { v: "off", label: "Off" }];
const onOff = (v: boolean | undefined) => (v === undefined ? "def" : v ? "on" : "off");
const fromOnOff = (v: string) => (v === "def" ? undefined : v === "on");
/** A list choice that keeps the attributes <Coming> gives it (data-need), so the control stays declared. */
const Select = ({ label, value, options, disabled, onChange, ...rest }: { label: string; value: string; options: { v: string; label: string }[]; disabled?: boolean; onChange: (v: string) => void; "aria-describedby"?: string }) =>
  <select className="r1s-inp" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} {...rest}>{options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>;
/** The one plain line a greyed control names with aria-describedby, saying why it is greyed (Private #1093). */
const Why = ({ id, text }: { id: string; text?: string }) => (text ? <small id={id} className="r1s-note g-label" data-lines>{text}</small> : null);
function useTrunks(engine: WindowEngine) {
  const agents = useRead(engine, "agents.list");
  return list(agents.data?.agents).map((a) => ({ id: String(a.id), name: visible(record(a.identity).name ?? a.name ?? a.id) }));
}

/** Notifications on this computer: the Branch app's own notices, or this browser's device switch. */
export function NoticesHere({ engine, row }: SlotControlProps) {
  const desktop = isDesktopApp();
  const push = usePush(engine);
  const whyId = useId();
  const [failed, run] = useFailure();
  const [here, setHere] = useState(noticesHereOn);
  const [perm, setPerm] = useState(() => facts().permission);
  if (desktop) {
    const why = perm === "unsupported" ? "This Branch window can’t show notifications."
      : perm === "denied" ? "Open your system settings and allow notifications for Branch."
      : undefined;
    const flip = (next: boolean) => void run(async () => {
      if (next && perm !== "granted") { const a = await Notification.requestPermission(); setPerm(a); if (a !== "granted") return; }
      setNoticesHere(next); setHere(next);
    });
    return <>
      <span className="r1s-own-ctl" data-local="">
        <Toggle label={row.label ?? ""} on={here && perm === "granted"} disabled={Boolean(why)} aria-describedby={why ? whyId : undefined} onChange={flip} />
      </span>
      {why ? <small id={whyId} className="r1s-note g-label" data-lines>{why}</small> : null}
      <Failed text={failed} />
    </>;
  }
  const on = Boolean(push.device?.enabled);
  const why = push.loading ? "Checking this computer…"
    : !push.supported ? "This computer can’t show notifications."
    : !push.reg ? "This computer isn’t set up for notifications yet."
    : undefined;
  const flip = (next: boolean) => void run(() => (!push.device ? (next ? push.store.turnOn() : Promise.resolve()) : push.store.setDevice((d) => ({ ...d, enabled: next }))));
  return <>
    <Needs engine={engine} need={["push.web.preferences.set"]} where={row.label ?? ""}>
      <span className="r1s-own-ctl"><Toggle label={row.label ?? ""} on={on} disabled={Boolean(why)} aria-describedby={why ? whyId : undefined} onChange={flip} /></span>
    </Needs>
    {why ? <small id={whyId} className="r1s-note g-label" data-lines>{why}</small> : null}
    <Failed text={failed} />
  </>;
}

/** One kind of notice in your defaults. */
export function Category({ engine, row }: SlotControlProps) {
  const p = usePrefs(engine);
  const [failed, run] = useFailure();
  const key = row.id.split(".").pop() as CategoryKey;
  return <>
    <Needs engine={engine} need={PREFS} where={row.label ?? ""}>
      <span className="r1s-own-ctl"><Toggle label={row.label ?? ""} on={p.prefs.categories[key]} disabled={p.off} onChange={(v) => void run(() => p.change((c) => ({ ...c, categories: { ...c.categories, [key]: v } })))} /></span>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** Only these Trunks: every Trunk, or the ones you pick. */
export function OnlyTrunks({ engine, row }: SlotControlProps) {
  const p = usePrefs(engine);
  const trunks = useTrunks(engine);
  const [failed, run] = useFailure();
  const ids = p.prefs.agentIds;
  const pick = (id: string) => void run(() => p.change((c) => ({ ...c, agentIds: id === "*" ? [] : c.agentIds.includes(id) ? c.agentIds.filter((x) => x !== id) : [...c.agentIds, id] })));
  return <>
    <Needs engine={engine} need={PREFS} where={row.label ?? ""}>
      <span className="r1s-own-ctl r1s-acts">{[{ id: "*", name: "Every Trunk" }, ...trunks].map((t) => (
        <button key={t.id} type="button" className="r1s-btn" disabled={p.off} aria-pressed={t.id === "*" ? ids.length === 0 : ids.includes(t.id)} onClick={() => pick(t.id)}>{t.name}</button>
      ))}</span>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** On a locked screen: how much a notification shows. */
export function LockedScreen({ engine, row }: SlotControlProps) {
  const p = usePrefs(engine);
  const [failed, run] = useFailure();
  return <>
    <Needs engine={engine} need={PREFS} where={row.label ?? ""}>
      <span className="r1s-own-ctl"><Segmented label={row.label ?? ""} value={p.prefs.detailLevel} options={DETAIL} disabled={p.off} onChange={(v) => void run(() => p.change((c) => ({ ...c, detailLevel: v as Detail })))} /></span>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** Why Send test is greyed in the Branch app while this computer's notices are off. */
export const SEND_TEST_FIRST = "Turn on notifications here first.";
/** What a browser's test says when no computer or phone has notifications on (the engine: "no web push subscriptions"). */
export const SEND_TEST_NONE = "No computer or phone has notifications on yet. Turn on notifications here first.";
const sentTo = (n: number) => `Sent to ${n} ${n === 1 ? "device" : "devices"}.`;

/** Send a test notification. In the Branch app it shows this computer's own notice, the way the window shows any other.
 *  In a browser it asks the engine (push.web.test) to send one to every computer and phone with notifications on. The
 *  engine answers push.web.test but never lists it in its hello (core-descriptors advertise: false), so gating on it drew
 *  the button greyed on every engine. Like Push to this browser, the browser path is gated on the listed
 *  push.web.preferences calls from the same push methods; on an engine without them it is Coming, drawn only at
 *  Technical (rows.ts COMING_FROM). */
export function SendTest({ engine, row }: SlotControlProps) {
  const [failed, run] = useFailure();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [level] = useLevel(engine);
  const whyId = useId();
  const desktop = isDesktopApp();
  const hidden = !desktop && level < COMING_FROM && PUSH_NEED.some((method) => availability(engine, method) === "no");
  const here = noticesHereOn() && facts().permission === "granted";
  const why = desktop && !here ? SEND_TEST_FIRST : undefined;
  const send = async () => {
    if (desktop) return setSaid(testLine(await showTestNotice(), "your system settings"));
    try {
      const results = list(record(await engine.request("push.web.test", {})).results);
      setSaid(sentTo(results.filter((r) => record(r).ok === true).length));
    } catch (error) {
      throw /no web push subscriptions/i.test(error instanceof Error ? error.message : String(error)) ? new Error(SEND_TEST_NONE) : error;
    }
  };
  const go = () => { setBusy(true); setSaid(TEST_SENDING); void run(send).then((ok) => { if (!ok) setSaid(""); }).finally(() => setBusy(false)); };
  const btn = <button type="button" className="r1s-btn" disabled={busy || Boolean(why)} aria-describedby={why ? whyId : undefined} onClick={go}>Send test</button>;
  return <>
    {desktop ? <span className="r1s-own-ctl" data-local="">{btn}</span> : <Needs engine={engine} need={PUSH_NEED} where={row.label ?? ""} hidden={hidden}>{btn}</Needs>}
    <Why id={whyId} text={why} />
    {said && !hidden ? <small className="r1s-note g-label" role="status" data-lines>{said}</small> : null}
    <Failed text={failed} />
  </>;
}

/** Why the hours and time zone are greyed while quiet hours are off. */
const QUIET_FIRST = "Turn on quiet hours to pick the hours and time zone.";

/** Quiet hours: from, to, and on or off. */
export function QuietHours({ engine, row }: SlotControlProps) {
  const p = usePrefs(engine);
  const [failed, run] = useFailure();
  const whyId = useId();
  const q = p.prefs.quietHours;
  const setQ = (patch: Partial<Quiet>) => void run(() => p.change((c) => ({ ...c, quietHours: { ...c.quietHours, ...patch } })));
  const opts = (m: number) => hourOpts(m).map((o) => ({ v: o.id, label: o.label }));
  const offWhy = p.off ? prefsOff(p) : undefined;
  const why = offWhy ?? (q.enabled ? undefined : QUIET_FIRST);
  return <>
    <Needs engine={engine} need={PREFS} where={row.label ?? ""}>
      <span className="r1s-own-ctl r1s-acts">
        <span className="g-label">From</span><Select label="From" value={String(q.startMinute)} options={opts(q.startMinute)} disabled={p.off || !q.enabled} aria-describedby={why ? whyId : undefined} onChange={(v) => setQ({ startMinute: Number(v) })} />
        <span className="g-label">To</span><Select label="To" value={String(q.endMinute)} options={opts(q.endMinute)} disabled={p.off || !q.enabled} aria-describedby={why ? whyId : undefined} onChange={(v) => setQ({ endMinute: Number(v) })} />
        <Toggle label={row.label ?? ""} on={q.enabled} disabled={p.off} aria-describedby={offWhy ? whyId : undefined} onChange={(v) => setQ({ enabled: v })} />
      </span>
    </Needs>
    <Why id={whyId} text={why} />
    <Failed text={failed} />
  </>;
}

/** Time zone for quiet hours. */
export function QuietZone({ engine, row }: SlotControlProps) {
  const p = usePrefs(engine);
  const [failed, run] = useFailure();
  const whyId = useId();
  const q = p.prefs.quietHours;
  const why = (p.off ? prefsOff(p) : undefined) ?? (q.enabled ? undefined : QUIET_FIRST);
  return <>
    <Needs engine={engine} need={PREFS} where={row.label ?? ""}>
      <Select label={row.label ?? ""} value={q.timeZone} options={zoneOpts(q.timeZone).map((o) => ({ v: o.id, label: o.label }))} disabled={p.off || !q.enabled}
        aria-describedby={why ? whyId : undefined} onChange={(v) => void run(() => p.change((c) => ({ ...c, quietHours: { ...c.quietHours, timeZone: v } })))} />
    </Needs>
    <Why id={whyId} text={why} />
    <Failed text={failed} />
  </>;
}

/** Why This PC's rows are greyed in the Branch app, where this computer's notices follow your defaults. */
const DEVICE_APP = "In the Branch app, this computer follows your defaults above.";
const DEVICE_FIRST = "Turn on notifications on this computer first.";

/** This PC: this computer's own choices over your defaults. `why` is the one line each greyed control names. */
function useDevice(engine: WindowEngine) {
  const push = usePush(engine);
  const [failed, run] = useFailure();
  const whyId = useId();
  const off = push.loading || !push.device || isDesktopApp();
  const why = !off ? undefined : isDesktopApp() ? DEVICE_APP : (deviceOff(push) ?? DEVICE_FIRST);
  const set = (patch: Partial<DevicePrefs>) => void run(() => push.store.setDevice((d) => ({ ...d, ...patch })));
  return { d: push.device ?? { enabled: true, label: "" }, off, set, failed, why, whyId, describedBy: why ? whyId : undefined };
}
export function DeviceName({ engine, row }: SlotControlProps) {
  const { d, off, set, failed, why, whyId, describedBy } = useDevice(engine);
  const [text, setText] = useState(d.label);
  useEffect(() => setText(d.label), [d.label]);
  const commit = () => { if (text !== d.label) set({ label: text.slice(0, 80) }); };
  return <><Needs engine={engine} need={DEVICE} where={row.label ?? ""}>
    <input className="r1s-inp" aria-label={row.label} value={text} disabled={off} aria-describedby={describedBy} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
  </Needs><Why id={whyId} text={why} /><Failed text={failed} /></>;
}
export function DeviceLocked({ engine, row }: SlotControlProps) {
  const { d, off, set, failed, why, whyId, describedBy } = useDevice(engine);
  return <><Needs engine={engine} need={DEVICE} where={row.label ?? ""}>
    <Select label={row.label ?? ""} value={d.detailLevel ?? "def"} options={[{ v: "def", label: "Use my default" }, ...DETAIL]} disabled={off} aria-describedby={describedBy} onChange={(v) => set({ detailLevel: v === "def" ? undefined : (v as Detail) })} />
  </Needs><Why id={whyId} text={why} /><Failed text={failed} /></>;
}
export function DeviceQuiet({ engine, row }: SlotControlProps) {
  const { d, off, set, failed, why, whyId, describedBy } = useDevice(engine);
  const q = d.quietHours;
  return <><Needs engine={engine} need={DEVICE} where={row.label ?? ""}>
    <Select label={row.label ?? ""} value={onOff(q?.enabled)} options={ON_OFF} disabled={off} aria-describedby={describedBy}
      onChange={(v) => set({ quietHours: v === "def" ? undefined : { startMinute: 22 * 60, endMinute: 7 * 60, timeZone: "UTC", ...q, enabled: v === "on" } })} />
  </Needs><Why id={whyId} text={why} /><Failed text={failed} /></>;
}
export function DeviceTrunks({ engine, row }: SlotControlProps) {
  const { d, off, set, failed, why, whyId, describedBy } = useDevice(engine);
  const trunks = useTrunks(engine);
  const ids = d.agentIds;
  const value = ids === undefined ? "def" : ids.length === 0 ? "*" : ids.length === 1 ? ids[0] : "many";
  const options = [{ v: "def", label: "Use my default" }, { v: "*", label: "Every Trunk" }, ...trunks.map((t) => ({ v: t.id, label: t.name })), ...(value === "many" ? [{ v: "many", label: `${ids?.length ?? 0} Trunks` }] : [])];
  return <><Needs engine={engine} need={DEVICE} where={row.label ?? ""}>
    <Select label={row.label ?? ""} value={value} options={options} disabled={off} aria-describedby={describedBy} onChange={(v) => { if (v !== "many") set({ agentIds: v === "def" ? undefined : v === "*" ? [] : [v] }); }} />
  </Needs><Why id={whyId} text={why} /><Failed text={failed} /></>;
}
export function DeviceCategory({ engine, row }: SlotControlProps) {
  const { d, off, set, failed, why, whyId, describedBy } = useDevice(engine);
  const key = row.id.split(".").pop() as CategoryKey;
  return <><Needs engine={engine} need={DEVICE} where={row.label ?? ""}>
    <Select label={row.label ?? ""} value={onOff(d.categories?.[key])} options={ON_OFF} disabled={off} aria-describedby={describedBy} onChange={(v) => {
      const cats = { ...d.categories }; const next = fromOnOff(v);
      if (next === undefined) delete cats[key]; else cats[key] = next;
      set({ categories: cats });
    }} />
  </Needs><Why id={whyId} text={why} /><Failed text={failed} /></>;
}

/** The calls Push to this browser is gated on. The toggle itself calls push.web.vapidPublicKey, .subscribe and
 *  .unsubscribe, but the engine never lists those in its hello (core-descriptors advertise: false), so gating on them
 *  drew the toggle as Coming on every engine. The listed push.web.preferences calls come from the same push methods. */
export const PUSH_NEED = DEVICE;
/** Why the toggle is greyed in the Branch app, which shows this computer's notices itself. */
export const PUSH_APP = "In the Branch app, notices on this computer come from the app itself.";

/** Push to this browser: this browser's own Web Push subscription. On an engine without the push calls the toggle is
 *  Coming, and is drawn only at Technical (rows.ts COMING_FROM). */
export function PushBrowser({ engine, row }: SlotControlProps) {
  const push = usePush(engine);
  const [failed, run] = useFailure();
  const [level] = useLevel(engine);
  const whyId = useId();
  const desktop = isDesktopApp();
  const hidden = level < COMING_FROM && PUSH_NEED.some((method) => availability(engine, method) === "no");
  const why = desktop && !hidden ? PUSH_APP : undefined;
  return <>
    <Needs engine={engine} need={PUSH_NEED} where={row.label ?? ""} hidden={hidden}>
      <span className="r1s-own-ctl"><Toggle label={row.label ?? ""} on={Boolean(push.sub)} disabled={desktop || push.loading || !push.supported || !push.reg || push.permission === "denied"}
        aria-describedby={why ? whyId : undefined} onChange={(v) => void run(() => (v ? push.store.turnOn() : push.store.turnOff()))} /></span>
    </Needs>
    <Why id={whyId} text={why} />
    <Failed text={failed} />
  </>;
}

