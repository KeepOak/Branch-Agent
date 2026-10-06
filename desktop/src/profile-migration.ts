import { constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER = ".normal-profile-migrated.json";

function mergeMissing(source: string, destination: string, created: string[], afterCopy?: () => void): void {
  const existing = new Set(readdirSync(destination));
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.name === "branch.json" && source.endsWith(".branch-dev")) continue;
    if (entry.isFile() && /-(?:wal|shm)$/.test(entry.name) && existing.has(entry.name.replace(/-(?:wal|shm)$/, ""))) continue;
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      throw new Error("Profile migration cannot copy a non-regular entry");
    }
    if (entry.isDirectory()) {
      if (!existsSync(to)) {
        mkdirSync(to);
        created.push(to);
      } else if (!lstatSync(to).isDirectory()) {
        continue; // Keep both versions: the old one remains in the migrated archive.
      }
      mergeMissing(from, to, created, afterCopy);
    } else if (!existsSync(to)) {
      copyFileSync(from, to, constants.COPYFILE_EXCL); // Never overwrite the normal profile.
      created.push(to);
      afterCopy?.();
    }
  }
}

/** Move only missing legacy-profile files into the normal profile before the Gateway opens it. */
export function prepareNormalProfile(home: string, afterCopy?: () => void): { legacyDevMode: boolean; note?: string } {
  const normal = join(home, ".branch");
  const dev = join(home, ".branch-dev");
  const marker = join(normal, MARKER);
  const config = join(normal, "branch.json");
  const created: string[] = [];
  let backup: string | undefined;
  let backupCreated = false;
  let archive: string | undefined;
  try {
    if (!existsSync(normal)) {
      mkdirSync(normal, { recursive: true });
      created.push(normal);
    } else if (!lstatSync(normal).isDirectory()) {
      throw new Error("Normal profile root is not a directory");
    }
    if (!existsSync(marker) && existsSync(dev)) {
      if (!lstatSync(dev).isDirectory()) throw new Error("Legacy profile root is not a directory");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backup = join(home, `.migration-backup-${stamp}`);
      archive = join(home, `.branch-dev.migrated-${stamp}`);
      if (existsSync(backup) || existsSync(archive)) throw new Error("Profile migration destination already exists");
      mkdirSync(backup);
      backupCreated = true;
      cpSync(dev, join(backup, ".branch-dev"), { recursive: true, errorOnExist: true, force: false });
      // The desktop's --dev flag selected this workspace, but its config and live
      // databases already lived under .branch. Preserve any separate dev-profile
      // files without replacing the normal profile's newer files.
      mergeMissing(dev, normal, created, afterCopy);
      renameSync(dev, archive);
    }
    if (!existsSync(config)) {
      writeFileSync(config, JSON.stringify({
        gateway: { mode: "local", bind: "loopback" },
        agents: { ownership: "explicit", defaults: { workspace: join(normal, "workspace") } },
      }, null, 2) + "\n", { flag: "wx" });
      created.push(config);
    }
    if (!existsSync(marker)) {
      writeFileSync(marker, JSON.stringify({ archive, backup }) + "\n", { flag: "wx" });
      created.push(marker);
    }
    return { legacyDevMode: false };
  } catch {
    if (archive && existsSync(archive) && !existsSync(dev)) renameSync(archive, dev);
    for (const pathname of created.reverse()) rmSync(pathname, { recursive: true, force: true });
    if (backupCreated && backup) rmSync(backup, { recursive: true, force: true });
    return { legacyDevMode: true, note: "Profile migration failed; retaining the previous gateway layout." };
  }
}
