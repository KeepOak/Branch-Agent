// The real OS calls behind the desktop controls (desktop-controls.ts): Electron's login items and power-save blocker,
// the user Path in HKCU\Environment (kept unexpanded, as REG_EXPAND_SZ, then broadcast), and the tray.
import { nativeImage, powerSaveBlocker, shell, type App, type Tray } from "electron";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DesktopConfig } from "./config";
import { activeEngineDir, defaultCliBinDir, ensureCliLauncher, isOwnedCliLauncher } from "./cli-launcher";
import { branchShim, branchShShim, editUserPath, pathHas, ringBitmap, type ControlDeps } from "./desktop-controls";

const run = promisify(execFile);
/** Passed by the login item, so a start with Windows opens quietly in the tray. */
export const START_IN_TRAY = "--start-in-tray";

async function powershell(command: string, env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, env: { ...process.env, ...env } });
  return stdout.trim();
}
/** The user Path as stored, with %VARS% unexpanded, so writing it back changes only Branch's own entry. */
const readUserPath = (): Promise<string> => powershell(
  "(Get-Item 'HKCU:\\Environment').GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)");
/** Writes REG_EXPAND_SZ, then sets and clears a throwaway user variable so open apps hear WM_SETTINGCHANGE. */
const writeUserPath = (value: string): Promise<string> => powershell([
  "Set-ItemProperty -Path 'HKCU:\\Environment' -Name Path -Value $env:BRANCH_NEW_PATH -Type ExpandString",
  "[Environment]::SetEnvironmentVariable('BRANCH_PATH_REFRESH','1','User')",
  "[Environment]::SetEnvironmentVariable('BRANCH_PATH_REFRESH',$null,'User')",
].join("; "), { BRANCH_NEW_PATH: value });

function readOwned(file: string): string | undefined {
  try {
    const contents = readFileSync(file, "utf8");
    return isOwnedCliLauncher(contents) ? contents : undefined;
  } catch { return undefined; }
}

export function desktopOs(app: App, cfg: DesktopConfig, tray: () => Tray | undefined, icon: string): ControlDeps {
  const login = { path: process.execPath, args: [START_IN_TRAY] };
  // Windows: branch.cmd for cmd and PowerShell, an extensionless sh script for Git Bash (as npm's cmd-shim writes both).
  // macOS/Linux: a stable ~/.local/bin/branch that reads the pointer in the data folder.
  const binDir = defaultCliBinDir(cfg.dataDir);
  const shim = join(binDir, process.platform === "win32" ? "branch.cmd" : "branch");
  const shShim = join(binDir, "branch");
  const active = () => ({
    dataDir: cfg.dataDir, nodePath: cfg.nodePath,
    engineDir: activeEngineDir(cfg.dataDir, cfg.engineDir), gatewayPort: cfg.gatewayPort,
  });
  const sync = (create: boolean): void => {
    const current = active();
    if (process.platform === "win32") {
      ensureCliLauncher({ launcherPath: shim, active: current, create, kind: "cmd", contents: branchShim(cfg) });
      ensureCliLauncher({ launcherPath: shShim, active: current, create, kind: "sh", contents: branchShShim(cfg) });
      return;
    }
    ensureCliLauncher({ launcherPath: shim, active: current, create, kind: "sh" });
  };
  return {
    settingsFile: join(cfg.dataDir, "desktop-settings.json"),
    login: {
      get: () => app.getLoginItemSettings(login).openAtLogin,
      set: (on) => app.setLoginItemSettings({ ...login, openAtLogin: on }),
    },
    awake: {
      start: () => powerSaveBlocker.start("prevent-app-suspension"),
      stop: (id) => { if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id); },
    },
    cli: {
      installed: async () => {
        if (!existsSync(shim) || !readOwned(shim)) return false;
        if (process.platform === "win32") return pathHas(await readUserPath(), binDir);
        return true;
      },
      install: async () => {
        mkdirSync(binDir, { recursive: true });
        sync(true);
        if (process.platform === "win32") await writeUserPath(editUserPath(await readUserPath(), binDir, true));
      },
      uninstall: async () => {
        if (process.platform === "win32") await writeUserPath(editUserPath(await readUserPath(), binDir, false));
        for (const file of process.platform === "win32" ? [shim, shShim] : [shim]) {
          if (readOwned(file)) rmSync(file, { force: true });
        }
      },
      refresh: () => { sync(false); },
    },
    tray: {
      usage: (left, on) => {
        const t = tray();
        if (!t) return;
        if (on && left !== null) {
          t.setImage(nativeImage.createFromBitmap(ringBitmap(left, 32), { width: 32, height: 32 }));
          t.setToolTip(`Branch Agent · ${Math.round(left)}% left`);
        } else {
          t.setImage(icon);
          t.setToolTip("Branch Agent is running");
        }
      },
    },
    openExternal: (url) => shell.openExternal(url),
  };
}
