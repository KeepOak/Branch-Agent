import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER = ".normal-profile-migrated.json";

interface MigrationCounts { copied: number; linksSkipped: number }

function mergeMissing(source: string, destination: string, counts: MigrationCounts, afterCopy?: () => void, root = false): void {
  const existing = new Set(readdirSync(destination));
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.name === "branch.json" && root) continue;
    if (entry.isFile() && /-(?:wal|shm)$/.test(entry.name) && existing.has(entry.name.replace(/-(?:wal|shm)$/, ""))) continue;
    // Links (on Windows also junctions, such as plugin-skills entries pointing into an engine release that may be gone)
    // are never followed or copied: they point outside the profile, the engine recreates its own, and the original
    // stays in the migrated archive. Following one is how a dangling junction killed the app (fs.cpSync, Node 24).
    if (entry.isSymbolicLink()) { counts.linksSkipped++; continue; }
    if (!entry.isFile() && !entry.isDirectory()) continue; // Sockets and FIFOs are not profile data.
    if (entry.isDirectory()) {
      if (!existsSync(to)) {
        mkdirSync(to);
      } else if (!lstatSync(to).isDirectory()) {
        continue; // Keep both versions: the old one remains in the migrated archive.
      }
      mergeMissing(from, to, counts, afterCopy);
    } else if (!existsSync(to)) {
      copyFileSync(from, to, constants.COPYFILE_EXCL); // Never overwrite the normal profile.
      counts.copied++;
      afterCopy?.();
    }
  }
}

/** A short retry covers transient Windows locks held by Defender, Explorer, or the indexer. */
export function renameWithRetry(from: string, to: string, rename: typeof renameSync = renameSync): void {
  for (let attempt = 0; ; attempt++) {
    try { rename(from, to); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 3 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
}

function errorDetails(error: unknown, pathname: string): string {
  const failure = error as NodeJS.ErrnoException;
  return `code=${failure.code ?? "UNKNOWN"} path=${failure.path ?? pathname} message=${failure.message ?? String(error)}`;
}

function writeDefaultConfig(config: string, normal: string): void {
  if (existsSync(config)) return;
  writeFileSync(config, JSON.stringify({
    gateway: { mode: "local", bind: "loopback" },
    agents: { ownership: "explicit", defaults: { workspace: join(normal, "workspace") } },
  }, null, 2) + "\n", { flag: "wx" });
}

/** Move only missing legacy-profile files into the normal profile before the Gateway opens it. */
export function prepareNormalProfile(home: string, afterCopy?: () => void, log?: (message: string) => void): { legacyDevMode: boolean; note?: string } {
  const normal = join(home, ".branch");
  const dev = join(home, ".branch-dev");
  const marker = join(normal, MARKER);
  const config = join(normal, "branch.json");
  let archive: string | undefined;
  let started: number | undefined;
  const counts: MigrationCounts = { copied: 0, linksSkipped: 0 };
  try {
    if (!existsSync(normal)) {
      mkdirSync(normal, { recursive: true });
    } else if (!lstatSync(normal).isDirectory()) {
      throw new Error("Normal profile root is not a directory");
    }
    if (!existsSync(marker)) {
      const pending = readdirSync(home).filter((name) => name.startsWith(".branch-dev.migrated-")).sort();
      if (pending.length) archive = join(home, pending[pending.length - 1]!);
      else if (existsSync(dev)) {
        if (!lstatSync(dev).isDirectory()) throw new Error("Legacy profile root is not a directory");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        archive = join(home, `.branch-dev.migrated-${stamp}`);
      }
    }
    if (archive) {
      log?.("Profile migration start");
      started = Date.now();
      if (existsSync(dev) && !existsSync(archive)) renameWithRetry(dev, archive);
      if (!lstatSync(archive).isDirectory()) throw new Error("Legacy profile archive is not a directory");
      // Keep the default profile launchable even if copying a workspace file fails mid-merge.
      writeDefaultConfig(config, normal);
      // No byte copy of the legacy profile first: the original is kept whole as the archive (a rename, nothing in it
      // is ever changed), and copying it synchronously in the app's main process took minutes for an owner's 1 GB
      // workspace and crashed the app on a dangling junction before the engine could start.
      // The desktop's --dev flag selected this workspace, but its config and live
      // databases already lived under .branch. Preserve any separate dev-profile
      // files without replacing the normal profile's newer files.
      mergeMissing(archive, normal, counts, afterCopy, true);
    }
    writeDefaultConfig(config, normal);
    if (!existsSync(marker)) {
      writeFileSync(marker, JSON.stringify({ archive }) + "\n", { flag: "wx" });
    }
    if (started !== undefined) log?.(`Profile migration done: ${counts.copied} copied, ${counts.linksSkipped} links skipped, ${Date.now() - started} ms`);
    return { legacyDevMode: false };
  } catch (error) {
    // Keep the archive and any copied files. The next launch resumes by copying only missing entries.
    return { legacyDevMode: existsSync(dev), note: `Profile migration failed (${errorDetails(error, archive ?? normal)}); will resume on next launch.` };
  }
}
