import { constants, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

export interface TreeCopyCounts { copied: number; linksSkipped: number }

function errorDetails(error: unknown, pathname: string): string {
  const failure = error as NodeJS.ErrnoException;
  return `code=${failure.code ?? "UNKNOWN"} path=${failure.path ?? pathname} message=${failure.message ?? String(error)}`;
}

/**
 * lstat the path. Symbolic links and junctions (Windows) are skipped and logged, never followed.
 * A broken or unreadable entry is also skipped so a native follow cannot kill the process.
 */
function lstatIfRegular(pathname: string, counts: TreeCopyCounts, log?: (message: string) => void): ReturnType<typeof lstatSync> | undefined {
  try {
    const stat = lstatSync(pathname);
    if (!stat.isSymbolicLink()) return stat;
  } catch {
    // Missing, unreadable, or a broken directory link: never follow it.
  }
  counts.linksSkipped++;
  log?.(`Profile migration skipped link ${pathname}`);
  return undefined;
}

function copyRegularFile(from: string, to: string): void {
  try { linkSync(from, to); }
  catch { copyFileSync(from, to, constants.COPYFILE_EXCL); }
}

/**
 * Recursive copy that never follows links. Each entry is classified with lstat; nothing in the
 * walk throws to the caller (a broken junction used to kill the process inside fs.cpSync).
 */
export function copyTreeSkippingLinks(
  source: string,
  destination: string,
  log?: (message: string) => void,
  counts: TreeCopyCounts = { copied: 0, linksSkipped: 0 },
): TreeCopyCounts {
  try { mkdirSync(destination, { recursive: true }); }
  catch (error) {
    log?.(`Profile migration copy failed (${errorDetails(error, destination)})`);
    return counts;
  }
  let names: string[];
  try { names = readdirSync(source); }
  catch (error) {
    log?.(`Profile migration copy failed (${errorDetails(error, source)})`);
    return counts;
  }
  for (const name of names) {
    const from = join(source, name);
    const to = join(destination, name);
    try {
      const stat = lstatIfRegular(from, counts, log);
      if (!stat) continue;
      if (stat.isDirectory()) copyTreeSkippingLinks(from, to, log, counts);
      else if (stat.isFile()) {
        copyRegularFile(from, to);
        counts.copied++;
      }
    } catch (error) {
      log?.(`Profile migration copy failed (${errorDetails(error, from)})`);
    }
  }
  return counts;
}

function mergeMissing(
  source: string,
  destination: string,
  counts: TreeCopyCounts,
  created: string[],
  afterCopy?: () => void,
  root = false,
  log?: (message: string) => void,
): void {
  const existing = new Set(readdirSync(destination));
  let names: string[];
  try { names = readdirSync(source); }
  catch (error) {
    log?.(`Profile migration copy failed (${errorDetails(error, source)})`);
    return;
  }
  for (const name of names) {
    const from = join(source, name);
    const to = join(destination, name);
    if (name === "branch.json" && root) continue;
    const stat = lstatIfRegular(from, counts, log);
    if (!stat) continue;
    if (stat.isFile() && /-(?:wal|shm)$/.test(name) && existing.has(name.replace(/-(?:wal|shm)$/, ""))) continue;
    if (!stat.isFile() && !stat.isDirectory()) continue; // Sockets and FIFOs are not profile data.
    if (stat.isDirectory()) {
      try {
        if (!existsSync(to)) {
          mkdirSync(to);
          created.push(to);
        } else if (!lstatSync(to).isDirectory()) {
          continue; // Keep both versions: the old one remains in the migrated archive.
        }
      } catch (error) {
        log?.(`Profile migration copy failed (${errorDetails(error, from)})`);
        continue;
      }
      mergeMissing(from, to, counts, created, afterCopy, false, log);
    } else if (!existsSync(to)) {
      try {
        copyFileSync(from, to, constants.COPYFILE_EXCL); // Never overwrite the normal profile.
        created.push(to);
        counts.copied++;
      } catch (error) {
        log?.(`Profile migration copy failed (${errorDetails(error, from)})`);
        continue;
      }
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

function writeDefaultConfig(config: string, normal: string): boolean {
  if (existsSync(config)) return false;
  writeFileSync(config, JSON.stringify({
    gateway: { mode: "local", bind: "loopback" },
    agents: { ownership: "explicit", defaults: { workspace: join(normal, "workspace") } },
  }, null, 2) + "\n", { flag: "wx" });
  return true;
}

function restoreLegacyLayout(dev: string, archive: string | undefined, backup: string | undefined, created: string[]): void {
  try {
    if (archive && existsSync(archive) && !existsSync(dev)) renameWithRetry(archive, dev);
  } catch { /* keep going: the original tree may already be back */ }
  for (const pathname of created.reverse()) {
    try { rmSync(pathname, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  if (backup) {
    try { rmSync(backup, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/** Move only missing legacy-profile files into the normal profile before the Gateway opens it. */
export function prepareNormalProfile(home: string, afterCopy?: () => void, log?: (message: string) => void): { legacyDevMode: boolean; note?: string } {
  const normal = join(home, ".branch");
  const dev = join(home, ".branch-dev");
  const marker = join(normal, MARKER);
  const config = join(normal, "branch.json");
  let archive: string | undefined;
  let backup: string | undefined;
  let started: number | undefined;
  const counts: TreeCopyCounts = { copied: 0, linksSkipped: 0 };
  const created: string[] = [];
  try {
    const pending = existsSync(home) ? readdirSync(home).filter((name) => name.startsWith(".branch-dev.migrated-")).sort() : [];
    if (!existsSync(normal)) {
      mkdirSync(normal, { recursive: true });
      created.push(normal);
    } else if (!lstatSync(normal).isDirectory()) {
      archive = pending.length ? join(home, pending[pending.length - 1]!) : undefined;
      throw new Error("Normal profile root is not a directory");
    }
    if (!existsSync(marker)) {
      if (pending.length) archive = join(home, pending[pending.length - 1]!);
      else if (existsSync(dev)) {
        if (!lstatSync(dev).isDirectory()) throw new Error("Legacy profile root is not a directory");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        archive = join(home, `.branch-dev.migrated-${stamp}`);
        backup = join(home, `.migration-backup-${stamp}`);
      }
    }
    if (archive) {
      log?.("Profile migration start");
      started = Date.now();
      const source = existsSync(dev) ? dev : archive;
      if (backup && existsSync(dev) && !existsSync(backup)) {
        log?.("Profile migration backup");
        mkdirSync(backup);
        copyTreeSkippingLinks(dev, join(backup, ".branch-dev"), log);
      }
      log?.("Profile migration copy");
      // Keep the default profile launchable even if copying a workspace file fails mid-merge.
      if (writeDefaultConfig(config, normal)) created.push(config);
      // The desktop's --dev flag selected this workspace, but its config and live
      // databases already lived under .branch. Preserve any separate dev-profile
      // files without replacing the normal profile's newer files.
      // Links are classified with lstat (Windows junctions included) and never followed:
      // fs.cpSync on Node 24 died natively on a dangling junction before this catch could run.
      mergeMissing(source, normal, counts, created, afterCopy, true, log);
      if (existsSync(dev) && archive && !existsSync(archive)) renameWithRetry(dev, archive);
      if (archive && !lstatSync(archive).isDirectory()) throw new Error("Legacy profile archive is not a directory");
    }
    if (writeDefaultConfig(config, normal)) created.push(config);
    if (!existsSync(marker)) {
      writeFileSync(marker, JSON.stringify({ archive, backup }) + "\n", { flag: "wx" });
      created.push(marker);
    }
    if (started !== undefined) log?.(`Profile migration done: ${counts.copied} copied, ${counts.linksSkipped} links skipped, ${Date.now() - started} ms`);
    return { legacyDevMode: false };
  } catch (error) {
    log?.(`Profile migration failed (${errorDetails(error, archive ?? backup ?? normal)})`);
    restoreLegacyLayout(dev, archive, backup, created);
    return { legacyDevMode: existsSync(dev), note: `Profile migration failed (${errorDetails(error, archive ?? backup ?? normal)}); retaining the previous gateway layout.` };
  }
}
