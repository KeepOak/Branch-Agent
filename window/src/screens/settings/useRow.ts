// useRow: one hook for every Settings row. It reads the row's value from where it lives, saves it the way that place
// saves (config rows through the window's one config store, which queues writes against the latest revision and retries
// once after a conflict), and says what state the row is in. Labels, help and the restart note come from config.schema.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { WindowEngine } from "../../connect/engine";
import { errorText, record, type RecordValue } from "../../places/settings/adapter";
import { configStore, pathKeys } from "../../places/settings/config-store";
import { isDeviceKey, lookHolder, lookStore } from "../../places/settings/set1/appearance-store";
import { has } from "../../places/inbox/data";
import { DESKTOP_CONTROLS_CHANGED, NEEDS_NEWER_APP, desktopControls, type DesktopControlName, type DesktopControlsBridge, type DesktopControlsState } from "../../connect/desktop-controls";
import { readOwnDesktopState, writeOwnDesktopState } from "./desktop-own-state";
import type { Level } from "./nav";
import { hintFor, rowHelp, rowLabel, rowLevel, type Row, type UiHints } from "./rows";

/** blocked: the value shows, but this connection or the settings file can't take a change now (the reason says why). */
export type RowState = "loading" | "ready" | "saving" | "error" | "coming" | "blocked";
export type RowView = {
  value: unknown;
  set: (value: unknown) => Promise<void>;
  state: RowState;
  /** Why the row can't be used, or what went wrong saving it. */
  reason?: string;
  /** The call a Coming row waits for. */
  need?: string;
  /** The engine calls the row's control makes (R1-10); empty when it only touches this window or this computer. */
  calls: string[];
  label: string;
  help?: string;
  /** The level the row shows at (its own, or Advanced when the schema marks the key advanced). */
  level: Level;
  /** The engine applies this key only after a restart (config.schema.lookup reloadKind). */
  restart: boolean;
  sensitive: boolean;
  /** Reads the row's value again (after a failed load or a conflict); clears the row's error once it reads. */
  retry: () => Promise<void>;
};

export const LOAD_FAILED = "Settings didn’t load. Try again.";
export const CHANGED_ELSEWHERE = "Changed somewhere else · Reload";
export const NO_PERSON = "Sign in as yourself on this Branch to keep your own choices.";
/** config.patch needs operator.admin; users.prefs.set needs operator.write (engine gateway/method-scopes.ts). */
export const NEEDS_ADMIN = "Changing how Branch is set up needs full access on this connection.";
export const NEEDS_WRITE = "This connection can look but not change your choices.";
export const INVALID_CONFIG = "The settings file has a problem. Fix it before changing settings here.";
/** Said on a desktop row when the Branch app on this computer is too old to change it (as Classic's Start with …). */
export const NEEDS_APP_UPDATE = "Update the Branch app on this computer to change this.";
export const DEVICE_REFUSED = "This device didn’t keep the choice.";
/** Sent on window when a row changes a device key, so other rows showing it follow (storage events skip this window). */
const DEVICE_CHANGED = "branch:device-setting";
const CHANGED = /config changed since last load|base hash/i;

type Listener = () => void;
class Emitter {
  private listeners = new Set<Listener>();
  subscribe = (fn: Listener): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  protected emit() { this.listeners.forEach((fn) => fn()); }
}

type SchemaSnap = { hints: UiHints; schema: unknown; error?: string } | null;
/** The engine's config.schema, read once per engine handle, and each path's reload kind, looked up once. */
class SchemaStore extends Emitter {
  snap: SchemaSnap = null;
  private loading: Promise<void> | null = null;
  private kinds = new Map<string, Promise<string | undefined>>();
  private engine: WindowEngine;
  constructor(engine: WindowEngine) { super(); this.engine = engine; }
  load(): Promise<void> {
    this.loading ??= this.engine.request<RecordValue>("config.schema", {}).then(
      (r) => { this.snap = { hints: record(record(r).uiHints) as UiHints, schema: record(r).schema }; },
      (e: unknown) => { this.snap = { hints: {}, schema: undefined, error: errorText(e) }; },
    ).finally(() => this.emit());
    return this.loading;
  }
  reloadKind(path: string): Promise<string | undefined> {
    let kind = this.kinds.get(path);
    if (!kind) {
      kind = this.engine.request<RecordValue>("config.schema.lookup", { path }).then((r) => {
        const k = record(r).reloadKind;
        return typeof k === "string" ? k : undefined;
      }, () => undefined);
      this.kinds.set(path, kind);
    }
    return kind;
  }
}

/** The schema node's default for a path (through object branches of anyOf / oneOf), if it declares one. */
export function schemaDefault(schema: unknown, path: string): unknown {
  let node: unknown = schema;
  for (const key of pathKeys(path)) {
    const n = record(node);
    const alt = [...(Array.isArray(n.anyOf) ? n.anyOf : []), ...(Array.isArray(n.oneOf) ? n.oneOf : [])];
    const holder = [n, ...alt.map(record)].find((x) => key in record(x.properties) || record(x.additionalProperties).type !== undefined);
    if (!holder) return undefined;
    node = key in record(holder.properties) ? record(holder.properties)[key] : holder.additionalProperties;
  }
  return record(node).default;
}

type PrefSnap = { entries: RecordValue; status: "loading" | "ok" | "device" | "error"; error?: string };
/** The person's own users.prefs entries that rows ask for, read in one call per batch and kept current. */
class PrefStore extends Emitter {
  snap: PrefSnap = { entries: {}, status: "loading" };
  private keys = new Set<string>();
  private queued: Promise<void> | null = null;
  private unwatch: (() => void) | null = null;
  private engine: WindowEngine;
  constructor(engine: WindowEngine) { super(); this.engine = engine; }
  /** Asks for a key. A key already asked for is read again only when the last read failed, so a row shown again (or
   *  Try again) recovers after a passing failure. */
  want(key: string) {
    const failed = this.snap.status === "error";
    if (this.keys.has(key) && !failed) return;
    this.keys.add(key);
    if (failed) { this.snap = { ...this.snap, status: "loading", error: undefined }; this.emit(); }
    this.queued ??= Promise.resolve().then(() => { this.queued = null; return this.load(); });
  }
  async load(): Promise<void> {
    this.unwatch ??= this.engine.onEvent((e) => { if (e.event === "users.prefs.changed") void this.load(); });
    const keys = [...this.keys];
    try {
      const r = record(await this.engine.request("users.prefs.get", { keys }));
      if (r.status !== "ok") { this.snap = { ...this.snap, status: "device" }; return; }
      const got = record(r.entries);
      this.snap = { entries: { ...this.snap.entries, ...Object.fromEntries(keys.map((k) => [k, got[k]])) }, status: "ok" };
    } catch (e) {
      this.snap = { ...this.snap, status: "error", error: errorText(e) };
    } finally { this.emit(); }
  }
  /** Saves one entry (null puts the default back); shows it at once and takes it back if the engine refuses. */
  async set(key: string, value: unknown): Promise<void> {
    const before = this.snap.entries[key];
    const put = (v: unknown) => { this.snap = { ...this.snap, entries: { ...this.snap.entries, [key]: v } }; this.emit(); };
    put(value);
    try {
      const r = record(await this.engine.request("users.prefs.set", { entries: { [key]: value } }));
      if (r.status === "conflict") throw new Error("It changed on another device. Try again.");
      if (r.status !== "ok") throw new Error(NO_PERSON);
    } catch (e) { put(before); throw e; }
  }
}

type DesktopSnap = { state: DesktopControlsState | null; error?: string };
/** The desktop app's controls, read once per bridge and kept current when any row (or Classic's) changes one. */
class DesktopStore extends Emitter {
  snap: DesktopSnap = { state: null };
  private started = false;
  private bridge: DesktopControlsBridge;
  constructor(bridge: DesktopControlsBridge) { super(); this.bridge = bridge; }
  start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener(DESKTOP_CONTROLS_CHANGED, (e) => {
      const state = (e as CustomEvent<DesktopControlsState>).detail;
      writeOwnDesktopState(state);
      this.snap = { state };
      this.emit();
    });
    // Do not call bridge.get(): on macOS that reads other apps' login items (Sequoia App Data).
    // Use Branch's own last snapshot, or each row's fallback until the person changes a switch.
    this.snap = { state: readOwnDesktopState() ?? ({} as DesktopControlsState) };
    this.emit();
  }
  async load(): Promise<void> {
    try {
      const state = await this.bridge.get();
      writeOwnDesktopState(state);
      this.snap = { state };
    } catch (e) { this.snap = { state: null, error: errorText(e) }; } finally { this.emit(); }
  }
  private queue: Promise<unknown> = Promise.resolve();
  /** Shows the change at once, so a quick second click reads it and sends the opposite, and sends changes one at a time
   *  in click order; a refused change puts the value back. */
  set(name: DesktopControlName, on: boolean): Promise<void> {
    const before = this.snap.state;
    if (before) { this.snap = { state: { ...before, [name]: on } }; this.emit(); }
    const run = this.queue.then(async () => {
      try {
        const next = await this.bridge.set(name, on);
        window.dispatchEvent(new CustomEvent(DESKTOP_CONTROLS_CHANGED, { detail: next }));
      } catch (e) {
        if (this.snap.state && before) { this.snap = { state: { ...this.snap.state, [name]: before[name] } }; this.emit(); }
        throw e;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
const desktops = new WeakMap<DesktopControlsBridge, DesktopStore>();

/** A device key's stored text, or null when there is none or storage is blocked. */
function deviceValue(key: string): string | null {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(key); } catch { return null; }
}

const schemas = new WeakMap<WindowEngine, SchemaStore>();
const prefs = new WeakMap<WindowEngine, PrefStore>();
const once = <K extends object, T>(map: WeakMap<K, T>, engine: K, make: () => T): T => {
  let value = map.get(engine);
  if (!value) { value = make(); map.set(engine, value); }
  return value;
};
export const schemaStore = (engine: WindowEngine) => once(schemas, engine, () => new SchemaStore(engine));
export const prefStore = (engine: WindowEngine) => once(prefs, engine, () => new PrefStore(engine));

/** The schema's labels and hints for this engine (loaded on first use). */
export function useSchemaHints(engine: WindowEngine): { hints: UiHints; schema: unknown; error?: string; loading: boolean } {
  const store = schemaStore(engine);
  const snap = useSyncExternalStore(store.subscribe, () => store.snap, () => store.snap);
  useEffect(() => { if (!store.snap) void store.load(); }, [store]);
  return { hints: snap?.hints ?? {}, schema: snap?.schema, error: snap?.error, loading: !snap };
}

type Status = { state: RowState; reason?: string };
type Source = {
  subscribe: (fn: Listener) => () => void;
  snapshot: () => unknown;
  start: () => () => void;
  read: () => unknown;
  status: () => Status;
  /** Why a change can't be sent now (the connection's scopes, an invalid settings file), or undefined when it can. */
  blocked: () => string | undefined;
  save: (value: unknown) => Promise<void>;
  /** Reads again; true when the read worked. */
  retry: () => Promise<boolean>;
  /** A line the source has for this row now, shown in place of its help. */
  note?: () => string | undefined;
};

/** Where a row's value lives, behind one shape: subscribe, a snapshot, what it reads, how it saves. */
function sourceOf(engine: WindowEngine, row: Row): Source {
  const src = row.source;
  if (src.kind === "config") {
    const store = configStore(engine);
    return {
      subscribe: (fn: Listener) => store.subscribe(fn),
      // The error is part of the snapshot: a failed first load leaves snap empty and must still redraw the rows.
      snapshot: () => (store.snap ?? store.error ?? null) as unknown,
      start: () => {
        if (!store.snap) void store.load();
        return engine.onEvent((e) => { if (e.event === "config.changed") void store.load(); });
      },
      read: () => pathKeys(src.path).reduce<unknown>((v, k) => record(v)[k], store.snap?.config),
      status: (): Status => (store.snap ? { state: "ready" } : store.error ? { state: "error", reason: LOAD_FAILED } : { state: "loading" }),
      blocked: () => (!has(engine, "operator.admin") ? NEEDS_ADMIN : store.snap?.valid === false ? INVALID_CONFIG : undefined),
      save: (value: unknown) => store.set(src.path, value),
      retry: async () => { await store.load(); return !store.error; },
    };
  }
  if (src.kind === "pref") {
    const store = prefStore(engine);
    return {
      subscribe: store.subscribe,
      snapshot: () => store.snap as unknown,
      start: () => { store.want(src.key); return () => undefined; },
      read: () => store.snap.entries[src.key],
      status: (): Status => {
        const s = store.snap.status;
        return s === "ok" ? { state: "ready" } : s === "loading" ? { state: "loading" } : { state: "error", reason: s === "device" ? NO_PERSON : LOAD_FAILED };
      },
      blocked: () => (has(engine, "operator.write") ? undefined : NEEDS_WRITE),
      save: (value: unknown) => store.set(src.key, value),
      retry: async () => { await store.load(); return store.snap.status === "ok"; },
    };
  }
  if (src.kind === "look") {
    const store = lookStore(engine);
    return {
      subscribe: (fn: Listener) => store.subscribe(fn),
      snapshot: () => store.snap as unknown,
      start: () => { if (store.snap.where === "loading") void store.load(); return () => undefined; },
      read: () => lookHolder(store.snap, src.key)[src.key],
      status: (): Status => (store.snap.where === "loading" && !isDeviceKey(src.key) ? { state: "loading" } : { state: "ready" }),
      // A device key, or a look kept on this device (no person), never reaches the engine; the rest is users.prefs.set.
      blocked: () => (isDeviceKey(src.key) || store.snap.where === "device" || has(engine, "operator.write") ? undefined : NEEDS_WRITE),
      save: (value: unknown) => store.set(src.key, value),
      retry: async () => { await store.load(); return true; },
    };
  }
  if (src.kind === "device") {
    return {
      subscribe: (fn: Listener) => {
        const on = (e: Event) => { if (!(e instanceof StorageEvent) || e.key === src.key || e.key === null) fn(); };
        window.addEventListener("storage", on);
        window.addEventListener(DEVICE_CHANGED, on);
        return () => { window.removeEventListener("storage", on); window.removeEventListener(DEVICE_CHANGED, on); };
      },
      snapshot: () => deviceValue(src.key),
      start: () => () => undefined,
      read: () => deviceValue(src.key),
      status: (): Status => ({ state: "ready" }),
      blocked: () => undefined,
      // null puts the default back by removing the key; this device keeps it, nothing goes to the engine.
      save: async (value: unknown) => {
        try {
          if (value === null || value === undefined) localStorage.removeItem(src.key);
          else localStorage.setItem(src.key, String(value));
        } catch { throw new Error(DEVICE_REFUSED); }
        window.dispatchEvent(new Event(DEVICE_CHANGED));
      },
      retry: async () => true,
    };
  }
  if (src.kind === "desktop") {
    const found = desktopControls();
    if (!("bridge" in found)) {
      // No Branch app on this computer (a browser), or one too old for these controls: the row shows why it is greyed.
      const why = found.off === NEEDS_NEWER_APP ? NEEDS_APP_UPDATE : found.off;
      return {
        subscribe: () => () => undefined, snapshot: () => null, start: () => () => undefined, read: () => undefined,
        status: (): Status => ({ state: "ready" }), blocked: () => why,
        save: () => Promise.reject(new Error(why)), retry: async () => false,
      };
    }
    const store = once(desktops, found.bridge, () => new DesktopStore(found.bridge));
    return {
      subscribe: store.subscribe,
      snapshot: () => store.snap as unknown,
      start: () => { store.start(); return () => undefined; },
      read: () => store.snap.state?.[src.name],
      // A one-time line the app has for this switch (the engine running inside the app) replaces its help.
      note: () => store.snap.state?.notes?.[src.name],
      status: (): Status => (store.snap.state ? { state: "ready" } : store.snap.error ? { state: "error", reason: LOAD_FAILED } : { state: "loading" }),
      blocked: () => undefined,
      save: (value: unknown) => store.set(src.name, value === true),
      retry: async () => { await store.load(); return store.snap.state !== null; },
    };
  }
  return {
    subscribe: () => () => undefined,
    snapshot: () => null,
    start: () => () => undefined,
    read: () => undefined,
    status: (): Status => ({ state: "coming", reason: src.reason }),
    blocked: () => src.reason,
    save: () => Promise.reject(new Error(src.reason)),
    retry: () => Promise.resolve(false),
  };
}

/** A row's value, its saver and its state. */
/** The engine calls behind a row (HANDOFF R1-06 "Engine calls"): config rows read with config.get and save with
 *  config.patch, the person's choices with users.prefs. A device key, a look kept on this device (no person) and the
 *  desktop bridge's switches never reach the engine. */
export function callsOf(engine: WindowEngine, row: Row): string[] {
  const src = row.source;
  if (src.kind === "config") return ["config.get", "config.patch"];
  if (src.kind === "pref") return ["users.prefs.get", "users.prefs.set"];
  if (src.kind === "look") return isDeviceKey(src.key) || lookStore(engine).snap.where === "device" ? [] : ["users.prefs.set"];
  if (src.kind === "coming") return [src.need];
  if (src.kind === "slot") return [...src.calls];
  return [];
}

export function useRow(engine: WindowEngine, row: Row): RowView {
  const { hints, schema } = useSchemaHints(engine);
  const source = useMemo(() => sourceOf(engine, row), [engine, row]);
  useSyncExternalStore(source.subscribe, source.snapshot, source.snapshot);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | undefined>();
  const [restart, setRestart] = useState(false);
  const path = row.source.kind === "config" ? row.source.path : null;
  useEffect(() => source.start(), [source]);
  useEffect(() => {
    if (!path) return;
    let live = true;
    void schemaStore(engine).reloadKind(path).then((kind) => { if (live) setRestart(kind === "restart"); });
    return () => { live = false; };
  }, [engine, path]);

  const stored = source.read();
  const raw = stored !== undefined && stored !== null ? stored : (path ? schemaDefault(schema, path) : undefined) ?? row.fallback;
  const value = row.codec ? row.codec.read(raw) : raw;
  const { codec } = row;
  const { save } = source;
  const base = source.status();
  const blocked = base.state === "ready" ? source.blocked() : undefined;
  const set = useCallback(async (next: unknown) => {
    // Never send a change the engine would refuse (a scope this connection lacks, an invalid settings file).
    if (blocked) throw new Error(blocked);
    setSaving(true);
    setFailed(undefined);
    try {
      await save(codec ? codec.write(next) : next);
    } catch (e) {
      const text = errorText(e);
      setFailed(CHANGED.test(text) ? CHANGED_ELSEWHERE : text);
      throw e;
    } finally { setSaving(false); }
  }, [save, codec, blocked]);
  const retry = useCallback(async () => {
    if (await source.retry()) setFailed(undefined);
  }, [source]);

  const state: RowState = base.state === "coming" ? "coming" : saving ? "saving" : failed ? "error" : blocked ? "blocked" : base.state;
  const hint = path ? hintFor(hints, path) : undefined;
  return {
    value, set, retry, state, reason: failed ?? blocked ?? base.reason,
    need: row.source.kind === "coming" ? row.source.need : row.source.kind === "slot" ? row.source.calls.join(" ") : undefined,
    calls: callsOf(engine, row),
    label: rowLabel(row, hints), help: source.note?.() ?? rowHelp(row, hints), level: rowLevel(row, hints), restart, sensitive: hint?.sensitive === true,
  };
}
