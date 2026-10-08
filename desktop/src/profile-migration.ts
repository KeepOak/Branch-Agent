import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const MARKER = ".normal-profile-migrated.json";
const PENDING = ".normal-profile-migration-pending.json";
const BOOTSTRAP_FILES = new Set(["AGENTS.md", "SOUL.md", "USER.md", "IDENTITY.md"]);

function savePending(file: string, pending: Set<string>): void {
  const staged = `${file}.tmp`;
  writeFileSync(staged, JSON.stringify([...pending]) + "\n");
  renameSync(staged, file);
}

function generatedTemplate(file: string, templateDir?: string): string | undefined {
  if (!templateDir) return undefined;
  try {
    const content = readFileSync(join(templateDir, file), "utf8");
    return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").replace(/^\s+/, "");
  } catch { return undefined; } // No template evidence means no replacement.
}

function backupName(file: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = join(dirname(dirname(file)), ".migration-replaced");
  let directory = join(root, stamp);
  for (let suffix = 1; lstatSync(directory, { throwIfNoEntry: false }); suffix++) directory = join(root, `${stamp}-${suffix}`);
  const workspace = join(directory, "workspace");
  mkdirSync(workspace, { recursive: true });
  return join(workspace, basename(file));
}

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
  afterCopy?: () => void, relative = "", pending?: Set<string>, pendingFile?: string, templateDir?: string): void {
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
        mergeMissing(from, to, counts, log, afterCopy, join(relative, entry.name), pending, pendingFile, templateDir);
      } else {
        const eligible = relative === "workspace" && BOOTSTRAP_FILES.has(entry.name) && pending?.has(entry.name);
        if (existing.has(entry.name) || lstatSync(to, { throwIfNoEntry: false })) {
          if (!eligible || !lstatSync(to).isFile() || readFileSync(to, "utf8") !== generatedTemplate(entry.name, templateDir)) continue;
          // Consume the one replacement attempt before moving the untouched engine template aside.
          pending!.delete(entry.name);
          savePending(pendingFile!, pending!);
          renameSync(to, backupName(to));
        }
        copyFileSync(from, to, constants.COPYFILE_EXCL);
        if (eligible) {
          pending!.delete(entry.name);
          savePending(pendingFile!, pending!);
        }
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
export function prepareNormalProfile(home: string, afterCopy?: () => void, log?: (message: string) => void,
  templateDir?: string): { legacyDevMode: boolean; note?: string } {
  const normal = join(home, ".branch");
  const dev = join(home, ".branch-dev");
  const marker = join(normal, MARKER);
  const config = join(normal, "branch.json");
  const pendingFile = join(normal, PENDING);
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
      // Only files absent before the first merge may displace an untouched engine template later.
      // An older interrupted migration without this record is conservatively missing-only.
      let pending = new Set<string>();
      try {
        const saved: unknown = JSON.parse(readFileSync(pendingFile, "utf8"));
        if (Array.isArray(saved)) pending = new Set(saved.filter((name): name is string => typeof name === "string" && BOOTSTRAP_FILES.has(name)));
      } catch { /* Missing or corrupt progress is conservatively missing-only. */ }
      if (!resuming) {
        const archivedWorkspace = join(archive, "workspace");
        const normalWorkspace = join(normal, "workspace");
        if (existsSync(archivedWorkspace)) {
          const initial = existsSync(normalWorkspace) ? new Set(readdirSync(normalWorkspace)) : new Set<string>();
          for (const name of BOOTSTRAP_FILES) {
            const to = join(normalWorkspace, name);
            if (!(initial.has(name) || lstatSync(to, { throwIfNoEntry: false })) && existsSync(join(archivedWorkspace, name))) pending.add(name);
          }
        }
        savePending(pendingFile, pending);
      }
      // Keep the default profile launchable even if copying a workspace file fails mid-merge.
      writeDefaultConfig(config, normal);
      // No byte copy of the legacy profile first: the original is kept whole as the archive (a rename, nothing in it
      // is ever changed), and copying it synchronously in the app's main process took minutes for an owner's 1 GB
      // workspace and crashed the app on a dangling junction before the engine could start.
      // The desktop's --dev flag selected this workspace, but its config and live
      // databases already lived under .branch. Preserve any separate dev-profile
      // files without replacing the normal profile's newer files on the first pass.
      mergeMissing(archive, normal, counts, log, afterCopy, "", pending, pendingFile, templateDir);
    }
    writeDefaultConfig(config, normal);
    if (!existsSync(marker) && counts.failed === 0) {
      writeFileSync(marker, JSON.stringify({ archive }) + "\n", { flag: "wx" });
      if (existsSync(pendingFile)) unlinkSync(pendingFile);
    }
    if (started !== undefined) log?.(`Profile migration done: ${counts.copied} copied, ${counts.linksSkipped} links skipped, ${counts.failed} failed, ${Date.now() - started} ms`);
    return { legacyDevMode: false, note: counts.failed ? `${counts.failed} profile migration file(s) failed; will resume on next launch.` : undefined };
  } catch (error) {
    // Keep the archive and any copied files. The next launch resumes the incomplete merge.
    return { legacyDevMode: existsSync(dev), note: `Profile migration failed (${errorDetails(error, archive ?? normal)}); will resume on next launch.` };
  }
}
