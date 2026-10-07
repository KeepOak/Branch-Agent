// One engine config per window for every Settings row (§4.7.0 "Switches save at once"). Saves run one at a time
// against the latest revision; config.patch may answer with the new hash and config, which every row adopts. A save
// refused because the config changed elsewhere reads the config again and retries once.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { WindowEngine } from "../../connect/engine";
import { errorText, record, type ConfigSnapshot, type RecordValue } from "./adapter";

type Listener = () => void;
const CHANGED = /config changed since last load|base hash/i;

/** A config path: dotted, or a key list when a key holds dots itself (a model ref like "openai/gpt-5.5"). */
export type ConfigPath = string | string[];
export const pathKeys = (path: ConfigPath): string[] => (Array.isArray(path) ? path : path.split("."));

/** A JSON merge patch for one path (null removes the key, which puts the engine's default back). */
export function patchFor(path: ConfigPath, value: unknown): RecordValue {
  const patch: RecordValue = {};
  const keys = pathKeys(path);
  let target = patch;
  for (const key of keys.slice(0, -1)) {
    target[key] = {};
    target = target[key] as RecordValue;
  }
  target[keys[keys.length - 1]] = value;
  return patch;
}

/** A model setting may be a plain "provider/model" string or { primary, fallbacks }. Writing .primary or .fallbacks
 *  under a string would replace it in a merge patch and lose the model, so the whole setting is written instead. */
export function modelSafePatch(config: unknown, path: ConfigPath, value: unknown): RecordValue {
  const keys = pathKeys(path);
  const last = keys[keys.length - 1];
  if (last !== "primary" && last !== "fallbacks") return patchFor(path, value);
  const parentPath = keys.slice(0, -1);
  const parent = parentPath.reduce<unknown>((v, k) => record(v)[k], config);
  if (typeof parent !== "string") return patchFor(path, value);
  if (last === "primary") return patchFor(parentPath, value);
  return patchFor(parentPath, value === null ? parent : { primary: parent, fallbacks: value });
}

export class ConfigStore {
  snap: ConfigSnapshot | null = null;
  error: string | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<Listener>();
  private loading: Promise<void> | null = null;
  private revision = 0;
  private engine: WindowEngine;
  constructor(engine: WindowEngine) {
    this.engine = engine;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  load(): Promise<void> {
    const revision = this.revision;
    this.loading ??= this.engine.request<ConfigSnapshot>("config.get", {}).then(
      (snap) => { if (revision === this.revision) { this.snap = snap; this.error = undefined; } },
      (e: unknown) => { if (revision === this.revision) this.error = errorText(e); },
    ).finally(() => { this.loading = null; this.emit(); });
    return this.loading;
  }

  private async patchOnce(patch: RecordValue): Promise<void> {
    if (!this.snap?.hash) await this.load();
    if (!this.snap?.hash) throw new Error(this.error ?? "The engine did not give a settings revision.");
    if (this.snap.valid === false) throw new Error("The settings file has a problem. Fix it before changing settings here.");
    const baseHash = this.snap.hash;
    const result = record(await this.engine.request("config.patch", { raw: JSON.stringify(patch), baseHash }));
    if (result.ok === false) throw new Error(errorText(result.error ?? "The engine did not save the change."));
    this.revision++;
    if (typeof result.hash === "string" && result.config && typeof result.config === "object") {
      this.snap = { ...this.snap, hash: result.hash, config: record(result.config), valid: true };
      this.emit();
    }
    // Runtime config may be applied after the patch response. Read the committed value so
    // controls do not keep showing the previous default until the whole window reloads.
    if (this.loading) await this.loading;
    const committed = this.snap;
    await this.load();
    if (typeof result.hash === "string" && committed && this.snap?.hash !== committed.hash) {
      this.snap = committed;
      this.emit();
    }
  }

  /** Saves one path; queued behind earlier saves so each one uses the revision the last one returned. */
  set(path: ConfigPath, value: unknown): Promise<void> {
    const run = async () => {
      try {
        await this.patchOnce(modelSafePatch(this.snap?.config, path, value));
      } catch (e) {
        if (!CHANGED.test(errorText(e))) throw e;
        await this.load();
        await this.patchOnce(modelSafePatch(this.snap?.config, path, value));
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }
}

const stores = new WeakMap<WindowEngine, ConfigStore>();
/** The window's one store for this engine handle. */
export function configStore(engine: WindowEngine): ConfigStore {
  let store = stores.get(engine);
  if (!store) {
    store = new ConfigStore(engine);
    stores.set(engine, store);
  }
  return store;
}
