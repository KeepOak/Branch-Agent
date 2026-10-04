/** Use pnpm's existing Windows directory encoding on every production target; no package/file is omitted. */
export const PRODUCTION_VIRTUAL_STORE_NAME_LENGTH = 60;

/**
 * Release archives (and every installed updater's reader) carry regular files only. Materializing the
 * isolated linker's symlinks leaves non-root dependencies unresolvable, so the engine exits before readyz.
 * The non-legacy deploy installs the deployment as its own project from a lockfile derived from the frozen
 * workspace lockfile; the hoisted linker then lays out a real-file tree inside the deployment only (the
 * legacy deploy would hoist into the source workspace instead).
 */
export function productionDeployArguments(destination, verifiedExceptions) {
  return ["--filter", "branch", "deploy", "--prod", "--config.allow-unused-patches=true",
    "--config.inject-workspace-packages=true", "--config.node-linker=hoisted", "--config.enable-global-virtual-store=false",
    // The engine's clone-or-copy import stages whole-package APFS clones under .pnpm on macOS; copy writes the tree once.
    "--config.package-import-method=copy",
    ...verifiedExceptions, destination];
}

/** Hoisted deployments keep only pnpm's lock metadata in .pnpm; package directories there mean another layout won. */
export async function assertHoistedDeployment(deployment) {
  let entries = [];
  try { entries = await readdir(join(deployment, "node_modules/.pnpm"), { withFileTypes: true }); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const packages = entries.filter(entry => !entry.isFile()).map(entry => entry.name);
  assert.deepEqual(packages, [], `Production deployment is not hoisted; .pnpm holds ${packages.length} package entries: ${packages.slice(0, 5).join(", ")}`);
}

export function productionDeployEnvironment(environment) {
  return { ...environment, PNPM_CONFIG_VIRTUAL_STORE_DIR_MAX_LENGTH: String(PRODUCTION_VIRTUAL_STORE_NAME_LENGTH) };
}
import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileDigest } from "./release-inventory.mjs";


/** Verify the actual published bytes before exercising the unchanged installed reader and native runtime. */
export async function extractProductionArchive(archive, asset, commit, destination, extract) {
  assert.deepEqual(await fileDigest(archive), { sha256: asset.sha256, bytes: asset.bytes }, "Production archive differs from its manifest");
  await mkdir(destination);
  await extract(archive, destination, asset.expandedBytes);
  assert.equal(JSON.parse(await readFile(join(destination, "dist/build-info.json"), "utf8")).commit, commit,
    "Extracted production archive has a different source identity");
  return destination;
}
