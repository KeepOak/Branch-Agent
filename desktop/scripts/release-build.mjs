import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleNode } from "./bundle-node.mjs";
import { smokeProductionEngine } from "./production-engine-smoke.mjs";
import { assertTrackedSourceClean } from "./release-source-freeze.mjs";
import { assertHoistedDeployment, extractProductionArchive, productionDeployArguments, productionDeployEnvironment } from "./release-production-layout.mjs";
import { makeComponentRelease } from "./make-component-release.mjs";
import { installLinuxLauncher } from "./linux-launcher.mjs";
import { fileDigest, writeReleaseInventory, validateReleaseIdentity } from "./release-inventory.mjs";
import { engineRoot, windowRoot, toolingRoot, repoRoot, gitHead, run, preparePnpm,
  scratchRoot, verifiedExceptionFlags, publishWindowDependencies } from "../../scripts/feature-batch-ci-runtime.mjs";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(join(desktopRoot, "package.json"));

export async function releaseIdentity() {
  const commit = await gitHead();
  assert.equal(commit, process.env.BRANCH_RELEASE_COMMIT, "Release checkout differs from the authorized source SHA");
  assertTrackedSourceClean(repoRoot);
  const desktop = JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8"));
  const version = process.env.BRANCH_RELEASE_VERSION;
  assert(version === desktop.version || version === `${desktop.version}-build-${commit.slice(0, 12)}`, "Release version must derive from source desktop version");
  const identity = { commit, version, platform: process.platform, arch: process.arch };
  validateReleaseIdentity(identity);
  if (process.env.BRANCH_RELEASE_TARGET) assert.equal(`${identity.platform}-${identity.arch}`, process.env.BRANCH_RELEASE_TARGET, "Hosted runner must match its native release target");
  return { ...identity, electronVersion: desktop.devDependencies.electron };
}

async function prepareEngine(pnpm) {
  const engineFlags = await verifiedExceptionFlags("engine");
  await run(pnpm, ["install", "--frozen-lockfile", "--ignore-scripts", ...engineFlags], engineRoot);
  await run(process.execPath, ["--import", "./scripts/tsx.mjs", "--input-type=module", "--eval",
    'const { withDistArtifactOwnership } = await import("./scripts/lib/dist-artifact-ownership.mts"); const { ensureKyselyTypes } = await import("./scripts/generate-kysely-types.mts"); await withDistArtifactOwnership(process.cwd(), () => ensureKyselyTypes(process.cwd()));'], engineRoot);
  for (const name of ["gateway-protocol", "gateway-client"]) {
    await run(process.execPath, ["--import", "./scripts/tsx.mjs", "scripts/build-workspace-package.mts", name], engineRoot);
  }
}

async function prepareWindow(pnpm) {
  await prepareEngine(pnpm);
  const windowFlags = await verifiedExceptionFlags("window");
  await run(pnpm, ["install", "--frozen-lockfile", "--ignore-scripts", ...windowFlags,
    `--modules-dir=${join(windowRoot, "node_modules")}`, `--virtual-store-dir=${join(windowRoot, "node_modules/.pnpm")}`], toolingRoot);
  await publishWindowDependencies();
  await run(process.execPath, [join(windowRoot, "node_modules/typescript/bin/tsc"), "-b"], windowRoot);
  await run(process.execPath, [join(windowRoot, "node_modules/vite/bin/vite.js"), "build"], windowRoot);
}

async function deployEngine(pnpm, scratch, identity) {
  // Runtime-only package build: the engine component never loads declarations, which were ~75% of build time.
  await run(pnpm, ["build:package"], engineRoot, { ...process.env, BRANCH_RUN_NODE_SKIP_DTS_BUILD: "1" });
  const metadata = JSON.parse(await readFile(join(engineRoot, "dist/build-info.json"), "utf8"));
  assert.equal(metadata.commit, identity.commit, "Engine build metadata differs from source freeze");
  const deployment = join(scratch, "production-engine");
  const flags = await verifiedExceptionFlags("engine");
  await run(pnpm, productionDeployArguments(deployment, flags), engineRoot, productionDeployEnvironment(process.env));
  await assertHoistedDeployment(deployment);
  if (identity.platform === "darwin") {
    const binary = join(deployment, "cua-driver");
    await run("bash", [join(engineRoot, "scripts/stage-cua-driver-macos.sh"), binary]);
    const signingP12 = process.env.BRANCH_MACOS_SIGNING_P12_FILE;
    const signingPassword = process.env.BRANCH_MACOS_SIGNING_PASSWORD_FILE;
    const rcodesign = process.env.BRANCH_MACOS_RCODESIGN;
    assert(signingP12 && signingPassword && rcodesign, "macOS computer driver requires the release signing identity");
    await run(rcodesign, ["sign", "--p12-file", signingP12, "--p12-password-file", signingPassword, binary]);
  }
  assert.equal(JSON.parse(await readFile(join(deployment, "dist/build-info.json"), "utf8")).commit, identity.commit);
  assert(!(await readdir(deployment)).includes("src"), "Production deployment must not be an unbuilt source checkout");
  // The Codex harness ships in every release: its plugin build and its runtime packages.
  for (const file of ["dist/extensions/codex/branch.plugin.json", "node_modules/@openai/codex/package.json", "node_modules/smol-toml/package.json"]) {
    assert((await stat(join(deployment, file))).isFile(), `Production deployment is missing ${file}`);
  }
  return deployment;
}

async function packageDesktop(scratch, output, identity) {
  const npmDirectory = process.platform === "win32" ? dirname(process.execPath) : join(dirname(process.execPath), "../lib");
  await run(process.execPath, [join(npmDirectory, "node_modules/npm/bin/npm-cli.js"), "ci", "--no-audit", "--no-fund"], desktopRoot);
  await run(process.execPath, [join(desktopRoot, "scripts/build.mjs")], desktopRoot);
  const packageJson = JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8"));
  delete packageJson.devDependencies; delete packageJson.scripts;
  const appDirectory = join(scratch, "desktop-app"); await mkdir(appDirectory);
  for (const name of ["dist", "assets"]) await run(process.execPath, ["--input-type=module", "-e",
    'import { cp } from "node:fs/promises"; await cp(process.argv[1], process.argv[2], { recursive: true });', join(desktopRoot, name), join(appDirectory, name)]);
  await writeFile(join(appDirectory, "package.json"), JSON.stringify(packageJson));
  const { downloadArtifact } = require("@electron/get");
  const electron = await fileDigest(await downloadArtifact({ version: identity.electronVersion, artifactName: "electron", platform: identity.platform, arch: identity.arch }));
  const { packager } = require("@electron/packager");
  const { darwinPackagerOptions, stampMacBundle, MAC_ARCHIVE_BUNDLE_FOLDER } = require(join(desktopRoot, "dist/mac-applications.js"));
  const macIcon = join(desktopRoot, "assets/branch.icns");
  const folders = await packager({ dir: appDirectory, name: "Branch Agent", platform: identity.platform, arch: identity.arch,
    electronVersion: identity.electronVersion, asar: true, out: join(scratch, "desktop-packaged"), prune: false,
    appVersion: packageJson.version, ...(identity.platform === "win32" ? { icon: join(desktopRoot, "assets/branch.ico") } : {}),
    ...(identity.platform === "darwin" ? darwinPackagerOptions(macIcon) : {}),
    ...(identity.platform === "linux" ? { icon: join(desktopRoot, "assets/brand/linux/branch-512.png") } : {}) });
  assert.equal(folders.length, 1, "Expected one native desktop package");
  const app = folders[0];
  // Stamp the name and stable bundle id before signing. A later rewrite would break the signature.
  if (identity.platform === "darwin") await stampMacBundle(join(app, MAC_ARCHIVE_BUNDLE_FOLDER));
  if (identity.platform === "linux") await installLinuxLauncher(app);
  const resources = identity.platform === "darwin" ? join(app, `${MAC_ARCHIVE_BUNDLE_FOLDER}/Contents/Resources`) : join(app, "resources");
  let node = await bundleNode(resources, undefined, identity);
  // Outside app.asar so a fresh package can prove its executable already has the Keeper icon.
  await writeFile(join(resources, "keeper-icon-revision"), "keeper-v1\n");
  // The desktop update component: app.asar alone, plus the whole app (the bootstrap package) for Electron changes.
  const asar = join(scratch, "desktop-asar"); await mkdir(asar);
  await copyFile(join(resources, "app.asar"), join(asar, "app.asar"));
  const desktop = { app: asar, electronVersion: identity.electronVersion };
  if (identity.platform === "darwin") {
    const signingP12 = process.env.BRANCH_MACOS_SIGNING_P12_FILE;
    const signingPassword = process.env.BRANCH_MACOS_SIGNING_PASSWORD_FILE;
    const rcodesign = process.env.BRANCH_MACOS_RCODESIGN;
    assert(signingP12 && signingPassword && rcodesign, "macOS releases require a stable code-signing identity");
    // A receipt inside the sealed bundle cannot be rewritten after nested-code signing.
    // The release proof records the final shipped Node hash instead.
    await rm(join(resources, "node/node-runtime.json"));
    // Packager signs before the bundled Node and icon revision are added. Sign the finished bundle,
    // including its nested code, before hashing the Node binary or archiving the app.
    await run(rcodesign, ["sign", "--p12-file", signingP12, "--p12-password-file", signingPassword, join(app, MAC_ARCHIVE_BUNDLE_FOLDER)]);
    node = { ...node, sha256: (await fileDigest(join(resources, "node/node"))).sha256 };
  }
  desktop.runtime = app;
  return { node, electron, electronVersion: identity.electronVersion, desktop,
    nodePath: join(resources, "node", identity.platform === "win32" ? "node.exe" : "node") };
}

/** CI starts the native build before the shared renderer exists; packaging waits for its ready file. */
async function waitForSharedWindow() {
  const ready = process.env.BRANCH_RELEASE_WINDOW_READY;
  if (!ready) return;
  for (const end = Date.now() + 12 * 60_000; ; await new Promise(next => setTimeout(next, 2000))) {
    try { if ((await stat(ready)).isFile()) return; } catch (error) { if (error.code !== "ENOENT") throw error; }
    assert(Date.now() < end, "The shared renderer never arrived");
  }
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
    // The named feature suites already gate every pull request and main push (feature-batch-checks.yml).
    await prepareEngine(pnpm);
    const engine = await deployEngine(pnpm, scratch, identity);
    // Packaged first, so the manifest's desktop component is the same app.asar as the bootstrap package.
    const { nodePath, desktop, ...runtime } = await packageDesktop(scratch, output, identity);
    await waitForSharedWindow();
    const manifest = await makeComponentRelease({ ...identity, sourceCommit: identity.commit, tag: `v${identity.version}`, engine, window: windowDirectory, desktop, output });
    const source = await readFile(join(engineRoot, "packages/gateway-protocol/src/version.ts"), "utf8");
    const protocol = { min: Number(source.match(/MIN_CLIENT_PROTOCOL_VERSION = (\d+)/)?.[1]), max: Number(source.match(/PROTOCOL_VERSION = (\d+)/)?.[1]) };
    assert(Number.isInteger(protocol.min) && Number.isInteger(protocol.max), "Missing source gateway protocol levels");
    const { extractComponentArchive } = await import(pathToFileURL(join(desktopRoot, "dist/component-update-archive.js")));
    const archive = join(output, `branch-engine-${identity.version}-${identity.platform}-${identity.arch}.tar.gz`);
    const extracted = await extractProductionArchive(archive, manifest.components.engine, identity.commit, join(scratch, "archive-smoke-engine"), extractComponentArchive);
    const smoke = { ...await smokeProductionEngine(extracted, nodePath, identity.commit, protocol), source: "verified-component-archive",
      archiveSha256: manifest.components.engine.sha256, archiveBytes: manifest.components.engine.bytes, expandedBytes: manifest.components.engine.expandedBytes };
    await writeReleaseInventory(output, { ...identity, runtime, smoke });
  }
  assert.deepEqual(await releaseIdentity(), identity, "Source or release identity changed during the build");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildRelease(process.argv[2], resolve(process.argv[3]), process.argv[4] && resolve(process.argv[4]));
}
