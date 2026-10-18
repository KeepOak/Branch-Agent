// Settings › Notifications: the controls the R1 page draws itself (slots.ts controls), on the calls Classic
// Notifications makes (set1/notifications*.tsx). Your defaults and this computer's push subscription are each one shared
// store per engine, so every row reads the same state and changes queue one after another instead of racing.
import { useId, useSyncExternalStore, useEffect, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { canAll } from "../../../connect/capabilities";
import { list, record, visible } from "../../../places/settings/adapter";
import { current, facts, isDesktopApp, normalizeDevice, subscribe, type DevicePrefs } from "../../../places/settings/set1/notifications-browser";
import { hourOpts, zoneOpts } from "../../../places/settings/set1/notifications";
import { DEFAULT_PREFS, PREFS_KEY, normalizePrefs, type CategoryKey, type Detail, type NotifyPrefs, type Quiet } from "../../../places/settings/set1/notifications-prefs";
import { noticesHereOn, setNoticesHere } from "../../../shell/notify";
import { Segmented, Toggle } from "../RowView";
import type { SlotControlProps } from "../slots";
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
const Select = ({ label, value, options, disabled, onChange, ...rest }: { label: string; value: string; options: { v: string; label: string }[]; disabled?: boolean; onChange: (v: string) => void }) =>
  <select className="r1s-inp" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} {...rest}>{options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>;
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

/** Preview TELL_PE18 greys Send test with this line (off18) when the window is not the Branch app. */
const SEND_TEST_APP = "Sends a real notification from the Branch app on your computer.";
const SEND_TEST_FIRST = "Turn on notifications here first.";

/** Send a test notification: this computer's own notice in the Branch app, or push.web.test. */
export function SendTest({ engine, row }: SlotControlProps) {
  const [failed, run] = useFailure();
  const [busy, setBusy] = useState(false);
  const whyId = useId();
  const desktop = isDesktopApp();
  const canPush = canAll(engine, ["push.web.test"]);
  const here = noticesHereOn() && facts().permission === "granted";
  const why = desktop ? (here ? undefined : SEND_TEST_FIRST) : (canPush ? undefined : SEND_TEST_APP);
  const go = () => { setBusy(true); void run(async () => {
    if (desktop) { new Notification("Branch", { body: "Send a test notification" }); return; }
    await engine.request("push.web.test", {});
  }).finally(() => setBusy(false)); };
  const btn = <button type="button" className="r1s-btn" disabled={busy || Boolean(why)} aria-describedby={why ? whyId : undefined} onClick={go}>Send test</button>;
  return <>
    {desktop || !canPush ? <span className="r1s-own-ctl" data-local="">{btn}</span> : <Needs engine={engine} need={["push.web.test"]} where={row.label ?? ""}>{btn}</Needs>}
    {why ? <small id={whyId} className="r1s-note g-label" data-lines>{why}</small> : null}
    <Failed text={failed} />
  </>;
}

/** Quiet hours: from, to, and on or off. */
export function QuietHours({ engine, row }: SlotControlProps) {
  const p = usePrefs(engine);
  const [failed, run] = useFailure();
  const q = p.prefs.quietHours;
  const setQ = (patch: Partial<Quiet>) => void run(() => p.change((c) => ({ ...c, quietHours: { ...c.quietHours, ...patch } })));
  const opts = (m: number) => hourOpts(m).map((o) => ({ v: o.id, label: o.label }));
  return <>
    <Needs engine={engine} need={PREFS} where={row.label ?? ""}>
      <span className="r1s-own-ctl r1s-acts">
        <span className="g-label">From</span><Select label="From" value={String(q.startMinute)} options={opts(q.startMinute)} disabled={p.off || !q.enabled} onChange={(v) => setQ({ startMinute: Number(v) })} />
        <span className="g-label">To</span><Select label="To" value={String(q.endMinute)} options={opts(q.endMinute)} disabled={p.off || !q.enabled} onChange={(v) => setQ({ endMinute: Number(v) })} />
        <Toggle label={row.label ?? ""} on={q.enabled} disabled={p.off} onChange={(v) => setQ({ enabled: v })} />
      </span>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** Time zone for quiet hours. */
export function QuietZone({ engine, row }: SlotControlProps) {
  const p = usePrefs(engine);
  const [failed, run] = useFailure();
  const q = p.prefs.quietHours;
  return <>
    <Needs engine={engine} need={PREFS} where={row.label ?? ""}>
      <Select label={row.label ?? ""} value={q.timeZone} options={zoneOpts(q.timeZone).map((o) => ({ v: o.id, label: o.label }))} disabled={p.off || !q.enabled}
        onChange={(v) => void run(() => p.change((c) => ({ ...c, quietHours: { ...c.quietHours, timeZone: v } })))} />
    </Needs>
    <Failed text={failed} />
  </>;
}

/** This PC: this computer's own choices over your defaults. */
function useDevice(engine: WindowEngine) {
  const push = usePush(engine);
  const [failed, run] = useFailure();
  const off = push.loading || !push.device || isDesktopApp();
  const set = (patch: Partial<DevicePrefs>) => void run(() => push.store.setDevice((d) => ({ ...d, ...patch })));
  return { d: push.device ?? { enabled: true, label: "" }, off, set, failed };
}
export function DeviceName({ engine, row }: SlotControlProps) {
  const { d, off, set, failed } = useDevice(engine);
  const [text, setText] = useState(d.label);
  useEffect(() => setText(d.label), [d.label]);
  const commit = () => { if (text !== d.label) set({ label: text.slice(0, 80) }); };
  return <><Needs engine={engine} need={DEVICE} where={row.label ?? ""}>
    <input className="r1s-inp" aria-label={row.label} value={text} disabled={off} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
  </Needs><Failed text={failed} /></>;
}
export function DeviceLocked({ engine, row }: SlotControlProps) {
  const { d, off, set, failed } = useDevice(engine);
  return <><Needs engine={engine} need={DEVICE} where={row.label ?? ""}>
    <Select label={row.label ?? ""} value={d.detailLevel ?? "def"} options={[{ v: "def", label: "Use my default" }, ...DETAIL]} disabled={off} onChange={(v) => set({ detailLevel: v === "def" ? undefined : (v as Detail) })} />
  </Needs><Failed text={failed} /></>;
}
export function DeviceQuiet({ engine, row }: SlotControlProps) {
  const { d, off, set, failed } = useDevice(engine);
  const q = d.quietHours;
  return <><Needs engine={engine} need={DEVICE} where={row.label ?? ""}>
    <Select label={row.label ?? ""} value={onOff(q?.enabled)} options={ON_OFF} disabled={off}
      onChange={(v) => set({ quietHours: v === "def" ? undefined : { startMinute: 22 * 60, endMinute: 7 * 60, timeZone: "UTC", ...q, enabled: v === "on" } })} />
  </Needs><Failed text={failed} /></>;
}
export function DeviceTrunks({ engine, row }: SlotControlProps) {
  const { d, off, set, failed } = useDevice(engine);
  const trunks = useTrunks(engine);
  const ids = d.agentIds;
  const value = ids === undefined ? "def" : ids.length === 0 ? "*" : ids.length === 1 ? ids[0] : "many";
  const options = [{ v: "def", label: "Use my default" }, { v: "*", label: "Every Trunk" }, ...trunks.map((t) => ({ v: t.id, label: t.name })), ...(value === "many" ? [{ v: "many", label: `${ids?.length ?? 0} Trunks` }] : [])];
  return <><Needs engine={engine} need={DEVICE} where={row.label ?? ""}>
    <Select label={row.label ?? ""} value={value} options={options} disabled={off} onChange={(v) => { if (v !== "many") set({ agentIds: v === "def" ? undefined : v === "*" ? [] : [v] }); }} />
  </Needs><Failed text={failed} /></>;
}
export function DeviceCategory({ engine, row }: SlotControlProps) {
  const { d, off, set, failed } = useDevice(engine);
  const key = row.id.split(".").pop() as CategoryKey;
  return <><Needs engine={engine} need={DEVICE} where={row.label ?? ""}>
    <Select label={row.label ?? ""} value={onOff(d.categories?.[key])} options={ON_OFF} disabled={off} onChange={(v) => {
      const cats = { ...d.categories }; const next = fromOnOff(v);
      if (next === undefined) delete cats[key]; else cats[key] = next;
      set({ categories: cats });
    }} />
  </Needs><Failed text={failed} /></>;
}

/** Push to this browser: this browser's own Web Push subscription. */
export function PushBrowser({ engine, row }: SlotControlProps) {
  const push = usePush(engine);
  const [failed, run] = useFailure();
  const desktop = isDesktopApp();
  return <>
    <Needs engine={engine} need={["push.web.vapidPublicKey", "push.web.subscribe", "push.web.unsubscribe"]} where={row.label ?? ""}>
      <span className="r1s-own-ctl"><Toggle label={row.label ?? ""} on={Boolean(push.sub)} disabled={desktop || push.loading || !push.supported || !push.reg || push.permission === "denied"}
        onChange={(v) => void run(() => (v ? push.store.turnOn() : push.store.turnOff()))} /></span>
    </Needs>
    <Failed text={failed} />
  </>;
}

