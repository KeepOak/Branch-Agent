// The window's desktop controls: Start with Windows, keep working when the window closes, keep this computer awake
// while Trunks work (Private #454 D: the blocker itself is keep-awake.ts, held only while a run is active), keep working
// when nobody is signed in (Linux linger),
// the branch command on PATH, the tray's usage ring and the "Get it" download pages. Every OS call is injected, so the
// tests use fakes and never change this computer's startup, power or PATH settings.
import { chmodSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { saveUnlessDiskFull } from "./disk-full";
import { dirname, join } from "node:path";
import { RELEASE_REPOSITORY } from "./component-update-manifest";
import { isOwnedComponentWindow } from "./component-update-ipc";

export interface DesktopSettings {
  /** Closing the window hides it in the tray and the engine keeps working (on by default, as before). */
  keepWorking: boolean;
  /** Keeps this computer awake while a Trunk works, and only then (keep-awake.ts). On by default, when plugged in. */
  keepAwake: boolean;
  /** Keep awake while a Trunk works on battery too. Off by default: on battery the computer may sleep. */
  keepAwakeOnBattery: boolean;
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
  /** Linux only: the engine service keeps running when nobody is signed in (systemd linger). Off by default. */
  keepWorkingSignedOut?: boolean;
  /** One-time lines for Settings under a control, such as why the engine runs inside the app on this computer. */
  notes?: Partial<Record<string, string>>;
}
export type ControlName = { [K in keyof ControlsState]-?: ControlsState[K] extends boolean | undefined ? K : never }[keyof ControlsState];

export const DEFAULT_SETTINGS: DesktopSettings = { keepWorking: true, keepAwake: true, keepAwakeOnBattery: false, trayUsage: false, autoApplyUpdates: true, agentControl: false };

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

/** How this copy of Branch was installed, so "Remove the app" takes away only the app (Private #1102). */
export type AppRemoval =
  | { kind: "windows"; uninstaller: string }
  | { kind: "mac"; bundles: string[] }
  | { kind: "appimage"; files: string[] }
  | { kind: "none"; reason: string };
export interface AppRemovalTarget {
  platform: string; execPath: string; packaged: boolean;
  /** %LOCALAPPDATA% on Windows: the per-user install's uninstaller sits in Programs\Branch Agent Uninstall. */
  localAppData?: string;
  /** $APPIMAGE on Linux: the file the app runs from. */
  appImage?: string;
  exists(path: string): boolean;
}
/** What the confirm sheet says: exactly what goes and what stays. */
export interface AppRemovalPlan { supported: boolean; reason?: string; removes: string[]; keeps: string[]; dataDir: string }

/** Inno Setup names a per-user install's uninstaller unins000.exe, in UninstallFilesDir (release-installers.mjs). */
export const WINDOWS_UNINSTALL_DIR = ["Programs", "Branch Agent Uninstall"];
export const APP_REMOVAL_KEEPS = ["Your conversations", "Your Trunks and what they remember", "Your settings and connected accounts"];
const FROM_SOURCE = "This copy of Branch runs from its source folder, so there is no installed app to remove.";

export function appRemoval(t: AppRemovalTarget): AppRemoval {
  if (!t.packaged) return { kind: "none", reason: FROM_SOURCE };
  if (t.platform === "win32") {
    const uninstaller = t.localAppData ? join(t.localAppData, ...WINDOWS_UNINSTALL_DIR, "unins000.exe") : "";
    return uninstaller && t.exists(uninstaller) ? { kind: "windows", uninstaller }
      : { kind: "none", reason: "Branch’s uninstaller isn’t on this computer. Remove Branch from Settings › Apps instead." };
  }
  if (t.platform === "darwin") {
    const at = t.execPath.indexOf(".app/Contents/");
    if (at < 0) return { kind: "none", reason: FROM_SOURCE };
    const bundle = t.execPath.slice(0, at + 4);
    // A whole-app update leaves the old copy aside as .Branch.previous beside it (mac-applications.ts).
    const aside = join(dirname(bundle), ".Branch.previous");
    return { kind: "mac", bundles: [bundle, ...(t.exists(aside) ? [aside] : [])] };
  }
  if (t.platform === "linux") {
    if (!t.appImage) return { kind: "none", reason: "Branch was installed by your package manager here. Remove it there; your data stays." };
    const previous = `${t.appImage}.previous`;
    return { kind: "appimage", files: [t.appImage, ...(t.exists(previous) ? [previous] : [])] };
  }
  return { kind: "none", reason: FROM_SOURCE };
}

export function appRemovalPlan(removal: AppRemoval, o: { dataDir: string; startsAtLogin: boolean; branchOnPath: boolean; service: boolean }): AppRemovalPlan {
  const keeps = [...APP_REMOVAL_KEEPS];
  if (removal.kind === "none") return { supported: false, reason: removal.reason, removes: [], keeps, dataDir: o.dataDir };
  const removes = [
    removal.kind === "windows" ? "The Branch app, with its Start menu and desktop shortcuts"
      : removal.kind === "mac" ? "The Branch app (it goes to the Trash)" : "The Branch app (its AppImage file)",
    ...(o.service ? ["Branch’s background service, so nothing keeps running"] : []),
    ...(o.startsAtLogin ? ["Starting Branch when you sign in"] : []),
    ...(o.branchOnPath ? ["The branch command in your terminal"] : []),
  ];
  return { supported: true, removes, keeps, dataDir: o.dataDir };
}

export interface ControlDeps {
  settingsFile: string;
  /** "Remove the app, keep my data": the install it came from, and the steps that remove it. Absent in tests of
   *  other controls and in older wiring, where the window shows why it can't. */
  removeApp?: {
    dataDir: string;
    removal(): AppRemoval;
    /** Stops and removes the engine service (`branch gateway uninstall`); absent when there is none. */
    service?: () => Promise<void>;
    /** Removes the app itself, or starts its uninstaller to do so once the app has quit. */
    launch(removal: Exclude<AppRemoval, { kind: "none" }>): Promise<void>;
    quit(): void;
  };
  login: { get(): boolean; set(on: boolean): void };
  /** Linux: the engine's systemd-linger path (`branch gateway linger`); absent elsewhere. */
  linger?: { get(): Promise<boolean>; set(on: boolean): Promise<void> };
  /** One-time lines for Settings (the engine running inside the app, from engine-service takeChildModeNotice). */
  notes?: () => Partial<Record<string, string>>;
  cli: {
    installed(): Promise<boolean>; install(): Promise<void>; uninstall(): Promise<void>;
    /** Rewrites shims that exist with this launch's node and engine paths (never creates one, never touches PATH). */
    refresh?(): void;
  };
  tray: { usage(left: number | null, on: boolean): void };
  openExternal(url: string): Promise<void>;
  /** Writes the settings file; tests inject a failing one. */
  writeFile?: (path: string, text: string) => void;
  onChange?: (settings: DesktopSettings) => void;
}

export interface DesktopControls {
  settings(): DesktopSettings;
  get(): Promise<ControlsState>;
  set(name: ControlName, on: boolean): Promise<ControlsState>;
  openDownload(id: string): Promise<void>;
  trayUsage(left: number | null): void;
  removalPlan(): Promise<AppRemovalPlan>;
  /** Removes the app and quits; conversations, Trunks and settings in the data folder stay. */
  removeApp(): Promise<void>;
  /** Applies saved settings at launch (refreshes the branch command). */
  apply(): void;
  dispose(): void;
}

export function readSettings(file: string): DesktopSettings {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<DesktopSettings>;
    const pick = (key: keyof DesktopSettings) => typeof saved[key] === "boolean" ? saved[key] : DEFAULT_SETTINGS[key];
    return { keepWorking: pick("keepWorking"), keepAwake: pick("keepAwake"), keepAwakeOnBattery: pick("keepAwakeOnBattery"), trayUsage: pick("trayUsage"), autoApplyUpdates: pick("autoApplyUpdates"), agentControl: pick("agentControl") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function createDesktopControls(deps: ControlDeps): DesktopControls {
  let saved = readSettings(deps.settingsFile);
  let lastLeft: number | null = null;
  // Linger is the OS's state, read once through the engine and then kept as changed here.
  let linger: Promise<boolean | undefined> | undefined;
  // A full disk keeps the new setting in memory and shows the disk-full banner; the next save writes it.
  const save = (): void => {
    saveUnlessDiskFull(() => {
      mkdirSync(dirname(deps.settingsFile), { recursive: true });
      (deps.writeFile ?? writeFileSync)(deps.settingsFile, `${JSON.stringify(saved, null, 2)}\n`);
    });
  };
  const get = async (): Promise<ControlsState> => {
    linger ??= deps.linger?.get().catch(() => undefined);
    const signedOut = await linger;
    const notes = deps.notes?.() ?? {};
    return { ...saved, startWithWindows: deps.login.get(), branchOnPath: await deps.cli.installed(),
      ...(deps.linger ? { keepWorkingSignedOut: signedOut ?? false } : {}), ...(Object.keys(notes).length ? { notes } : {}) };
  };
  const set = async (name: ControlName, on: boolean): Promise<ControlsState> => {
    if (typeof on !== "boolean") throw new Error("A desktop control takes on or off");
    if (name === "startWithWindows") deps.login.set(on);
    else if (name === "branchOnPath") await (on ? deps.cli.install() : deps.cli.uninstall());
    else if (name === "keepWorkingSignedOut") {
      if (!deps.linger) throw new Error("Keeping Branch working when nobody is signed in is a Linux choice");
      await deps.linger.set(on);
      linger = Promise.resolve(on);
    } else if (name === "keepWorking" || name === "keepAwake" || name === "keepAwakeOnBattery" || name === "trayUsage" || name === "autoApplyUpdates" || name === "agentControl") {
      saved = { ...saved, [name]: on };
      save();
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
    removalPlan: async () => {
      const remove = deps.removeApp;
      if (!remove) return appRemovalPlan({ kind: "none", reason: "Removing the app needs a newer Branch app." }, { dataDir: "", startsAtLogin: false, branchOnPath: false, service: false });
      return appRemovalPlan(remove.removal(), { dataDir: remove.dataDir, startsAtLogin: deps.login.get(), branchOnPath: await deps.cli.installed(), service: Boolean(remove.service) });
    },
    removeApp: async () => {
      const remove = deps.removeApp;
      const removal = remove?.removal();
      if (!remove || !removal || removal.kind === "none") throw new Error(removal?.kind === "none" ? removal.reason : "Removing the app needs a newer Branch app.");
      // Everything outside the data folder that points at the app goes first; the data folder is never touched.
      await remove.service?.();
      if (deps.login.get()) deps.login.set(false);
      if (await deps.cli.installed()) await deps.cli.uninstall();
      await remove.launch(removal);
      remove.quit();
    },
    apply: () => {
      // An update can move the bundled node; the branch command (and agents registered with it) must keep working.
      try { deps.cli.refresh?.(); } catch { /* a locked or read-only shim keeps its old copy */ }
    },
    dispose: () => undefined,
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
  ipc.handle("branch-desktop:controls:removal-plan", async (event) => { owned(event); return controls.removalPlan(); });
  ipc.handle("branch-desktop:controls:remove-app", async (event) => { owned(event); await controls.removeApp(); });
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

/** Reads gateway.pid's command line for a live .../branch.mjs. Pointer files can name a different valid engine. */
const LIVE_ENGINE_PS = "$ProgressPreference='SilentlyContinue'; $q=[char]34; $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:LIVEPID.Trim()) -EA SilentlyContinue; if(-not $p){exit 0}; $c=[string]$p.CommandLine; $m=[regex]::Match($c,'(?i)'+$q+'([^'+$q+']+)[\\\\/]branch\\.mjs'+$q); if(-not $m.Success){$m=[regex]::Match($c,'(?i)(?:^|\\s)(\\S+)[\\\\/]branch\\.mjs(?:\\s|$)')}; if($m.Success){$d=$m.Groups[1].Value; if((Test-Path -LiteralPath ($d+'\\branch.mjs') -PathType Leaf) -or (Test-Path -LiteralPath ($d+'/branch.mjs') -PathType Leaf)){Write-Output $d}}";

/** The branch command: a shim that reads the running engine (else the published one), the token and the live port. */
export function branchShim(o: { dataDir: string; engineDir: string; nodePath: string; gatewayPort: number }): string {
  return [
    "@echo off",
    "setlocal",
    `set "BRANCH_DATA=${o.dataDir}"`,
    `set "ENGINE=${o.engineDir}"`,
    `call :read_engine "%BRANCH_DATA%\\engine-current.txt"`,
    "if errorlevel 1 exit /b 1",
    // The engine actually running wins over a staged one that has not been applied yet.
    `call :read_engine "%BRANCH_DATA%\\engine-running.txt"`,
    "if errorlevel 1 exit /b 1",
    // A live gateway process wins when the pointer names a different engine that still has branch.mjs.
    "call :read_live_engine",
    `if not exist "%ENGINE%\\branch.mjs" (echo Branch Agent engine is unavailable. Open Branch Agent to restore its engine, then retry. >&2 & exit /b 1)`,
    `if exist "%ENGINE%\\branch.mjs\\" (echo Branch Agent engine is unavailable. Open Branch Agent to restore its engine, then retry. >&2 & exit /b 1)`,
    `if exist "%BRANCH_DATA%\\gateway-token" set /p BRANCH_GATEWAY_TOKEN=<"%BRANCH_DATA%\\gateway-token"`,
    `set "BRANCH_PROFILE=default"`,
    `set "BRANCH_HOME=%BRANCH_DATA%\\home"`,
    `set "BRANCH_STATE_DIR=%BRANCH_HOME%\\.branch"`,
    `set "BRANCH_CONFIG_PATH=%BRANCH_STATE_DIR%\\branch.json"`,
    `set "BRANCH_GATEWAY_PORT=${o.gatewayPort}"`,
    // An update can move the engine to another loopback port; the desktop records the live one here.
    `if exist "%BRANCH_DATA%\\gateway-port" set /p BRANCH_GATEWAY_PORT=<"%BRANCH_DATA%\\gateway-port"`,
    `"${o.nodePath}" "%ENGINE%\\branch.mjs" %*`,
    "exit /b %errorlevel%",
    ":read_engine",
    `if not exist "%~1" exit /b 0`,
    `type "%~1" >nul 2>nul`,
    `if errorlevel 1 (echo Cannot read Branch Agent engine pointer "%~1". Check its permissions and retry from a terminal with access. >&2 & exit /b 1)`,
    `set "CANDIDATE="`,
    `set /p CANDIDATE=<"%~1"`,
    "if not defined CANDIDATE exit /b 0",
    `if exist "%CANDIDATE%\\branch.mjs" if not exist "%CANDIDATE%\\branch.mjs\\" set "ENGINE=%CANDIDATE%"`,
    "exit /b 0",
    ":read_live_engine",
    `if not exist "%BRANCH_DATA%\\gateway.pid" exit /b 0`,
    `set "LIVEPID="`,
    `set /p LIVEPID=<"%BRANCH_DATA%\\gateway.pid"`,
    "if not defined LIVEPID exit /b 0",
    `set "LIVEENGINE="`,
    `for /f "usebackq delims=" %%A in (\`powershell.exe -NoProfile -NonInteractive -Command "${LIVE_ENGINE_PS}"\`) do set "LIVEENGINE=%%A"`,
    `if defined LIVEENGINE if exist "%LIVEENGINE%\\branch.mjs" if not exist "%LIVEENGINE%\\branch.mjs\\" set "ENGINE=%LIVEENGINE%"`,
    "exit /b 0",
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
    `engine=${q(slash(o.engineDir))}`,
    "read_engine() {",
    `  if [ -e "$1" ]; then`,
    `    candidate=$(head -n 1 "$1") || { printf 'Cannot read Branch Agent engine pointer %s. Check its permissions and retry from a terminal with access.\\n' "$1" >&2; return 1; }`,
    `    candidate=$(printf '%s' "$candidate" | tr -d '\\r' | tr '\\\\' '/')`,
    `    if [ -n "$candidate" ] && [ -f "$candidate/branch.mjs" ]; then engine=$candidate; fi`,
    "  fi",
    "  return 0",
    "}",
    "read_live_engine() {",
    `  [ -f "$data/gateway.pid" ] || return 0`,
    `  pid=$(head -n 1 "$data/gateway.pid" | tr -d '\\r')`,
    `  [ -n "$pid" ] || return 0`,
    "  live=",
    `  if [ -r "/proc/$pid/cmdline" ]; then`,
    `    live=$(tr '\\0' '\\n' < "/proc/$pid/cmdline" | while IFS= read -r arg; do`,
    `      case "$arg" in`,
    "        */branch.mjs)",
    "          dir=${arg%/branch.mjs}",
    `          if [ -f "$dir/branch.mjs" ]; then printf '%s\\n' "$dir"; break; fi`,
    "          ;;",
    "      esac",
    "    done)",
    "  fi",
    `  if [ -z "$live" ] && command -v powershell.exe >/dev/null 2>&1; then`,
    `    live=$(LIVEPID=$pid powershell.exe -NoProfile -NonInteractive -Command "${LIVE_ENGINE_PS}")`,
    "  fi",
    `  live=$(printf '%s' "$live" | tr -d '\\r' | tr '\\\\' '/')`,
    `  if [ -n "$live" ] && [ -f "$live/branch.mjs" ]; then engine=$live; fi`,
    "  return 0",
    "}",
    `read_engine "$data/engine-current.txt" || exit 1`,
    `read_engine "$data/engine-running.txt" || exit 1`,
    "read_live_engine || exit 1",
    `if [ ! -f "$engine/branch.mjs" ]; then printf '%s\\n' 'Branch Agent engine is unavailable. Open Branch Agent to restore its engine, then retry.' >&2; exit 1; fi`,
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
