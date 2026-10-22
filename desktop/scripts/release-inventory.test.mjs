import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { makeComponentRelease } from "./make-component-release.mjs";
import * as inventoryModule from "./release-inventory.mjs";
import { fileDigest, verifyReleaseDirectory, writeReleaseInventory, validateReleaseIdentity } from "./release-inventory.mjs";
import { publishRelease, verifyPublicLatest } from "./publish-component-release.mjs";

const commit = "a".repeat(40);
const version = "0.4.3-build-aaaaaaaaaaaa";
const targets = [["win32", "x64"], ["darwin", "arm64"], ["linux", "x64"]];
async function fixture(body) {
  const root = await mkdtemp(join(process.env.BRANCH_RELEASE_TEST_TEMP ?? process.env.RUNNER_TEMP ?? tmpdir(), "release-inventory-test-"));
  try {
    const engine = join(root, "engine"), window = join(root, "window"), assets = join(root, "assets");
    await mkdir(join(engine, "dist"), { recursive: true }); await mkdir(window); await mkdir(assets);
    await writeFile(join(engine, "branch.mjs"), "export {};\n");
    await writeFile(join(engine, "dist/entry.js"), "export {};\n");
    await writeFile(join(engine, "dist/build-info.json"), JSON.stringify({ commit }));
    await writeFile(join(window, "index.html"), "<!doctype html><title>Branch</title>");
    const asar = join(root, "desktop-asar"), app = join(root, "desktop-app");
    await mkdir(asar); await mkdir(join(app, "resources"), { recursive: true });
    await writeFile(join(asar, "app.asar"), "offline fixture asar");
    await writeFile(join(app, "Branch Agent.exe"), "offline fixture app"); await writeFile(join(app, "resources/app.asar"), "offline fixture asar");
    const macApp = join(app, "Branch Agent.app", "Contents");
    await mkdir(join(macApp, "Resources"), { recursive: true });
    await mkdir(join(macApp, "MacOS"), { recursive: true });
    await writeFile(join(macApp, "Resources/app.asar"), "offline fixture asar");
    await writeFile(join(macApp, "MacOS/Branch Agent"), "offline fixture app");
    for (const [platform, arch] of targets) {
      const output = join(root, platform); await mkdir(output);
      const desktop = { app: asar, electronVersion: "44.5.1", runtime: app };
      const manifest = await makeComponentRelease({ version, sourceCommit: commit, tag: `v${version}`, engine, window, desktop, output, platform, arch });
      const name = `branch-desktop-${version}-${platform}-${arch}.tar.gz`;
      const identity = { commit, version, platform, arch, electronVersion: "44.5.1", ...(platform === "darwin" ? { signing: "identity" } : {}), runtime: {
        electronVersion: "44.5.1", electron: { sha256: "b".repeat(64), bytes: 1 },
        node: { version: "v24.19.0", platform, arch, sha256: "c".repeat(64) } }, smoke: { commit, ready: true, authenticatedHealth: true, exited: true, elapsedMs: 10, runtime: { version: "v24.19.0", platform, arch }, source: "verified-component-archive", archiveSha256: manifest.components.engine.sha256, archiveBytes: manifest.components.engine.bytes, expandedBytes: manifest.components.engine.expandedBytes } };
      await writeReleaseInventory(output, identity); await cp(output, assets, { recursive: true });
    }
    await body({ root, engine, window, assets });
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function alterProof(assets, edit, target = "win32-x64") {
  const file = join(assets, `release-proof-${target}.json`);
  const proof = JSON.parse(await readFile(file, "utf8")); edit(proof);
  await writeFile(file, JSON.stringify(proof));
}
async function alterManifest(assets, edit) {
  const name = "branch-release-win32-x64.json";
  const file = join(assets, name), value = JSON.parse(await readFile(file, "utf8"));
  edit(value); await writeFile(file, JSON.stringify(value));
  const digest = await fileDigest(file);
  await alterProof(assets, proof => { proof.assets[name] = digest; });
}

test("full native release inventories bind all targets to one exact source and shared renderer", () => fixture(async ({ assets }) => {
  const result = await verifyReleaseDirectory(assets, commit, version);
  assert.deepEqual(result.targets, ["darwin-arm64", "linux-x64", "win32-x64"]);
  assert.equal(Object.keys(result.inventory).length, 16);
}));

for (const [label, edit, message] of [
  ["mixed source SHA", proof => { proof.commit = "d".repeat(40); }, /Mixed source/],
  ["mixed version", proof => { proof.version = "0.4.4"; }, /Mixed release/],
  ["target alias", proof => { proof.arch = "arm64"; }, /Expected values/],
  ["traversal asset", proof => { proof.assets["../outside"] = { sha256: "a".repeat(64), bytes: 1 }; }, /Unsafe proof/],
  ["missing desktop bootstrap", proof => { delete proof.assets[Object.keys(proof.assets).find(name => name.startsWith("branch-desktop-"))]; }, /Missing native desktop/],
  ["missing manifest", proof => { delete proof.assets["branch-release-win32-x64.json"]; }, /Missing platform/],
  ["wrong Node target", proof => { proof.runtime.node.arch = "arm64"; }, /runtime target/],
  ["old Node runtime", proof => { proof.runtime.node.version = "v24.15.0"; }, /Node24/],
  ["changed Electron receipt", proof => { proof.runtime.electronVersion = "1.0.0"; }, /Electron/],
  ["missing production smoke", proof => { delete proof.smoke; }, /smoke did not pass/],
  ["production smoke wrong source", proof => { proof.smoke.commit = "f".repeat(40); }, /smoke source/],
  ["unextracted production smoke", proof => { proof.smoke.source = "original-deployment"; }, /extracted release/],
  ["production smoke wrong archive", proof => { proof.smoke.archiveSha256 = "f".repeat(64); }, /smoke archive/],
]) test(`release inventory rejects ${label}`, () => fixture(async ({ assets }) => {
  await alterProof(assets, edit); await assert.rejects(verifyReleaseDirectory(assets, commit, version), message);
}));

for (const [label, edit, message] of [
  ["retired repository", value => { value.components.engine.url = value.components.engine.url.replace("KeepOak/Branch-Agent", "KeepOak/test"); }, /Expected values/],
  ["credential URL", value => { value.components.engine.url = value.components.engine.url.replace("https://", "https://token@"); }, /Expected values/],
  ["wrong target metadata", value => { value.components.engine.platform = "linux"; }, /Expected values/],
  ["manifest hash mismatch", value => { value.components.engine.sha256 = "f".repeat(64); }, /Manifest\/asset mismatch/],
  ["unbounded invalid expanded size", value => { value.components.engine.expandedBytes = Infinity; }, /Invalid expanded/],
  ["missing desktop component", value => { delete value.components.desktop; }, /Missing release component/],
  ["missing desktop runtime", value => { delete value.components.desktopRuntime; }, /Missing release component/],
  ["desktop for another Electron", value => { value.components.desktop.electronVersion = "45.0.0"; }, /Desktop component Electron/],
  ["desktop for another target", value => { value.components.desktop.arch = "arm64"; }, /Expected values/],
]) test(`release inventory rejects ${label}`, () => fixture(async ({ assets }) => {
  await alterManifest(assets, edit); await assert.rejects(verifyReleaseDirectory(assets, commit, version), message);
}));

test("release inventory rejects corrupted payload and unlisted assets", () => fixture(async ({ assets }) => {
  await writeFile(join(assets, "unattested.txt"), "unexpected");
  await assert.rejects(verifyReleaseDirectory(assets, commit, version), /Unattested/);
  await rm(join(assets, "unattested.txt"));
  const name = `branch-engine-${version}-win32-x64.tar.gz`;
  await writeFile(join(assets, name), "corrupt");
  await assert.rejects(verifyReleaseDirectory(assets, commit, version), /digest mismatch/);
}));

test("macOS proofs declare identity or ad-hoc signing; other targets declare none", () => fixture(async ({ assets }) => {
  await alterProof(assets, proof => { proof.signing = "adhoc"; }, "darwin-arm64");
  assert.deepEqual((await verifyReleaseDirectory(assets, commit, version)).targets, ["darwin-arm64", "linux-x64", "win32-x64"]);
  await alterProof(assets, proof => { delete proof.signing; }, "darwin-arm64");
  await assert.rejects(verifyReleaseDirectory(assets, commit, version), /must declare signing/);
  await alterProof(assets, proof => { proof.signing = "self"; }, "darwin-arm64");
  await assert.rejects(verifyReleaseDirectory(assets, commit, version), /must declare signing/);
  await alterProof(assets, proof => { proof.signing = "identity"; }, "darwin-arm64");
  await alterProof(assets, proof => { proof.signing = "adhoc"; }, "linux-x64");
  await assert.rejects(verifyReleaseDirectory(assets, commit, version), /Only macOS release proofs declare signing/);
}));

const installerNames = { "win32-x64": `Branch-Agent-Setup-${version}-win32-x64.exe`, "darwin-arm64": `Branch-Agent-${version}-darwin-arm64.dmg`,
  "linux-x64": `Branch-Agent-${version}-linux-x64.AppImage` };
/** Puts an installer beside the assets and lists it in its target's proof, optionally with a different listed digest. */
async function listInstaller(assets, target, { name = installerNames[target], place = true, listed } = {}) {
  const file = join(assets, name);
  await writeFile(file, `${target} installer`);
  const digest = listed ?? await fileDigest(file);
  if (!place) await rm(file);
  await alterProof(assets, proof => { proof.installers = { ...proof.installers, [name]: digest }; }, target);
}

test("each platform's release proof lists its installer by name, size and sha256", () => fixture(async ({ root, assets }) => {
  const built = join(root, "installers"); await mkdir(built);
  for (const target of ["win32-x64", "darwin-arm64", "linux-x64"]) {
    const file = join(built, installerNames[target]);
    await writeFile(file, `${target} installer bytes`);
    await inventoryModule.recordInstaller(assets, target, file);
    const proof = JSON.parse(await readFile(join(assets, `release-proof-${target}.json`), "utf8"));
    assert.deepEqual(proof.installers, { [installerNames[target]]: { sha256: (await fileDigest(file)).sha256, bytes: Buffer.byteLength(`${target} installer bytes`) } });
    await cp(file, join(assets, installerNames[target]));
  }
  const result = await verifyReleaseDirectory(assets, commit, version);
  assert.equal(Object.keys(result.inventory).length, 19);
  // Linux ships the AppImage; its proof lists it beside the tar.gz bootstrap package the updater uses.
  assert(Object.hasOwn(result.inventory, `Branch-Agent-${version}-linux-x64.AppImage`));
  for (const name of Object.values(installerNames)) assert.deepEqual(result.inventory[name], await fileDigest(join(assets, name)));
  const stray = join(built, "Branch-Agent-other.exe"); await writeFile(stray, "x");
  await assert.rejects(inventoryModule.recordInstaller(assets, "win32-x64", stray), /Unexpected installer/);
}));

test("a target without an installer still verifies beside targets that have one", () => fixture(async ({ assets }) => {
  await listInstaller(assets, "win32-x64");
  const result = await verifyReleaseDirectory(assets, commit, version);
  assert.deepEqual(result.targets, ["darwin-arm64", "linux-x64", "win32-x64"]);
  assert(Object.hasOwn(result.inventory, installerNames["win32-x64"]));
  assert(!Object.keys(result.inventory).some(name => name.endsWith(".dmg")));
}));

test("release inventory refuses a listed installer that is missing", () => fixture(async ({ assets }) => {
  await listInstaller(assets, "darwin-arm64", { place: false });
  await assert.rejects(verifyReleaseDirectory(assets, commit, version), /Missing listed installer/);
}));

test("release inventory refuses an installer whose bytes differ from its listing", () => fixture(async ({ assets }) => {
  await listInstaller(assets, "win32-x64", { listed: { sha256: "f".repeat(64), bytes: 17 } });
  await assert.rejects(verifyReleaseDirectory(assets, commit, version), /Installer digest mismatch/);
}));

test("release inventory refuses an installer listed under another target's name", () => fixture(async ({ assets }) => {
  await listInstaller(assets, "linux-x64", { name: `branch-agent_${version}_amd64.deb` });
  await assert.rejects(verifyReleaseDirectory(assets, commit, version), /Unexpected installer/);
}));

test("release inventory refuses an AppImage listed for another target", () => fixture(async ({ assets }) => {
  await listInstaller(assets, "darwin-arm64", { name: `Branch-Agent-${version}-linux-x64.AppImage` });
  await assert.rejects(verifyReleaseDirectory(assets, commit, version), /Unexpected installer/);
}));

test("renderer TAR mode is deterministic while engine executable modes remain native", () => fixture(async ({ root, engine, window }) => {
  await chmod(join(window, "index.html"), 0o755);
  const output = join(root, "mode-check");
  await makeComponentRelease({ version, tag: `v${version}`, engine, window, output, platform: "win32", arch: "x64" });
  const windowTar = gunzipSync(await readFile(join(output, `branch-window-${version}.tar.gz`)));
  assert.equal(parseInt(windowTar.subarray(100, 108).toString(), 8), 0o644);
  const engineTar = gunzipSync(await readFile(join(output, `branch-engine-${version}-win32-x64.tar.gz`)));
  assert.equal(parseInt(engineTar.subarray(100, 108).toString(), 8), (await stat(join(engine, "branch.mjs"))).mode & 0o777);
}));

test("shared renderer archive bytes do not depend on the native build host", () => fixture(async ({ root, engine, window }) => {
  const output = join(root, "host-check");
  await makeComponentRelease({ version, tag: `v${version}`, engine, window, output, platform: "linux", arch: "x64" });
  const archive = await readFile(join(output, `branch-window-${version}.tar.gz`));
  // Header byte 9 is the gzip OS field; zlib fills in 3/10/19 for Linux/Windows/macOS hosts.
  assert.equal(archive[9], 0xff, "Renderer archive must not record the build host OS");
  assert.deepEqual(archive.subarray(4, 8), Buffer.alloc(4), "Renderer archive must not record a build time");
  assert(gunzipSync(archive).length > 0);
}));

test("identity rejects abbreviated commits and non-semver source versions", () => {
  const valid = { commit, version, platform: "win32", arch: "x64" };
  assert.throws(() => validateReleaseIdentity({ ...valid, commit: "aaaaaaa" }), /exact source/);
  assert.throws(() => validateReleaseIdentity({ ...valid, version: "latest" }), /Invalid release/);
});

const older = "c".repeat(40), newer = "e".repeat(40);
/** Simulated main history: older -> commit -> newer; `branch` is a commit that never reached main. */
function compare(base, head) {
  const order = [older, commit, newer, "main"];
  if (!order.includes(base) || !order.includes(head)) return "diverged";
  const delta = order.indexOf(head) - order.indexOf(base);
  return delta === 0 ? "identical" : delta > 0 ? "ahead" : "behind";
}

function simulatedGitHub(options = {}) {
  const calls = []; let uploaded = [], published = false, compares = 0;
  const notFound = () => Object.assign(new Error("gh: Not Found (HTTP 404)"), { stderr: "gh: Not Found (HTTP 404)" });
  const request = async args => {
    calls.push(args);
    if (args[0] === "api" && args[1].includes("/compare/")) {
      const [base, head] = args[1].split("/compare/")[1].split("...");
      compares++;
      return options.leftMain && head === "main" && compares > 1 ? "diverged" : compare(options.source ?? base, head);
    }
    if (args[0] === "api" && args[1].endsWith("/releases")) {
      return JSON.stringify([options.existing ? [{ tag_name: `v${version}`, target_commitish: options.existingCommit ?? commit }] : []]);
    }
    if (args[0] === "api" && args[1].endsWith("/releases/latest")) {
      if (published) return JSON.stringify({ draft: false, prerelease: false, target_commitish: commit, tag_name: `v${version}` });
      if (!options.latest) throw notFound();
      return JSON.stringify({ draft: false, prerelease: false, target_commitish: options.latest, tag_name: "v0.0.1" });
    }
    if (args[0] === "release" && args[1] === "edit") published = true;
    if (args[0] === "api" && args[1].includes("/releases/tags/")) return JSON.stringify({ draft: false, prerelease: false, target_commitish: commit, tag_name: `v${version}` });
    if (args[0] === "api" && args[1].includes("/git/ref/tags/")) return JSON.stringify({ object: { type: "commit", sha: options.tagSha ?? commit } });
    if (args[0] === "release" && args[1] === "create") uploaded = args.slice(3, args.indexOf("--repo"));
    if (args[0] === "release" && args[1] === "download") {
      const directory = args[args.indexOf("--dir") + 1];
      for (const file of uploaded) await cp(file, join(directory, basename(file)));
      if (options.corrupt) await writeFile(join(directory, basename(uploaded[0])), "changed by remote");
    }
    return "";
  };
  return { calls, request };
}

test("publication exposes latest only after authenticated uploaded-byte readback and final source check", () => fixture(async ({ assets }) => {
  const remote = simulatedGitHub();
  await publishRelease(assets, commit, version, remote.request, async url => new Response(await readFile(join(assets, new URL(url).pathname.split("/").at(-1)))));
  assert(remote.calls.find(args => args[1] === "create").includes("--draft"));
  assert(remote.calls.find(args => args[1] === "create").includes("--verify-tag"));
  assert(remote.calls.findIndex(args => args[1] === "download") < remote.calls.findIndex(args => args[1] === "edit"));
  assert(remote.calls.find(args => args[1] === "edit").includes("--latest"));
}));

test("publication of a main commit proceeds while main advances, replacing an older latest", () => fixture(async ({ assets }) => {
  const remote = simulatedGitHub({ latest: older });
  await publishRelease(assets, commit, version, remote.request, async url => new Response(await readFile(join(assets, new URL(url).pathname.split("/").at(-1)))));
  assert(remote.calls.find(args => args[1] === "edit").includes("--latest"));
}));

test("publication skips an existing release for the same source commit", () => fixture(async ({ assets }) => {
  const remote = simulatedGitHub({ existing: true });
  const result = await publishRelease(assets, commit, version, remote.request);
  assert.equal(result.skipped, true);
  assert.match(result.reason, /already exists; skipping publish/);
  assert.equal(result.tag, `v${version}`);
  assert.equal(result.commit, commit);
  assert(!remote.calls.some(args => args[1] === "create" || args[1] === "edit"));
}));

for (const [label, options, expected] of [
  ["existing release for a different commit", { existing: true, existingCommit: "d".repeat(40), tagSha: "d".repeat(40) }, /different source/],
  ["wrong immutable tag", { tagSha: "d".repeat(40) }, /different source/],
  ["corrupted uploaded bytes", { corrupt: true }, /readback differs/],
  ["a source that is not on main", { source: "b".repeat(40) }, /not a commit on main/],
  ["a source that left main during upload", { leftMain: true }, /not a commit on main/],
  ["a newer main commit already latest", { latest: newer }, /stale automatic update/],
  ["the same commit already latest", { latest: commit }, /stale automatic update/],
]) test(`publication refuses ${label} without changing latest`, () => fixture(async ({ assets }) => {
  const remote = simulatedGitHub(options);
  await assert.rejects(publishRelease(assets, commit, version, remote.request), expected);
  assert(!remote.calls.some(args => args[1] === "edit"));
}));

test("public latest readback rejects stale aliases, inaccessible manifests and changed bytes", () => fixture(async ({ assets }) => {
  const proof = await verifyReleaseDirectory(assets, commit, version);
  const latest = () => JSON.stringify({ draft: false, prerelease: false, target_commitish: commit, tag_name: `v${version}` });
  const noRetry = { budgetMs: 0, sleep: async () => {} };
  await assert.rejects(verifyPublicLatest(assets, commit, version, proof, async () => latest().replace(`v${version}`, "v0.1.0"), fetch, noRetry), /not GitHub latest/);
  await assert.rejects(verifyPublicLatest(assets, commit, version, proof, async () => latest(), async () => new Response("", { status: 404 }), noRetry), /not publicly downloadable/);
  await assert.rejects(verifyPublicLatest(assets, commit, version, proof, async () => latest(), async () => new Response("altered"), noRetry), /Expected values|differs/);
}));
