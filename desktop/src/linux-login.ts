// Electron's login-item API is macOS/Windows only. Linux uses the XDG autostart spec.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A permanent sleep mask is an explicit always-on policy, unlike merely having no battery. */
function alwaysOn(): boolean {
  try {
    return execFileSync("systemctl", ["show", "sleep.target", "--property=UnitFileState", "--value"],
      { encoding: "utf8", timeout: 1000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim() === "masked";
  } catch { return false; } // No systemd, timeout or unknown: preserve the ordinary off default.
}

/** Quote the Exec argument, then escape the desktop-entry string layer (not shell syntax). */
function execArgument(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Invalid login executable");
  return `"${value.replace(/%/g, "%%").replace(/["`$\\]/g, "\\$&").replace(/\\/g, "\\\\")}"`;
}

export function linuxLogin(configDir: string, executable: string, packaged: boolean): { get(): boolean; set(on: boolean): void } {
  const file = join(configDir, "autostart", "ai.branch.app.desktop");
  // The portable package's launcher prepares the Chromium sandbox. Never bypass it with the .bin.
  const launcher = join(dirname(executable), "branch-agent");
  const command = `${execArgument(existsSync(launcher) ? launcher : executable)} --start-in-tray`;
  const read = (): string | undefined => {
    try { return readFileSync(file, "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };
  const enabled = (entry: string | undefined): boolean => entry !== undefined
    && /^Type=Application\s*$/m.test(entry) && /^Exec=\S.+$/m.test(entry)
    && !/^(?:Hidden=true|X-GNOME-Autostart-enabled=false)\s*$/m.test(entry);
  const set = (on: boolean): void => {
    mkdirSync(dirname(file), { recursive: true });
    // Keep a disabled entry instead of deleting it: an explicit opt-out survives the next launch.
    writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Branch Agent\nExec=${command}\nTerminal=false\nHidden=${!on}\nX-Branch-Autostart=true\n`, { mode: 0o600 });
  };
  if (packaged) {
    try {
      const entry = read();
      if (entry === undefined && alwaysOn()) set(true);
      else if (entry !== undefined && enabled(entry) && /^X-Branch-Autostart=true\s*$/m.test(entry)) {
        // Runtime updates can move the executable. Preserve all other keys, including external opt-outs.
        const refreshed = entry.replace(/^Exec=.*$/m, () => `Exec=${command}`);
        if (refreshed !== entry) writeFileSync(file, refreshed);
      }
    } catch { console.warn("Could not initialize Start with Linux; change it in Settings to retry."); }
  }
  return { get: () => enabled(read()), set };
}
