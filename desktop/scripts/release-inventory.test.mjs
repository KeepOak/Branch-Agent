import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { makeComponentRelease } from "./make-component-release.mjs";
import { fileDigest, verifyReleaseDirectory, writeReleaseInventory, validateReleaseIdentity } from "./release-inventory.mjs";
import { publishRelease } from "./publish-component-release.mjs";

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
    for (const [platform, arch] of targets) {
      const output = join(root, platform); await mkdir(output);
      await makeComponentRelease({ version, tag: `v${version}`, engine, window, output, platform, arch });
      const name = `branch-desktop-${version}-${platform}-${arch}.${platform === "win32" ? "zip" : "tar.gz"}`;
      await writeFile(join(output, name), `${platform}/${arch} offline fixture only`);
      const identity = { commit, version, platform, arch, electronVersion: "44.5.1", runtime: {
        electronVersion: "44.5.1", electron: { sha256: "b".repeat(64), bytes: 1 },
        node: { version: "v24.19.0", platform, arch, sha256: "c".repeat(64) } } };
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
  assert.equal(Object.keys(result.inventory).length, 13);
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
]) test(`release inventory rejects ${label}`, () => fixture(async ({ assets }) => {
  await alterProof(assets, edit); await assert.rejects(verifyReleaseDirectory(assets, commit, version), message);
}));

for (const [label, edit, message] of [
  ["retired repository", value => { value.components.engine.url = value.components.engine.url.replace("KeepOak/Branch-Agent", "KeepOak/test"); }, /Expected values/],
  ["credential URL", value => { value.components.engine.url = value.components.engine.url.replace("https://", "https://token@"); }, /Expected values/],
  ["wrong target metadata", value => { value.components.engine.platform = "linux"; }, /Expected values/],
  ["manifest hash mismatch", value => { value.components.engine.sha256 = "f".repeat(64); }, /Manifest\/asset mismatch/],
  ["unbounded invalid expanded size", value => { value.components.engine.expandedBytes = Infinity; }, /Invalid expanded/],
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

test("renderer TAR mode is deterministic while engine executable modes remain native", () => fixture(async ({ root, engine, window }) => {
  await chmod(join(window, "index.html"), 0o755);
  const output = join(root, "mode-check");
  await makeComponentRelease({ version, tag: `v${version}`, engine, window, output, platform: "win32", arch: "x64" });
  const windowTar = gunzipSync(await readFile(join(output, `branch-window-${version}.tar.gz`)));
  assert.equal(parseInt(windowTar.subarray(100, 108).toString(), 8), 0o644);
  const engineTar = gunzipSync(await readFile(join(output, `branch-engine-${version}-win32-x64.tar.gz`)));
  assert.equal(parseInt(engineTar.subarray(100, 108).toString(), 8), (await stat(join(engine, "branch.mjs"))).mode & 0o777);
}));

test("identity rejects abbreviated commits and non-semver source versions", () => {
  const valid = { commit, version, platform: "win32", arch: "x64" };
  assert.throws(() => validateReleaseIdentity({ ...valid, commit: "aaaaaaa" }), /exact source/);
  assert.throws(() => validateReleaseIdentity({ ...valid, version: "latest" }), /Invalid release/);
});

function simulatedGitHub(options = {}) {
  const calls = []; let uploaded = [], mainReads = 0;
  const request = async args => {
    calls.push(args);
    if (args[0] === "api" && args[1].endsWith("heads/main")) return ++mainReads === 2 && options.advance ? "f".repeat(40) : commit;
    if (args[0] === "api" && args[1].endsWith("/releases")) return JSON.stringify([options.existing ? [{ tag_name: `v${version}` }] : []]);
    if (args[0] === "api" && args[1].includes("/tags/")) return JSON.stringify({ object: { type: "commit", sha: options.tagSha ?? commit } });
    if (args[0] === "release" && args[1] === "create") uploaded = args.slice(3, args.indexOf("--repo"));
    if (args[0] === "release" && args[1] === "download") {
      const directory = args[args.indexOf("--dir") + 1];
      for (const file of uploaded) await cp(file, join(directory, basename(file)));
      if (options.corrupt) await writeFile(join(directory, basename(uploaded[0])), "changed by remote");
    }
    if (args[0] === "release" && args[1] === "view") return JSON.stringify({ isDraft: false, isPrerelease: false, targetCommitish: commit, tagName: `v${version}` });
    return "";
  };
  return { calls, request };
}

test("publication exposes latest only after authenticated uploaded-byte readback and final source check", () => fixture(async ({ assets }) => {
  const remote = simulatedGitHub();
  await publishRelease(assets, commit, version, remote.request);
  assert(remote.calls.find(args => args[1] === "create").includes("--draft"));
  assert(remote.calls.find(args => args[1] === "create").includes("--verify-tag"));
  assert(remote.calls.findIndex(args => args[1] === "download") < remote.calls.findIndex(args => args[1] === "edit"));
  assert(remote.calls.find(args => args[1] === "edit").includes("--latest"));
}));

for (const [label, options, expected] of [
  ["existing immutable release", { existing: true }, /immutable/],
  ["wrong immutable tag", { tagSha: "d".repeat(40) }, /different source/],
  ["corrupted uploaded bytes", { corrupt: true }, /readback differs/],
  ["main advancing during upload", { advance: true }, /newer main/],
]) test(`publication refuses ${label} without changing latest`, () => fixture(async ({ assets }) => {
  const remote = simulatedGitHub(options);
  await assert.rejects(publishRelease(assets, commit, version, remote.request), expected);
  assert(!remote.calls.some(args => args[1] === "edit"));
}));
