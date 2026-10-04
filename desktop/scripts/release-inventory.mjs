import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function fileDigest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { sha256: hash.digest("hex"), bytes: (await stat(file)).size };
}

export function validateReleaseIdentity({ commit, version, platform, arch }) {
  assert.match(commit, /^[a-f0-9]{40}$/, "Release must identify an exact source commit");
  assert.match(version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/, "Invalid release version");
  assert(["win32", "darwin", "linux"].includes(platform), "Unsupported release platform");
  assert(["x64", "arm64"].includes(arch), "Unsupported release architecture");
}

export async function writeReleaseInventory(directory, identity) {
  validateReleaseIdentity(identity);
  const assets = {};
  for (const name of (await readdir(directory)).sort()) {
    assert(/^[A-Za-z0-9.-]+$/.test(name), "Unsafe asset filename");
    assert((await stat(join(directory, name))).isFile(), "Release assets must be regular files");
    assets[name] = await fileDigest(join(directory, name));
  }
  const receipt = { schemaVersion: 1, ...identity, assets };
  await writeFile(join(directory, `release-proof-${identity.platform}-${identity.arch}.json`), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

export async function verifyReleaseDirectory(directory, expectedCommit, expectedVersion) {
  const names = (await readdir(directory)).sort();
  const proofs = names.filter(name => /^release-proof-(win32|darwin|linux)-(x64|arm64)\.json$/.test(name));
  assert(proofs.length > 0, "Missing release build proofs");
  const inventory = new Map();
  const targets = new Set();
  for (const name of proofs) {
    const proof = JSON.parse(await readFile(join(directory, name), "utf8"));
    validateReleaseIdentity(proof);
    assert.equal(proof.schemaVersion, 1);
    assert.equal(proof.commit, expectedCommit, "Mixed source commits in release");
    assert.equal(proof.version, expectedVersion, "Mixed release versions");
    const target = `${proof.platform}-${proof.arch}`;
    assert.equal(name, `release-proof-${target}.json`);
    assert(!targets.has(target), "Duplicate target proof");
    targets.add(target);
    await verifyTarget(directory, proof, inventory);
    inventory.set(name, await fileDigest(join(directory, name)));
  }
  assert.deepEqual(names, [...inventory.keys()].sort(), "Unattested or missing release assets");
  return { targets: [...targets].sort(), inventory: Object.fromEntries(inventory) };
}

async function verifyTarget(directory, proof, inventory) {
  assert(proof.assets && typeof proof.assets === "object" && !Array.isArray(proof.assets));
  verifyRuntime(proof);
  const target = `${proof.platform}-${proof.arch}`;
  const manifestName = `branch-release-${target}.json`;
  assert(Object.hasOwn(proof.assets, manifestName), "Missing platform component manifest");
  const desktopName = `branch-desktop-${proof.version}-${target}.${proof.platform === "win32" ? "zip" : "tar.gz"}`;
  assert(Object.hasOwn(proof.assets, desktopName), "Missing native desktop bootstrap package");
  for (const [name, expected] of Object.entries(proof.assets)) {
    assert(/^[A-Za-z0-9.-]+$/.test(name), "Unsafe proof asset filename");
    const actual = await fileDigest(join(directory, name));
    assert.deepEqual(actual, expected, `Release asset digest mismatch: ${name}`);
    if (inventory.has(name)) assert.deepEqual(inventory.get(name), actual, "Conflicting shared asset");
    inventory.set(name, actual);
  }
  const manifest = JSON.parse(await readFile(join(directory, manifestName), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.version, proof.version);
  for (const component of ["engine", "window"]) verifyComponent(manifest.components?.[component], proof, inventory, component);
}

function verifyRuntime(proof) {
  const runtime = proof.runtime;
  assert(runtime && runtime.node && runtime.electron, "Missing native runtime receipts");
  assert.equal(runtime.electronVersion, proof.electronVersion, "Electron version differs from pinned source");
  assert.match(runtime.electronVersion, /^\d+\.\d+\.\d+$/);
  assert.match(runtime.electron.sha256, /^[a-f0-9]{64}$/);
  assert(Number.isSafeInteger(runtime.electron.bytes) && runtime.electron.bytes > 0);
  assert.equal(runtime.node.platform, proof.platform, "Node runtime target mismatch");
  assert.equal(runtime.node.arch, proof.arch, "Node runtime target mismatch");
  const version = /^v24\.(\d+)\.\d+$/.exec(runtime.node.version);
  assert(version && Number(version[1]) >= 16, "Unsupported Node24 runtime");
  assert.match(runtime.node.sha256, /^[a-f0-9]{64}$/);
}

function verifyComponent(asset, proof, inventory, component) {
  assert(asset && typeof asset === "object", "Missing release component");
  const url = new URL(asset.url);
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.username + url.password + url.search + url.hash, "");
  const name = decodeURIComponent(url.pathname.split("/").at(-1));
  assert.equal(url.pathname, `/KeepOak/Branch-Agent/releases/download/v${proof.version}/${name}`);
  const expectedName = component === "engine" ? `branch-engine-${proof.version}-${proof.platform}-${proof.arch}.tar.gz` : `branch-window-${proof.version}.tar.gz`;
  assert.equal(name, expectedName, "Component target filename mismatch");
  assert.deepEqual(inventory.get(name), { sha256: asset.sha256, bytes: asset.bytes }, "Manifest/asset mismatch");
  assert(Number.isSafeInteger(asset.expandedBytes) && asset.expandedBytes > 0, "Invalid expanded size");
  if (component === "engine") {
    assert.equal(asset.platform, proof.platform);
    assert.equal(asset.arch, proof.arch);
  }
}
