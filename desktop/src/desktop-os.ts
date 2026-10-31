// The real OS calls behind the desktop controls (desktop-controls.ts): Electron's login items,
// the user Path in HKCU\Environment (kept unexpanded, as REG_EXPAND_SZ, then broadcast), and the tray.
import { nativeImage, shell, type App, type Tray } from "electron";
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DesktopConfig } from "./config";
import { appRemoval, branchPosixShim, branchShim, branchShShim, editUserPath, pathHas, posixBranchCommand, ringBitmap, type AppRemoval, type ControlDeps } from "./desktop-controls";
import { menuBarIcon } from "./resident-window";

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

/** Windows: the uninstaller can't remove files the app still holds, so a hidden PowerShell waits for this process to
 *  end, then runs it silently. It deletes only the install folders ([UninstallDelete] in release-installers.mjs). */
export const WINDOWS_UNINSTALL_SCRIPT = "Wait-Process -Id $env:BRANCH_APP_PID -ErrorAction SilentlyContinue; Start-Sleep -Seconds 3; "
  + "Start-Process -FilePath $env:BRANCH_UNINSTALLER -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART'";

async function launchRemoval(removal: Exclude<AppRemoval, { kind: "none" }>): Promise<void> {
  if (removal.kind === "windows") {
    spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", WINDOWS_UNINSTALL_SCRIPT], {
      detached: true, stdio: "ignore", windowsHide: true,
      env: { ...process.env, BRANCH_APP_PID: String(process.pid), BRANCH_UNINSTALLER: removal.uninstaller },
    }).unref();
  } else if (removal.kind === "mac") {
    // To the Trash, so a change of mind is one drag away; a running bundle can be moved.
    for (const bundle of removal.bundles) await shell.trashItem(bundle);
  } else {
    // The AppImage runs from a mount, so its file can go while it runs.
    for (const file of removal.files) rmSync(file, { force: true });
  }
}

export function desktopOs(app: App, cfg: DesktopConfig, tray: () => Tray | undefined, icon: string,
  remove?: { service?: () => Promise<void>; quit(): void }): ControlDeps {
  const login = { path: process.execPath, args: [START_IN_TRAY] };
  // branch.cmd for cmd and PowerShell, an extensionless sh script for Git Bash (as npm's cmd-shim writes both).
  const binDir = join(cfg.dataDir, "bin"), shim = join(binDir, "branch.cmd"), shShim = join(binDir, "branch");
  return {
    settingsFile: join(cfg.dataDir, "desktop-settings.json"),
    login: {
      get: () => app.getLoginItemSettings(login).openAtLogin,
      set: (on) => app.setLoginItemSettings({ ...login, openAtLogin: on }),
    },
    // macOS and Linux: ~/.local/bin/branch, where the earlier installer put its command (refresh repairs that one).
    cli: process.platform !== "win32" ? posixBranchCommand(join(homedir(), ".local", "bin", "branch"), () => branchPosixShim(cfg)) : {
      installed: async () => existsSync(shim) && pathHas(await readUserPath(), binDir),
      install: async () => {
        mkdirSync(binDir, { recursive: true });
        writeFileSync(shim, branchShim(cfg));
        writeFileSync(shShim, branchShShim(cfg));
        await writeUserPath(editUserPath(await readUserPath(), binDir, true));
      },
      uninstall: async () => {
        await writeUserPath(editUserPath(await readUserPath(), binDir, false));
        rmSync(shim, { force: true });
        rmSync(shShim, { force: true });
      },
      refresh: () => {
        if (existsSync(shim)) writeFileSync(shim, branchShim(cfg));
        if (existsSync(shShim)) writeFileSync(shShim, branchShShim(cfg));
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
          t.setImage(menuBarIcon(icon, process.platform));
          t.setToolTip("Branch Agent is running");
        }
      },
    },
    openExternal: (url) => shell.openExternal(url),
    ...(remove ? { removeApp: {
      dataDir: cfg.dataDir,
      removal: () => appRemoval({ platform: process.platform, execPath: process.execPath, packaged: app.isPackaged,
        localAppData: process.env.LOCALAPPDATA, appImage: process.env.APPIMAGE, exists: existsSync }),
      ...(remove.service ? { service: remove.service } : {}),
      launch: launchRemoval,
      quit: remove.quit,
    } } : {}),
  };
}
