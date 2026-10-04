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
    "--config.inject-workspace-packages=true", "--config.node-linker=hoisted", ...verifiedExceptions, destination];
}

export function productionDeployEnvironment(environment) {
  return { ...environment, PNPM_CONFIG_VIRTUAL_STORE_DIR_MAX_LENGTH: String(PRODUCTION_VIRTUAL_STORE_NAME_LENGTH) };
}
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
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
