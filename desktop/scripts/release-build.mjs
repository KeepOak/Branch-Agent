import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { bundleNode } from "./bundle-node.mjs";
import { smokeProductionEngine } from "./production-engine-smoke.mjs";
import { makeComponentRelease } from "./make-component-release.mjs";
import { fileDigest, writeReleaseInventory, validateReleaseIdentity } from "./release-inventory.mjs";
import { engineRoot, windowRoot, toolingRoot, repoRoot, gitHead, run, preparePnpm,
  scratchRoot, verifiedExceptionFlags, publishWindowDependencies } from "../../scripts/feature-batch-ci-runtime.mjs";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(join(desktopRoot, "package.json"));

export async function releaseIdentity() {
  const commit = await gitHead();
  assert.equal(commit, process.env.BRANCH_RELEASE_COMMIT, "Release checkout differs from the authorized source SHA");
  assert.equal(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: repoRoot, encoding: "utf8" }).trim(), "", "Release source has tracked modifications");
  const desktop = JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8"));
  const version = process.env.BRANCH_RELEASE_VERSION;
  assert(version === desktop.version || version === `${desktop.version}-build-${commit.slice(0, 12)}`, "Release version must derive from source desktop version");
  const identity = { commit, version, platform: process.platform, arch: process.arch };
  validateReleaseIdentity(identity);
  if (process.env.BRANCH_RELEASE_TARGET) assert.equal(`${identity.platform}-${identity.arch}`, process.env.BRANCH_RELEASE_TARGET, "Hosted runner must match its native release target");
  return { ...identity, electronVersion: desktop.devDependencies.electron };
}

async function prepareWindow(pnpm) {
  const engineFlags = await verifiedExceptionFlags("engine");
  await run(pnpm, ["install", "--frozen-lockfile", "--ignore-scripts", ...engineFlags], engineRoot);
  const windowFlags = await verifiedExceptionFlags("window");
  await run(pnpm, ["install", "--frozen-lockfile", "--ignore-scripts", ...windowFlags,
    `--modules-dir=${join(windowRoot, "node_modules")}`, `--virtual-store-dir=${join(windowRoot, "node_modules/.pnpm")}`], toolingRoot);
  await publishWindowDependencies();
  await run(process.execPath, ["--import", "./scripts/tsx.mjs", "--input-type=module", "--eval",
    'const { withDistArtifactOwnership } = await import("./scripts/lib/dist-artifact-ownership.mts"); const { ensureKyselyTypes } = await import("./scripts/generate-kysely-types.mts"); await withDistArtifactOwnership(process.cwd(), () => ensureKyselyTypes(process.cwd()));'], engineRoot);
  for (const name of ["gateway-protocol", "gateway-client"]) {
    await run(process.execPath, ["--import", "./scripts/tsx.mjs", "scripts/build-workspace-package.mts", name], engineRoot);
  }
  await run(process.execPath, [join(windowRoot, "node_modules/typescript/bin/tsc"), "-b"], windowRoot);
  await run(process.execPath, [join(windowRoot, "node_modules/vite/bin/vite.js"), "build"], windowRoot);
}

async function deployEngine(pnpm, scratch, identity) {
  await run(pnpm, ["build:package"], engineRoot);
  const metadata = JSON.parse(await readFile(join(engineRoot, "dist/build-info.json"), "utf8"));
  assert.equal(metadata.commit, identity.commit, "Engine build metadata differs from source freeze");
  const deployment = join(scratch, "production-engine");
  const flags = await verifiedExceptionFlags("engine");
  await run(pnpm, ["--filter", "branch", "deploy", "--prod", "--legacy", "--config.allow-unused-patches=true", ...flags, deployment], engineRoot);
  assert.equal(JSON.parse(await readFile(join(deployment, "dist/build-info.json"), "utf8")).commit, identity.commit);
  assert(!(await readdir(deployment)).includes("src"), "Production deployment must not be an unbuilt source checkout");
  return deployment;
}

async function packageDesktop(scratch, output, identity) {
  const npmDirectory = process.platform === "win32" ? dirname(process.execPath) : join(dirname(process.execPath), "../lib");
  await run(process.execPath, [join(npmDirectory, "node_modules/npm/bin/npm-cli.js"), "ci", "--no-audit", "--no-fund"], desktopRoot);
  await run(process.execPath, [join(desktopRoot, "node_modules/typescript/bin/tsc"), "-p", join(desktopRoot, "tsconfig.json")], desktopRoot);
  const packageJson = JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8"));
  delete packageJson.devDependencies; delete packageJson.scripts;
  const appDirectory = join(scratch, "desktop-app"); await mkdir(appDirectory);
  for (const name of ["dist", "assets"]) await run(process.execPath, ["--input-type=module", "-e",
    'import { cp } from "node:fs/promises"; await cp(process.argv[1], process.argv[2], { recursive: true });', join(desktopRoot, name), join(appDirectory, name)]);
  await writeFile(join(appDirectory, "package.json"), JSON.stringify(packageJson));
  const { downloadArtifact } = require("@electron/get");
  const electron = await fileDigest(await downloadArtifact({ version: identity.electronVersion, artifactName: "electron", platform: identity.platform, arch: identity.arch }));
  const { packager } = require("@electron/packager");
  const folders = await packager({ dir: appDirectory, name: "Branch Agent", platform: identity.platform, arch: identity.arch,
    electronVersion: identity.electronVersion, asar: true, out: join(scratch, "desktop-packaged"), prune: false,
    appVersion: packageJson.version, ...(identity.platform === "win32" ? { icon: join(desktopRoot, "assets/branch.ico") } : {}) });
  assert.equal(folders.length, 1, "Expected one native desktop package");
  const app = folders[0];
  const resources = identity.platform === "darwin" ? join(app, "Branch Agent.app/Contents/Resources") : join(app, "resources");
  const node = await bundleNode(resources, undefined, identity);
  const filename = `branch-desktop-${identity.version}-${identity.platform}-${identity.arch}.${identity.platform === "win32" ? "zip" : "tar.gz"}`;
  const tar = process.platform === "win32" ? join(process.env.SystemRoot, "System32/tar.exe") : "tar";
  await run(tar, identity.platform === "win32" ? ["-a", "-cf", join(output, filename), "-C", app, "."] : ["-czf", join(output, filename), "-C", app, "."]);
  return { node, electron, electronVersion: identity.electronVersion, nodePath: join(resources, "node", identity.platform === "win32" ? "node.exe" : "node") };
}

export async function buildRelease(mode, output, windowDirectory) {
  assert(["window", "components"].includes(mode), "Usage: release-build.mjs window|components output [built-window]");
  const identity = await releaseIdentity();
  const scratch = await scratchRoot();
  const pnpm = await preparePnpm(scratch);
  await mkdir(output, { recursive: true });
  if (mode === "window") {
    await prepareWindow(pnpm);
    await writeFile(join(windowRoot, "dist/branch-build.txt"), `${identity.version}\n`);
    await run(process.execPath, ["--input-type=module", "-e", 'import { cp } from "node:fs/promises"; await cp(process.argv[1], process.argv[2], { recursive: true });', join(windowRoot, "dist"), output]);
  } else {
    assert(windowDirectory, "Components require the shared tested renderer build");
    await run(process.execPath, [join(repoRoot, "scripts/feature-batch-ci.mjs"), "all"]);
    const engine = await deployEngine(pnpm, scratch, identity);
    await makeComponentRelease({ ...identity, sourceCommit: identity.commit, tag: `v${identity.version}`, engine, window: windowDirectory, output });
    const { nodePath, ...runtime } = await packageDesktop(scratch, output, identity);
    const source = await readFile(join(engineRoot, "packages/gateway-protocol/src/version.ts"), "utf8");
    const protocol = { min: Number(source.match(/MIN_CLIENT_PROTOCOL_VERSION = (\d+)/)?.[1]), max: Number(source.match(/PROTOCOL_VERSION = (\d+)/)?.[1]) };
    assert(Number.isInteger(protocol.min) && Number.isInteger(protocol.max), "Missing source gateway protocol levels");
    const smoke = await smokeProductionEngine(engine, nodePath, identity.commit, protocol);
    await writeReleaseInventory(output, { ...identity, runtime, smoke });
  }
  assert.deepEqual(await releaseIdentity(), identity, "Source or release identity changed during the build");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildRelease(process.argv[2], resolve(process.argv[3]), process.argv[4] && resolve(process.argv[4]));
}
