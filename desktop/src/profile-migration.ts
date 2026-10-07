import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER = ".normal-profile-migrated.json";

/** A standby may inspect the established profile, but must not run migrations beside its owner. */
export function readPreparedNormalProfile(home: string): { legacyDevMode: false; note?: string } {
  const normal = join(home, ".branch");
  if (!existsSync(join(normal, MARKER)) || !existsSync(join(normal, "branch.json"))) {
    throw new Error("The profile is not ready for read-only standby preparation");
  }
  return { legacyDevMode: false };
}

interface MigrationCounts { copied: number; linksSkipped: number; failed: number }

function mergeMissing(source: string, destination: string, counts: MigrationCounts, log?: (message: string) => void,
  afterCopy?: () => void, relative = "", resuming = false): void {
  const existing = new Set(readdirSync(destination));
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.name === "branch.json" && !relative) continue;
    if (entry.isFile() && /-(?:wal|shm)$/.test(entry.name) && existing.has(entry.name.replace(/-(?:wal|shm)$/, ""))) continue;
    // Links (on Windows also junctions, such as plugin-skills entries pointing into an engine release that may be gone)
    // are never followed or copied: they point outside the profile, the engine recreates its own, and the original
    // stays in the migrated archive. Following one is how a dangling junction killed the app (fs.cpSync, Node 24).
    if (entry.isSymbolicLink()) { counts.linksSkipped++; continue; }
    if (!entry.isFile() && !entry.isDirectory()) continue; // Sockets and FIFOs are not profile data.
    try {
      if (entry.isDirectory()) {
        if (!existsSync(to)) {
          mkdirSync(to);
        } else if (!lstatSync(to).isDirectory()) {
          continue; // Keep both versions: the old one remains in the migrated archive.
        }
        mergeMissing(from, to, counts, log, afterCopy, join(relative, entry.name), resuming);
      } else {
        const preferArchive = resuming && relative === "workspace" && /^(?:AGENTS|SOUL|USER|IDENTITY)\.md$/.test(entry.name);
        if (existsSync(to) && !preferArchive) continue;
        // A failed first launch may have let the engine seed these templates before the next migration attempt.
        copyFileSync(from, to, preferArchive ? 0 : constants.COPYFILE_EXCL);
        counts.copied++;
        afterCopy?.();
      }
    } catch (error) {
      counts.failed++;
      log?.(`Profile migration copy failed (${errorDetails(error, from)})`);
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
  const counts: MigrationCounts = { copied: 0, linksSkipped: 0, failed: 0 };
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
      const resuming = existsSync(archive);
      if (existsSync(dev) && !existsSync(archive)) renameWithRetry(dev, archive);
      if (!lstatSync(archive).isDirectory()) throw new Error("Legacy profile archive is not a directory");
      // Keep the default profile launchable even if copying a workspace file fails mid-merge.
      writeDefaultConfig(config, normal);
      // No byte copy of the legacy profile first: the original is kept whole as the archive (a rename, nothing in it
      // is ever changed), and copying it synchronously in the app's main process took minutes for an owner's 1 GB
      // workspace and crashed the app on a dangling junction before the engine could start.
      // The desktop's --dev flag selected this workspace, but its config and live
      // databases already lived under .branch. Preserve any separate dev-profile
      // files without replacing the normal profile's newer files on the first pass.
      mergeMissing(archive, normal, counts, log, afterCopy, "", resuming);
    }
    writeDefaultConfig(config, normal);
    if (!existsSync(marker) && counts.failed === 0) {
      writeFileSync(marker, JSON.stringify({ archive }) + "\n", { flag: "wx" });
    }
    if (started !== undefined) log?.(`Profile migration done: ${counts.copied} copied, ${counts.linksSkipped} links skipped, ${counts.failed} failed, ${Date.now() - started} ms`);
    return { legacyDevMode: false, note: counts.failed ? `${counts.failed} profile migration file(s) failed; will resume on next launch.` : undefined };
  } catch (error) {
    // Keep the archive and any copied files. The next launch resumes the incomplete merge.
    return { legacyDevMode: existsSync(dev), note: `Profile migration failed (${errorDetails(error, archive ?? normal)}); will resume on next launch.` };
  }
}
