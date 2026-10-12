// The window's desktop controls: Start with Windows, keep working when the window closes, keep this computer awake,
// the branch command on PATH, the tray's usage ring and the "Get it" download pages. Every OS call is injected, so the
// tests use fakes and never change this computer's startup, power or PATH settings.
import { chmodSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { RELEASE_REPOSITORY } from "./component-update-manifest";
import { isOwnedComponentWindow } from "./component-update-ipc";

export interface DesktopSettings {
  /** Closing the window hides it in the tray and the engine keeps working (on by default, as before). */
  keepWorking: boolean;
  /** Holds off idle sleep while the app runs. Off until the owner chooses. */
  keepAwake: boolean;
  /** The tray icon shows the usage ring instead of the Branch icon. */
  trayUsage: boolean;
  /** Apply verified releases after a sustained idle period. */
  autoApplyUpdates: boolean;
  /** Outside agents (branch mcp serve ui_* tools) may see and operate this window over loopback remote
   *  debugging. Off until the owner chooses; read once at launch, so it takes effect on the next start. */
  agentControl: boolean;
}
export interface ControlsState extends DesktopSettings {
  startWithWindows: boolean;
  branchOnPath: boolean;
}
export type ControlName = keyof ControlsState;

export const DEFAULT_SETTINGS: DesktopSettings = { keepWorking: true, keepAwake: false, trayUsage: false, autoApplyUpdates: true, agentControl: false };

/** The engine's own app links (engine/ui/src/pages/apps/view.ts); desktops come from Branch's releases. */
const DESKTOP_RELEASES = `https://github.com/${RELEASE_REPOSITORY}/releases/latest`;
export const DOWNLOAD_PAGES: Readonly<Record<string, string>> = {
  iphone: "https://apps.apple.com/app/branch-ai-that-does-things/id6780396132",
  android: "https://play.google.com/store/apps/details?id=ai.branch.app",
  mac: DESKTOP_RELEASES,
  windows: DESKTOP_RELEASES,
  linux: DESKTOP_RELEASES,
  extension: "https://chromewebstore.google.com/detail/branch/kcdjddhmeafeomebliikmbpblkmkfoig",
};

export interface ControlDeps {
  settingsFile: string;
  login: { get(): boolean; set(on: boolean): void };
  awake: { start(): number; stop(id: number): void };
  cli: {
    installed(): Promise<boolean>; install(): Promise<void>; uninstall(): Promise<void>;
    /** Rewrites shims that exist with this launch's node and engine paths (never creates one, never touches PATH). */
    refresh?(): void;
  };
  tray: { usage(left: number | null, on: boolean): void };
  openExternal(url: string): Promise<void>;
  onChange?: (settings: DesktopSettings) => void;
}

export interface DesktopControls {
  settings(): DesktopSettings;
  get(): Promise<ControlsState>;
  set(name: ControlName, on: boolean): Promise<ControlsState>;
  openDownload(id: string): Promise<void>;
  trayUsage(left: number | null): void;
  /** Applies saved settings at launch (keep awake). */
  apply(): void;
  dispose(): void;
}

export function readSettings(file: string): DesktopSettings {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<DesktopSettings>;
    const pick = (key: keyof DesktopSettings) => typeof saved[key] === "boolean" ? saved[key] : DEFAULT_SETTINGS[key];
    return { keepWorking: pick("keepWorking"), keepAwake: pick("keepAwake"), trayUsage: pick("trayUsage"), autoApplyUpdates: pick("autoApplyUpdates"), agentControl: pick("agentControl") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function createDesktopControls(deps: ControlDeps): DesktopControls {
  let saved = readSettings(deps.settingsFile);
  let blocker: number | undefined;
  let lastLeft: number | null = null;
  const save = (): void => {
    mkdirSync(dirname(deps.settingsFile), { recursive: true });
    writeFileSync(deps.settingsFile, `${JSON.stringify(saved, null, 2)}\n`);
  };
  const holdAwake = (on: boolean): void => {
    if (on && blocker === undefined) blocker = deps.awake.start();
    if (!on && blocker !== undefined) { deps.awake.stop(blocker); blocker = undefined; }
  };
  const get = async (): Promise<ControlsState> => ({ ...saved, startWithWindows: deps.login.get(), branchOnPath: await deps.cli.installed() });
  const set = async (name: ControlName, on: boolean): Promise<ControlsState> => {
    if (typeof on !== "boolean") throw new Error("A desktop control takes on or off");
    if (name === "startWithWindows") deps.login.set(on);
    else if (name === "branchOnPath") await (on ? deps.cli.install() : deps.cli.uninstall());
    else if (name === "keepWorking" || name === "keepAwake" || name === "trayUsage" || name === "autoApplyUpdates" || name === "agentControl") {
      saved = { ...saved, [name]: on };
      save();
      if (name === "keepAwake") holdAwake(on);
      if (name === "trayUsage") deps.tray.usage(lastLeft, on);
      deps.onChange?.({ ...saved });
    } else throw new Error(`Unknown desktop control: ${String(name)}`);
    return get();
  };
  return {
    settings: () => ({ ...saved }), get, set,
    openDownload: async (id) => {
      const url = Object.hasOwn(DOWNLOAD_PAGES, id) ? DOWNLOAD_PAGES[id] : undefined;
      if (!url) throw new Error(`No download page for ${id}`);
      await deps.openExternal(url);
    },
    trayUsage: (left) => {
      lastLeft = typeof left === "number" && Number.isFinite(left) ? Math.max(0, Math.min(100, left)) : null;
      deps.tray.usage(lastLeft, saved.trayUsage);
    },
    apply: () => {
      holdAwake(saved.keepAwake);
      // An update can move the bundled node; the branch command (and agents registered with it) must keep working.
      try { deps.cli.refresh?.(); } catch { /* a locked or read-only shim keeps its old copy */ }
    },
    dispose: () => holdAwake(false),
  };
}

interface Sender { getURL(): string; mainFrame: { url: string } }
interface InvokeEvent { sender: Sender; senderFrame: Sender["mainFrame"] | null }
interface Ipc {
  handle(channel: string, listener: (event: InvokeEvent, ...args: unknown[]) => Promise<unknown>): void;
  on(channel: string, listener: (event: InvokeEvent, ...args: unknown[]) => void): void;
}

/** Only the owned served window may call; the renderer never passes a URL or a path. */
export function registerDesktopControlsIpc(ipc: Ipc, owner: (event: InvokeEvent) => Sender | undefined, servedUrl: string, controls: DesktopControls): void {
  const owned = (event: InvokeEvent): void => {
    if (!isOwnedComponentWindow(event, owner(event), servedUrl)) throw new Error("Desktop controls require the owned served window");
  };
  ipc.handle("branch-desktop:controls:get", async (event) => { owned(event); return controls.get(); });
  ipc.handle("branch-desktop:controls:set", async (event, name, on) => {
    owned(event);
    if (typeof name !== "string" || typeof on !== "boolean") throw new Error("A desktop control takes a name and on or off");
    return controls.set(name as ControlName, on);
  });
  ipc.handle("branch-desktop:controls:open-download", async (event, id) => {
    owned(event);
    if (typeof id !== "string") throw new Error("A download takes an app id");
    await controls.openDownload(id);
  });
  ipc.on("branch-desktop:controls:tray-usage", (event, left) => {
    if (!isOwnedComponentWindow(event, owner(event), servedUrl)) return;
    controls.trayUsage(typeof left === "number" ? left : null);
  });
}

/** A ring for the tray: the share left as an arc from the top, clockwise, over a faint track. BGRA, size×size. */
export function ringBitmap(left: number, size = 32): Buffer {
  const out = Buffer.alloc(size * size * 4);
  const share = Math.max(0, Math.min(100, left)) / 100;
  const outer = size / 2 - 1, inner = outer - Math.max(3, Math.round(size / 7));
  const [r, g, b] = share * 100 < 15 ? [217, 119, 6] : [13, 148, 136];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - size / 2, dy = y + 0.5 - size / 2, d = Math.hypot(dx, dy);
      if (d > outer || d < inner) continue;
      const turn = ((Math.atan2(dx, -dy) / (2 * Math.PI)) + 1) % 1;
      const on = turn < share;
      const i = (y * size + x) * 4;
      // Premultiplied, as Skia bitmaps are: the 110-alpha track is grey 160 scaled by 110/255.
      out[i] = on ? b : 69; out[i + 1] = on ? g : 69; out[i + 2] = on ? r : 69; out[i + 3] = on ? 255 : 110;
    }
  }
  return out;
}

/** The branch command: a shim that reads the running engine (else the published one), the token and the live port. */
export function branchShim(o: { dataDir: string; engineDir: string; nodePath: string; gatewayPort: number }): string {
  return [
    "@echo off",
    "setlocal",
    `set "BRANCH_DATA=${o.dataDir}"`,
    `set "ENGINE=${o.engineDir}"`,
    `if exist "%BRANCH_DATA%\\engine-current.txt" set /p ENGINE=<"%BRANCH_DATA%\\engine-current.txt"`,
    // The engine actually running wins over a staged one that has not been applied yet.
    `if exist "%BRANCH_DATA%\\engine-running.txt" set /p ENGINE=<"%BRANCH_DATA%\\engine-running.txt"`,
    `if exist "%BRANCH_DATA%\\gateway-token" set /p BRANCH_GATEWAY_TOKEN=<"%BRANCH_DATA%\\gateway-token"`,
    `set "BRANCH_PROFILE=default"`,
    `set "BRANCH_HOME=%BRANCH_DATA%\\home"`,
    `set "BRANCH_STATE_DIR=%BRANCH_HOME%\\.branch"`,
    `set "BRANCH_CONFIG_PATH=%BRANCH_STATE_DIR%\\branch.json"`,
    `set "BRANCH_GATEWAY_PORT=${o.gatewayPort}"`,
    // An update can move the engine to another loopback port; the desktop records the live one here.
    `if exist "%BRANCH_DATA%\\gateway-port" set /p BRANCH_GATEWAY_PORT=<"%BRANCH_DATA%\\gateway-port"`,
    `"${o.nodePath}" "%ENGINE%\\branch.mjs" %*`,
    "",
  ].join("\r\n");
}

/** The same shim for Git Bash, which runs an extensionless sh script rather than branch.cmd. Node takes the
 *  Windows paths as they are; CR is dropped from the files it reads. */
export function branchShShim(o: { dataDir: string; engineDir: string; nodePath: string; gatewayPort: number }): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const slash = (s: string) => s.replace(/\\/g, "/");
  return [
    "#!/bin/sh",
    `data=${q(slash(o.dataDir))}`,
    `engine=${q(o.engineDir)}`,
    `if [ -f "$data/engine-current.txt" ]; then engine=$(head -n 1 "$data/engine-current.txt" | tr -d '\\r'); fi`,
    `if [ -f "$data/engine-running.txt" ]; then running=$(head -n 1 "$data/engine-running.txt" | tr -d '\\r'); if [ -n "$running" ]; then engine=$running; fi; fi`,
    `if [ -f "$data/gateway-token" ]; then BRANCH_GATEWAY_TOKEN=$(head -n 1 "$data/gateway-token" | tr -d '\\r'); export BRANCH_GATEWAY_TOKEN; fi`,
    `BRANCH_PROFILE=default; BRANCH_HOME=${q(`${o.dataDir}\\home`)}; BRANCH_STATE_DIR=${q(`${o.dataDir}\\home\\.branch`)}; BRANCH_CONFIG_PATH=${q(`${o.dataDir}\\home\\.branch\\branch.json`)}; BRANCH_GATEWAY_PORT=${o.gatewayPort}`,
    `if [ -f "$data/gateway-port" ]; then live=$(head -n 1 "$data/gateway-port" | tr -d '\\r'); if [ -n "$live" ]; then BRANCH_GATEWAY_PORT=$live; fi; fi`,
    // BRANCH_DATA lets a long-running `branch mcp serve` re-read gateway-port after an update moves the engine.
    `BRANCH_DATA=${q(o.dataDir)}`,
    "export BRANCH_DATA BRANCH_PROFILE BRANCH_HOME BRANCH_STATE_DIR BRANCH_CONFIG_PATH BRANCH_GATEWAY_PORT",
    `exec ${q(slash(o.nodePath))} "$engine/branch.mjs" "$@"`,
    "",
  ].join("\n");
}

/** The first lines of the macOS and Linux branch command, so the app only ever rewrites or removes its own file. */
export const BRANCH_COMMAND_MARKER = "# Branch Agent's command, written by the Branch Agent app.";
/** What the earlier installer wrote at the same place. Its command ran Contents/Resources/app/dist/cli.js, which the
 *  packaged app (app.asar) no longer has, so the app takes that file over and points it at the engine it runs. */
export const LEGACY_BRANCH_COMMAND_MARKER = "# Branch Agent's command, written by its installer.";

/** The branch command for macOS and Linux: the same engine, node, token and live port as the Windows shims. The
 *  engine is the unpacked copy the app runs (engine-running.txt, else engine-current.txt), never a path inside
 *  app.asar, which only Electron can read. */
export function branchPosixShim(o: { dataDir: string; engineDir: string; nodePath: string; gatewayPort: number }): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const firstLine = (file: string, name: string) =>
    `if [ -f "$data/${file}" ]; then ${name}=$(head -n 1 "$data/${file}" | tr -d '\\r'); fi`;
  return [
    "#!/bin/sh",
    BRANCH_COMMAND_MARKER,
    "# Turning off \"Type branch in any terminal\" in Branch removes this file.",
    `data=${q(o.dataDir)}`,
    `engine=${q(o.engineDir)}`,
    `current=; ${firstLine("engine-current.txt", "current")}; if [ -n "$current" ]; then engine=$current; fi`,
    // The engine actually running wins over a staged one that has not been applied yet.
    `running=; ${firstLine("engine-running.txt", "running")}; if [ -n "$running" ]; then engine=$running; fi`,
    `if [ -f "$data/gateway-token" ]; then BRANCH_GATEWAY_TOKEN=$(head -n 1 "$data/gateway-token" | tr -d '\\r'); export BRANCH_GATEWAY_TOKEN; fi`,
    `BRANCH_PROFILE=default; BRANCH_HOME="$data/home"; BRANCH_STATE_DIR="$data/home/.branch"; BRANCH_CONFIG_PATH="$data/home/.branch/branch.json"; BRANCH_GATEWAY_PORT=${o.gatewayPort}`,
    `live=; ${firstLine("gateway-port", "live")}; if [ -n "$live" ]; then BRANCH_GATEWAY_PORT=$live; fi`,
    "BRANCH_DATA=$data",
    "export BRANCH_DATA BRANCH_PROFILE BRANCH_HOME BRANCH_STATE_DIR BRANCH_CONFIG_PATH BRANCH_GATEWAY_PORT",
    `exec ${q(o.nodePath)} "$engine/branch.mjs" "$@"`,
    "",
  ].join("\n");
}

/** Who wrote the file at the branch command's place: this app, the earlier installer, someone else, or nobody. */
export function branchCommandOwner(file: string): "app" | "installer" | "other" | "none" {
  try {
    if (lstatSync(file).isSymbolicLink()) return "other";
    const head = readFileSync(file, "utf8").split("\n", 3);
    if (head.includes(BRANCH_COMMAND_MARKER)) return "app";
    return head.includes(LEGACY_BRANCH_COMMAND_MARKER) ? "installer" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "none";
    throw error;
  }
}

/** The macOS and Linux branch command at `file` (~/.local/bin/branch). Someone else's file there is never touched. */
export function posixBranchCommand(file: string, shim: () => string): ControlDeps["cli"] {
  const write = (): void => {
    mkdirSync(dirname(file), { recursive: true });
    const next = `${file}.${process.pid}.tmp`;
    writeFileSync(next, shim(), { mode: 0o755 });
    chmodSync(next, 0o755);
    renameSync(next, file);
  };
  return {
    installed: async () => branchCommandOwner(file) === "app",
    install: async () => {
      if (branchCommandOwner(file) === "other") throw new Error(`${file} is another program's branch command, so Branch left it as it is`);
      write();
    },
    uninstall: async () => { if (branchCommandOwner(file) !== "other") rmSync(file, { force: true }); },
    // Also repairs the earlier installer's command, which points into a dist/cli.js the packaged app no longer has.
    refresh: () => { if (["app", "installer"].includes(branchCommandOwner(file))) write(); },
  };
}

const samePath =(a: string, b: string): boolean => a.trim().replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
/** Whether the user Path already names `dir`. */
export function pathHas(current: string, dir: string): boolean {
  return current.split(";").some((p) => samePath(p, dir));
}

/** The user Path with `dir` added or removed (case-insensitive, no duplicates, no empty entries). */
export function editUserPath(current: string, dir: string, add: boolean): string {
  const parts = current.split(";").filter((p) => p.trim() !== "" && !samePath(p, dir));
  return (add ? [...parts, dir] : parts).join(";");
}
