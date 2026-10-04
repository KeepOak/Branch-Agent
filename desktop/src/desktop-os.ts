// The real OS calls behind the desktop controls (desktop-controls.ts): Electron's login items and power-save blocker,
// the user Path through PowerShell (as [Environment]::SetEnvironmentVariable, which broadcasts the change), and the tray.
import { nativeImage, powerSaveBlocker, shell, type App, type Tray } from "electron";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DesktopConfig } from "./config";
import { branchShim, editUserPath, pathHas, ringBitmap, type ControlDeps } from "./desktop-controls";

const run = promisify(execFile);
/** Passed by the login item, so a start with Windows opens quietly in the tray. */
export const START_IN_TRAY = "--start-in-tray";

async function powershell(command: string, env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, env: { ...process.env, ...env } });
  return stdout.trim();
}
const readUserPath = (): Promise<string> => powershell("[Environment]::GetEnvironmentVariable('Path','User')");
const writeUserPath = (value: string): Promise<string> =>
  powershell("[Environment]::SetEnvironmentVariable('Path',$env:BRANCH_NEW_PATH,'User')", { BRANCH_NEW_PATH: value });

export function desktopOs(app: App, cfg: DesktopConfig, tray: () => Tray | undefined, icon: string): ControlDeps {
  const login = { path: process.execPath, args: [START_IN_TRAY] };
  const binDir = join(cfg.dataDir, "bin"), shim = join(binDir, "branch.cmd");
  const windowsOnly = (): void => { if (process.platform !== "win32") throw new Error("The branch command is added by the Windows app"); };
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
      installed: async () => process.platform === "win32" && existsSync(shim) && pathHas(await readUserPath(), binDir),
      install: async () => {
        windowsOnly();
        mkdirSync(binDir, { recursive: true });
        writeFileSync(shim, branchShim(cfg));
        await writeUserPath(editUserPath(await readUserPath(), binDir, true));
      },
      uninstall: async () => {
        windowsOnly();
        await writeUserPath(editUserPath(await readUserPath(), binDir, false));
        rmSync(shim, { force: true });
      },
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
