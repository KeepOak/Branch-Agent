import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER = ".normal-profile-migrated.json";

function mergeMissing(source: string, destination: string, created: string[], afterCopy?: () => void): void {
  const existing = new Set(readdirSync(destination));
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.name === "branch.json" && source.endsWith(".branch-dev")) continue;
    if (entry.isFile() && /-(?:wal|shm)$/.test(entry.name) && existing.has(entry.name.replace(/-(?:wal|shm)$/, ""))) continue;
    // Links (on Windows also junctions, such as plugin-skills entries pointing into an engine release that may be gone)
    // are never followed or copied: they point outside the profile, the engine recreates its own, and the original
    // stays in the migrated archive. Following one is how a dangling junction killed the app (fs.cpSync, Node 24).
    if (entry.isSymbolicLink()) continue;
    if (!entry.isFile() && !entry.isDirectory()) {
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
      archive = join(home, `.branch-dev.migrated-${stamp}`);
      if (existsSync(archive)) throw new Error("Profile migration destination already exists");
      // No byte copy of the legacy profile first: the original is kept whole as the archive (a rename, nothing in it
      // is ever changed), and copying it synchronously in the app's main process took minutes for an owner's 1 GB
      // workspace and crashed the app on a dangling junction before the engine could start.
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
      writeFileSync(marker, JSON.stringify({ archive }) + "\n", { flag: "wx" });
      created.push(marker);
    }
    return { legacyDevMode: false };
  } catch {
    if (archive && existsSync(archive) && !existsSync(dev)) renameSync(archive, dev);
    for (const pathname of created.reverse()) rmSync(pathname, { recursive: true, force: true });
    return { legacyDevMode: true, note: "Profile migration failed; retaining the previous gateway layout." };
  }
}
