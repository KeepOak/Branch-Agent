// useRow: one hook for every Settings row. It reads the row's value from where it lives, saves it the way that place
// saves (config rows through the window's one config store, which queues writes against the latest revision and retries
// once after a conflict), and says what state the row is in. Labels, help and the restart note come from config.schema.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { WindowEngine } from "../../connect/engine";
import { errorText, record, type RecordValue } from "../../places/settings/adapter";
import { configStore, pathKeys } from "../../places/settings/config-store";
import { DEVICE_KEYS, lookStore } from "../../places/settings/set1/appearance-store";
import type { Level } from "./nav";
import { hintFor, rowHelp, rowLabel, rowLevel, type Row, type UiHints } from "./rows";

export type RowState = "loading" | "ready" | "saving" | "error" | "coming";
export type RowView = {
  value: unknown;
  set: (value: unknown) => Promise<void>;
  state: RowState;
  /** Why the row can't be used, or what went wrong saving it. */
  reason?: string;
  /** The call a Coming row waits for. */
  need?: string;
  label: string;
  help?: string;
  /** The level the row shows at (its own, or Advanced when the schema marks the key advanced). */
  level: Level;
  /** The engine applies this key only after a restart (config.schema.lookup reloadKind). */
  restart: boolean;
  sensitive: boolean;
};

export const LOAD_FAILED = "Settings didn’t load. Try again.";
export const CHANGED_ELSEWHERE = "Changed somewhere else · Reload";
export const NO_PERSON = "Sign in as yourself on this Branch to keep your own choices.";
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
  want(key: string) {
    if (this.keys.has(key)) return;
    this.keys.add(key);
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

const schemas = new WeakMap<WindowEngine, SchemaStore>();
const prefs = new WeakMap<WindowEngine, PrefStore>();
const once = <T,>(map: WeakMap<WindowEngine, T>, engine: WindowEngine, make: () => T): T => {
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

const isDevice = (key: string) => (DEVICE_KEYS as readonly string[]).includes(key);

/** Where a row's value lives, behind one shape: subscribe, a snapshot, what it reads, how it saves. */
function sourceOf(engine: WindowEngine, row: Row) {
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
      status: (): { state: RowState; reason?: string } => (store.snap ? { state: "ready" } : store.error ? { state: "error", reason: LOAD_FAILED } : { state: "loading" }),
      save: (value: unknown) => store.set(src.path, value),
    };
  }
  if (src.kind === "pref") {
    const store = prefStore(engine);
    return {
      subscribe: store.subscribe,
      snapshot: () => store.snap as unknown,
      start: () => { store.want(src.key); return () => undefined; },
      read: () => store.snap.entries[src.key],
      status: (): { state: RowState; reason?: string } => {
        const s = store.snap.status;
        return s === "ok" ? { state: "ready" } : s === "loading" ? { state: "loading" } : { state: "error", reason: s === "device" ? NO_PERSON : LOAD_FAILED };
      },
      save: (value: unknown) => store.set(src.key, value),
    };
  }
  if (src.kind === "look") {
    const store = lookStore(engine);
    return {
      subscribe: (fn: Listener) => store.subscribe(fn),
      snapshot: () => store.snap as unknown,
      start: () => { if (store.snap.where === "loading") void store.load(); return () => undefined; },
      read: () => (isDevice(src.key) ? store.snap.device : store.snap.look)[src.key],
      status: (): { state: RowState; reason?: string } => (store.snap.where === "loading" && !isDevice(src.key) ? { state: "loading" } : { state: "ready" }),
      save: (value: unknown) => store.set(src.key, value),
    };
  }
  return {
    subscribe: () => () => undefined,
    snapshot: () => null,
    start: () => () => undefined,
    read: () => undefined,
    status: (): { state: RowState; reason?: string } => ({ state: "coming", reason: src.reason }),
    save: () => Promise.reject(new Error(src.reason)),
  };
}

/** A row's value, its saver and its state. */
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
  const set = useCallback(async (next: unknown) => {
    setSaving(true);
    setFailed(undefined);
    try {
      await save(codec ? codec.write(next) : next);
    } catch (e) {
      const text = errorText(e);
      setFailed(CHANGED.test(text) ? CHANGED_ELSEWHERE : text);
      throw e;
    } finally { setSaving(false); }
  }, [save, codec]);

  const base = source.status();
  const state: RowState = base.state === "coming" ? "coming" : saving ? "saving" : failed ? "error" : base.state;
  const hint = path ? hintFor(hints, path) : undefined;
  return {
    value, set, state, reason: failed ?? base.reason,
    need: row.source.kind === "coming" ? row.source.need : undefined,
    label: rowLabel(row, hints), help: rowHelp(row, hints), level: rowLevel(row, hints), restart, sensitive: hint?.sensitive === true,
  };
}
