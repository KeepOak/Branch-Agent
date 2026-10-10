// Settings › Appearance: where the person's look is kept and how it reaches the window (§4.7.3).
// - The person's own choices follow them: one users.prefs entry ("ui.window.look") holds the page's rows, the
//   engine's own keys hold the accent and fonts ("ui.accent", "ui.fontUi", "ui.fontChat", shared with the Control UI),
//   and "ui.window.themeExtra" keeps the Good and Careful colours of your own themes (the engine palette has no key).
// - The chosen theme is the engine's (themes.list current); its colours come from the built-in table or themes.get.
// - "This device only" rows (text size) stay in this window's storage.
// - A copy is kept in this window's storage so the look is there before the engine answers; with no signed-in
//   profile (users.prefs says no_durable_identity) that copy is where everything is kept.
// - The look reaches the window as one <style> element (both modes, so the light/dark button keeps working), the
//   root's data-size and the contrast class, and the two keys the shell already reads (characterShown, askBeforeDelete).
import { useEffect, useSyncExternalStore } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { errorText, record, type RecordValue } from "../adapter";
import { accentVars, BUILTIN, DEFAULT_THEME, isHex, pairOfDefinition, varsOf, type Mode, type Pair } from "./appearance-look";

export const LOOK_PREF = "ui.window.look";
export const ENGINE_PREFS = { accent: "ui.accent", fontUi: "ui.fontUi", fontChat: "ui.fontChat", themeExtra: "ui.window.themeExtra" } as const;
export type EngineKey = keyof typeof ENGINE_PREFS;
export const DEVICE_KEYS = ["size"] as const;
const LOCAL = "branch.look";
const STYLE_ID = "branch-look";
const SCENE_FILES: Record<string, string> = {
  spring: "/assets/grove-spring.webp", autumn: "/assets/grove-autumn.webp", winter: "/assets/grove-winter.webp", night: "/assets/grove-night.webp",
  summer: "/assets/bg/grove-summer.webp", rain: "/assets/bg/grove-rain.webp", lake: "/assets/bg/grove-lake.webp",
  blossom: "/assets/bg/grove-blossom.webp", canyon: "/assets/bg/grove-canyon.webp", snownight: "/assets/bg/grove-snownight.webp",
  bamboo: "/assets/bg/grove-bamboo.webp", hills: "/assets/bg/grove-hills.webp",
  "night17-lake": "/assets/art17/bg/lake-night.webp", "night17-highland": "/assets/art17/bg/highland-moon.webp",
  "day17-sea": "/assets/art17/bg/sea-morning.webp", "day17-meadow": "/assets/art17/bg/meadow-afternoon.webp",
  "glow17-amber": "/assets/art17/bg/glow-amber.webp", "season17-snow": "/assets/art17/bg/first-snow.webp",
};
export function sceneFile(look: RecordValue): string | null {
  if (look.bg !== "painted" && look.bg !== "grove") return null;
  const month = new Date().getMonth();
  const seasonal = month < 2 || month === 11 ? "winter" : month < 5 ? "spring" : month < 8 ? "summer" : "autumn";
  const selected = look.bg === "grove" ? String(look.season ?? "auto") : String(look.scene ?? "auto");
  return SCENE_FILES[selected === "auto" ? seasonal : selected] ?? SCENE_FILES[seasonal];
}

export type Where = "loading" | "profile" | "device";
export type LookSnap = { look: RecordValue; device: RecordValue; prefs: Partial<Record<EngineKey, unknown>>; palette: Pair | null; where: Where; error?: string };
type Saved = Pick<LookSnap, "look" | "device" | "prefs" | "palette">;

function readLocal(): Saved {
  try {
    const r = record(JSON.parse(localStorage.getItem(LOCAL) ?? "{}"));
    return { look: record(r.look), device: record(r.device), prefs: record(r.prefs) as LookSnap["prefs"], palette: (r.palette as Pair | null) ?? null };
  } catch {
    return { look: {}, device: {}, prefs: {}, palette: null }; // storage blocked or damaged: the defaults
  }
}
function writeLocal(s: Saved) {
  try {
    localStorage.setItem(LOCAL, JSON.stringify({ look: s.look, device: s.device, prefs: s.prefs, palette: s.palette }));
  } catch (error) {
    console.warn("The look lasts for this window only: storage refused it:", errorText(error));
  }
}

const FONTS: Record<string, string> = {
  geist: "Geist", "instrument-sans": "Instrument Sans", "dm-sans": "DM Sans", "ibm-plex-sans": "IBM Plex Sans", "space-grotesk": "Space Grotesk",
  "atkinson-hyperlegible": "Atkinson Hyperlegible", fraunces: "Fraunces", lora: "Lora", "jetbrains-mono": "JetBrains Mono",
};
function fontStack(id: string | undefined): string | null {
  if (!id) return null;
  if (id === "system") return 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const name = FONTS[id];
  if (!name) return null;
  if (name !== "Geist" && !document.querySelector(`link[data-font="${id}"]`)) {
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, "+")}:wght@400;500;600&display=swap` });
    link.dataset.font = id;
    document.head.appendChild(link);
  }
  return `"${name}", system-ui, sans-serif`;
}

const block = (sel: string, vars: Record<string, string>) => `${sel}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
const DARK_SELS = ['@media (prefers-color-scheme: dark){:root:root:not([data-theme="light"])', ':root:root[data-theme="dark"]'];

/** The window's <style> for a look: the theme in both modes, the accent, fonts, text sizes and stillness. */
export function lookCss(s: Saved): string {
  const out: string[] = [];
  const scene = sceneFile(s.look);
  if (scene) {
    const scrim = Math.max(0, Math.min(90, Number(s.look.scrim ?? 35) || 0));
    const see = Math.max(0, Math.min(60, Number(s.look.see ?? 25) || 0));
    // Preview index.html:702-704,1169,10198: scrim/100 over the image; panels use 100% - see.
    out.push(block(":root:root", { "--scene-image": `url('${scene}')`, "--scene-cover": `${scrim}%`, "--scene-panel": `${100 - see}%` }));
  }
  const accent = isHex(s.prefs.accent) ? s.prefs.accent : null;
  const modeVars = (mode: Mode) => {
    const pal = s.palette ?? BUILTIN[DEFAULT_THEME];
    return { ...(s.palette ? varsOf(s.palette[mode], mode) : {}), ...(accent ? accentVars(accent, pal[mode].bg, mode) : {}) };
  };
  const light = modeVars("light"), dark = modeVars("dark");
  if (Object.keys(light).length) out.push(block(":root:root", light));
  if (Object.keys(dark).length) out.push(`${block(DARK_SELS[0], dark)}}`, block(DARK_SELS[1], dark));
  const ui = fontStack(typeof s.prefs.fontUi === "string" ? s.prefs.fontUi : s.palette?.font);
  const chat = fontStack(typeof s.prefs.fontChat === "string" ? s.prefs.fontChat : s.palette?.font);
  if (ui) out.push(`:root:root{--sans:${ui}}`);
  if (chat) out.push(`:root:root{--chat-font:${chat}}`, ".thread{font-family:var(--chat-font)}");
  out.push(':root[data-size="larger"] body{font-size:17.5px}', ':root[data-size="largest"] body{font-size:19.6px}');
  out.push(":root.still-k *,:root.still-k *::before,:root.still-k *::after{animation-play-state:paused!important}");
  return out.join("\n");
}

/** Mirrors two choices into the keys the shell already reads. */
function mirrorShell(look: RecordValue) {
  try {
    if (typeof look.agentShown === "boolean") localStorage.setItem("branch.characterShown", look.agentShown ? "1" : "0");
    if (look.askDelete === false) localStorage.setItem("branch.askBeforeDelete", "0");
    else if (look.askDelete === true) localStorage.removeItem("branch.askBeforeDelete");
  } catch (error) {
    console.warn("The shell keeps its earlier choice: storage refused it:", errorText(error));
  }
}

export function applyLook(s: Saved) {
  const root = document.documentElement;
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = Object.assign(document.createElement("style"), { id: STYLE_ID });
    document.head.appendChild(style);
  }
  style.textContent = lookCss(s);
  const size = String(s.device.size ?? "Regular");
  if (size === "Regular") root.removeAttribute("data-size"); else root.setAttribute("data-size", size);
  root.classList.toggle("contrast17", s.look.contrast === true);
  root.classList.toggle("still-k", s.look.still === true);
  root.toggleAttribute("data-still", s.look.still === true);
  root.toggleAttribute("data-scene", sceneFile(s.look) !== null);
  mirrorShell(s.look);
  window.dispatchEvent(new CustomEvent("branch:look-change", { detail: { look: s.look, device: s.device, prefs: s.prefs } }));
}

type Listener = () => void;
const statusOf = (r: unknown) => record(r).status;

/** The window's one look: reads the person's prefs and theme, saves each change at once and applies it.
 *  The engine handle changes with the open conversation; the store follows the latest one. */
export class LookStore {
  snap: LookSnap;
  private remote: RecordValue | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<Listener>();
  private loading: Promise<void> | null = null;
  private unwatch: (() => void) | null = null;
  private preview: Pair | null | undefined = undefined;
  private engine: WindowEngine;
  private disposed = false;
  private edits = new Map<string, unknown>();
  constructor(engine: WindowEngine) {
    this.engine = engine;
    this.snap = { ...readLocal(), where: "loading" };
  }
  /** Uses this engine handle from now on (and listens for pref changes on it instead of the old one). */
  attach(engine: WindowEngine) {
    if (engine === this.engine) return;
    this.engine = engine;
    if (this.unwatch) { this.unwatch(); this.unwatch = null; this.watch(); }
  }
  private watch() {
    if (this.disposed) return;
    this.unwatch ??= this.engine.onEvent((e) => { if (e.event === "users.prefs.changed") void this.load(); });
  }
  /** A signed-out store must neither listen nor repaint when its pending read finishes. */
  dispose(): void {
    this.disposed = true;
    this.unwatch?.();
    this.unwatch = null;
    this.listeners.clear();
  }
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(next: Partial<LookSnap>) {
    if (this.disposed) return;
    this.snap = { ...this.snap, ...next };
    writeLocal(this.snap);
    applyLook(this.preview === undefined ? this.snap : { ...this.snap, palette: this.preview });
    this.listeners.forEach((fn) => fn());
  }

  /** Reads the person's prefs, then the chosen theme's colours. */
  load(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.watch();
    this.loading ??= this.readPrefs().then(() => this.syncTheme()).finally(() => { this.loading = null; });
    return this.loading;
  }
  private async readPrefs() {
    try {
      const r = await this.engine.request("users.prefs.get", { keys: [LOOK_PREF, ...Object.values(ENGINE_PREFS)] });
      if (statusOf(r) !== "ok") return this.emit({ where: "device", error: undefined });
      const entries = record(record(r).entries);
      this.remote = entries[LOOK_PREF] === undefined ? null : record(entries[LOOK_PREF]);
      const prefs = Object.fromEntries(Object.entries(ENGINE_PREFS).flatMap(([k, key]) => (entries[key] === undefined || entries[key] === null ? [] : [[k, entries[key]]])));
      const look = { ...(this.remote ?? this.snap.look) };
      for (const [key, value] of this.edits) {
        const target = key in ENGINE_PREFS ? prefs : look;
        if (value === null) delete target[key]; else target[key] = value;
      }
      this.emit({ where: "profile", error: undefined, prefs, look });
    } catch (e) {
      this.emit({ where: "device", error: errorText(e) });
    }
  }
  /** Puts the chosen theme's colours on the window: the engine's choice, or this computer's without a profile. */
  async syncTheme(): Promise<void> {
    if (this.disposed) return;
    try {
      const engineId = String(record(record(await this.engine.request("themes.list", {})).current).id ?? DEFAULT_THEME);
      const id = this.snap.where === "profile" ? engineId : String(this.snap.look.theme ?? engineId);
      if (id === DEFAULT_THEME) return this.emit({ palette: null });
      if (BUILTIN[id]) return this.emit({ palette: BUILTIN[id] });
      const def = record(record(await this.engine.request("themes.get", { id })).definition);
      const pair = pairOfDefinition(def, record(record(this.snap.prefs.themeExtra)[id.replace(/^user\//, "")]));
      if (pair) this.emit({ palette: pair });
    } catch (e) {
      console.warn("The theme’s colours stay as they were: the theme couldn’t be read:", errorText(e));
    }
  }

  /** Writes entries to users.prefs; "conflict" means another window changed it first. */
  private async write(entries: RecordValue, expected?: RecordValue): Promise<"ok" | "conflict" | "device"> {
    if (this.disposed) throw new Error("This appearance session has ended.");
    const status = statusOf(await this.engine.request("users.prefs.set", { entries, ...(expected ? { expectedEntries: expected } : {}) }));
    if (status === "no_durable_identity") { this.emit({ where: "device" }); return "device"; }
    if (status !== "ok" && status !== "conflict") throw new Error("The engine didn’t save the change.");
    return status;
  }
  /** Saves one row of the look against the last value read; after a conflict, reads it again and puts only this row on it. */
  private async saveLook(key: string, value: unknown): Promise<void> {
    const put = (base: RecordValue) => { const next = { ...base }; if (value === null) delete next[key]; else next[key] = value; return next; };
    const next = put(this.remote ?? this.snap.look);
    if ((await this.write({ [LOOK_PREF]: next }, { [LOOK_PREF]: this.remote })) !== "conflict") { this.remote = next; return; }
    const fresh = record(await this.engine.request("users.prefs.get", { keys: [LOOK_PREF] }));
    const latest = record(record(fresh.entries)[LOOK_PREF]);
    const again = put(latest);
    const status = await this.write({ [LOOK_PREF]: again }, { [LOOK_PREF]: record(fresh.entries)[LOOK_PREF] === undefined ? null : latest });
    if (status === "conflict") throw new Error("Your look changed in another window at the same moment. Pick it again.");
    if (status === "ok") { this.remote = again; this.emit({ look: again }); }
  }

  /** Saves one row: a device row stays here, an engine key goes to its own pref, the rest to the person's look. */
  set(key: string, value: unknown): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if ((DEVICE_KEYS as readonly string[]).includes(key)) {
      this.emit({ device: { ...this.snap.device, [key]: value } });
      return Promise.resolve();
    }
    const own = key in ENGINE_PREFS ? (key as EngineKey) : null;
    this.edits.set(key, value);
    const into = own ? { ...this.snap.prefs } : { ...this.snap.look };
    if (value === null) delete (into as RecordValue)[key]; else (into as RecordValue)[key] = value;
    this.emit(own ? { prefs: into } : { look: into as RecordValue });
    const run = async () => {
      if (this.disposed) return;
      if (this.snap.where === "loading") await this.load();
      if (this.disposed) return;
      if (this.snap.where !== "profile") return;
      if (own) { if ((await this.write({ [ENGINE_PREFS[own]]: value })) === "conflict") throw new Error("The engine didn’t save the change."); }
      else await this.saveLook(key, value);
    };
    const next = this.chain.then(run, run).finally(() => { if (this.edits.get(key) === value) this.edits.delete(key); });
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Shows colours on the whole window while the editor is open; undefined puts the chosen theme back. */
  setPreviewFn = (palette: Pair | null | undefined) => {
    this.preview = palette;
    this.emit({});
  };
}

let single: LookStore | null = null;
/** The window's look store, following the given engine handle. */
export function lookStore(engine: WindowEngine): LookStore {
  single ??= new LookStore(engine);
  single.attach(engine);
  return single;
}
/** Starts over with the look kept in this window (after a sign-out, or between tests). */
export function forgetLookStore(): void {
  single?.dispose();
  single = null;
}

/** The look for a page: the snapshot, a row's value (or its default) and the store. */
export function useLook(engine: WindowEngine) {
  const store = lookStore(engine);
  const snap = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap, () => store.snap);
  useEffect(() => { if (snap.where === "loading") void store.load(); }, [store, snap.where]);
  const val = (key: string, fallback: unknown): unknown => {
    const from: RecordValue = (DEVICE_KEYS as readonly string[]).includes(key) ? snap.device : key in ENGINE_PREFS ? snap.prefs : snap.look;
    return from[key] ?? fallback;
  };
  return { snap, store, val };
}

/** Applies the look kept in this window before the engine answers (call once at start, after applySavedTheme). */
export function applySavedLook(): void {
  applyLook(readLocal());
}
