import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, readlink, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { DesktopConfig } from "./config";

const runProcessList = promisify(execFile);

/** Adopt only old, fully published release layouts whose build identity matches the folder. */
async function backfillLegacyReleaseMarker(folder: string, name: string): Promise<boolean> {
  const match = /^release-(.+-build-([a-f0-9]{12}))-[A-Za-z0-9]{6}$/.exec(name);
  if (!match) return false;
  const folderInfo = await stat(folder);
  if (Date.now() - folderInfo.mtimeMs < 24 * 60 * 60 * 1000) return false;
  try {
    const manifest = JSON.parse(await readFile(join(folder, "engine", "dist", "build-info.json"), "utf8")) as { commit?: unknown; buildId?: unknown };
    if (typeof manifest.commit !== "string" || !/^[a-f0-9]{40}$/.test(manifest.commit)
      || manifest.commit.slice(0, 12) !== match[2]
      || typeof manifest.buildId !== "string" || !manifest.buildId.includes(manifest.commit.slice(0, 12))) return false;
    for (const file of ["engine/branch.mjs", "engine/package.json", "engine/dist/build-info.json"]) {
      if (!(await stat(join(folder, file))).isFile()) return false;
    }
    await import("node:fs/promises").then(fs => fs.writeFile(join(folder, ".release-complete"), ""));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

async function runningProcessCommands(): Promise<string> {
  if (process.platform === "linux") {
    const commands: string[] = [];
    for (const entry of await readdir("/proc", { withFileTypes: true })) {
      if (!/^\d+$/.test(entry.name)) continue;
      try {
        commands.push(await readFile(`/proc/${entry.name}/cmdline`, "utf8"));
        commands.push(await readlink(`/proc/${entry.name}/cwd`));
      }
      catch (error) { if (!["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    }
    return commands.join("\n");
  }
  const command = process.platform === "win32" ? "powershell.exe" : "ps";
  const args = process.platform === "win32"
    ? ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Select-Object -ExpandProperty CommandLine"]
    : ["-axo", "command="];
  return (await runProcessList(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout;
}

async function readOrEmpty(file: string): Promise<string> {
  try { return (await readFile(file, "utf8")).trim(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/**
 * Prune old component update copies, keeping only current and previous builds.
 * Never deletes the active (running) or staged build. Locked files are skipped without failing.
 */
export async function pruneOldReleases(cfg: DesktopConfig, current: string, previous: string, pending: string | undefined, reportFailure?: (error: unknown) => void): Promise<void> {
  const updates = join(cfg.dataDir, "updates");
  if (!existsSync(updates)) return;
  
  const running = await readOrEmpty(join(cfg.dataDir, "engine-running.txt"));
  const updatesReal = await realpath(updates);
  const retained = new Set<string>();
  
  for (const engine of [current, previous, running]) {
    if (!engine || basename(engine) !== "engine") continue;
    try {
      const folder = await realpath(dirname(engine));
      if (dirname(folder) === updatesReal) retained.add(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  
  if (pending) {
    try {
      const folder = await realpath(dirname(pending));
      if (dirname(folder) === updatesReal) retained.add(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  
  let commands: string;
  try { commands = await runningProcessCommands(); }
  catch (error) { reportFailure?.(error); return; }
  
  for (const entry of await readdir(updates, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(".trash-release-")) {
      try { await rm(join(updates, entry.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
      catch (error) { reportFailure?.(new Error(`Could not finish pruning ${entry.name}: ${String(error)}`)); }
      continue;
    }
    
    if (!entry.isDirectory() || !/^release-[\w.-]+-[A-Za-z0-9]{6}$/.test(entry.name)
      || /(?:^|[-.])(staging|pending)(?:[-.]|$)/i.test(entry.name)) continue;
    
    const folder = resolve(updates, entry.name);
    const folderReal = await realpath(folder);
    
    if (!existsSync(join(folder, ".release-complete"))) {
      try { if (!await backfillLegacyReleaseMarker(folder, entry.name)) continue; }
      catch (error) { reportFailure?.(new Error(`Could not verify ${entry.name}: ${String(error)}`)); continue; }
    }
    
    const separator = process.platform === "win32" ? "\\" : "/";
    const commandsLower = commands.toLowerCase();
    if (retained.has(folderReal) || [folder, folderReal].some(path => commandsLower.includes(`${path}${separator}`.toLowerCase()))) continue;
    
    const trash = join(updates, `.trash-${entry.name}-${process.pid}-${Math.random().toString(36).slice(2)}`);
    try {
      await rename(folder, trash);
      await rm(trash, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (error) { 
      reportFailure?.(new Error(`Could not prune ${entry.name}: ${String(error)}`)); 
    }
  }
}

/**
 * Check if there's enough free disk space for a download.
 * Returns { enough: true } if space is available, or { enough: false, message } with a user-facing error message.
 */
export async function checkDiskSpace(targetPath: string, requiredBytes: number): Promise<{ enough: boolean; message?: string }> {
  const marginBytes = 500 * 1024 * 1024;
  const neededBytes = requiredBytes + marginBytes;
  
  try {
    let availableBytes: number;
    
    if (process.platform === "win32") {
      const drive = targetPath.match(/^([A-Z]:|\\\\)/i)?.[0] ?? "C:";
      const { stdout } = await runProcessList("powershell.exe", 
        ["-NoProfile", "-NonInteractive", "-Command", 
         `(Get-PSDrive -Name ${drive.replace(":", "")} -ErrorAction Stop).Free`],
        { encoding: "utf8", windowsHide: true });
      availableBytes = Number(stdout.trim());
    } else {
      const { stdout } = await runProcessList("df", ["-k", targetPath], { encoding: "utf8" });
      const lines = stdout.trim().split("\n");
      const lastLine = lines[lines.length - 1];
      const match = /\s+(\d+)\s+\d+%/.exec(lastLine);
      if (!match) throw new Error("Could not parse df output");
      availableBytes = Number(match[1]) * 1024;
    }
    
    if (!Number.isFinite(availableBytes) || availableBytes < 0) {
      throw new Error("Invalid disk space value");
    }
    
    if (availableBytes < neededBytes) {
      const neededGB = (neededBytes / (1024 ** 3)).toFixed(1);
      return { 
        enough: false, 
        message: `Not enough disk space to download the update. Branch needs about ${neededGB} GB free.`
      };
    }
    
    return { enough: true };
  } catch (error) {
    return { 
      enough: false, 
      message: `Could not check disk space: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
