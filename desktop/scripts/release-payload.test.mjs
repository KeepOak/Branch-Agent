import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatPayload, isCodexPlatformPackageFile, isDevelopmentOnlyDependencyFile, measurePayload, PAYLOAD_BUDGET,
  payloadBudgetProblems, pruneCodexPlatformPackages, pruneProductionDependencies } from "./release-payload.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** A production engine deployment in miniature: every payload category, with known sizes. */
const deploymentFiles = {
  "branch.mjs": 10,
  "cua-driver": 300,
  "docs/index.md": 20,
  "dist/entry.js": 40,
  "dist/control-ui/index.html": 50,
  "dist/graft/entry.js": 60,
  "dist/extensions/a2a/index.js": 5,
  "dist/extensions/a2a/.setup/api-abc.mjs": 700,
  "dist/extensions/reef/.setup/api-def.mjs": 30,
  "node_modules/@openai/codex/bin/codex.js": 6,
  "node_modules/@openai/codex/package.json": 1,
  "node_modules/@openai/codex-darwin-arm64/vendor/bin/codex": 1000,
  "node_modules/@trycua/cua-driver-darwin-arm64/libcua_driver_sdk.dylib": 200,
  "node_modules/zod/index.js": 80,
  "node_modules/zod/index.js.map": 90,
  "node_modules/zod/index.d.ts": 70,
  "node_modules/zod/index.d.cts": 7,
  "node_modules/zod/v4/core.d.mts": 8,
  "node_modules/zod/LICENSE": 3,
  "node_modules/zod/README.md": 4,
  "node_modules/zod/package.json": 2,
  "node_modules/xlsx/dist/xlsx.full.min.map": 60,
  "node_modules/web-tree-sitter/web-tree-sitter.wasm": 25,
};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "branch-release-payload-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, bytes] of Object.entries(deploymentFiles)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), "x".repeat(bytes));
  }
  return root;
}

async function listFiles(root, folder = "") {
  const result = [];
  for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await listFiles(root, path)); else result.push(path);
  }
  return result.sort();
}

test("only dependency source maps and declarations are development-only", () => {
  for (const path of ["node_modules/a/index.js.map", "node_modules/a/index.d.ts", "node_modules/a/index.d.mts", "node_modules/a/index.d.cts",
    "node_modules/xlsx/dist/xlsx.full.min.map", "node_modules/web-tree-sitter/web-tree-sitter.wasm.map"]) {
    assert.equal(isDevelopmentOnlyDependencyFile(path), true, path);
  }
  for (const path of ["node_modules/a/index.js", "node_modules/a/index.ts", "node_modules/a/LICENSE", "node_modules/a/README.md",
    "node_modules/a/package.json", "node_modules/a/types.d.json", "dist/entry.js.map", "dist/plugin-sdk/core.d.ts"]) {
    assert.equal(isDevelopmentOnlyDependencyFile(path), false, path);
  }
});

test("pruning removes dependency source maps and declarations and keeps every runtime file", async t => {
  const root = await fixture(t);
  assert.deepEqual(await pruneProductionDependencies(root), { files: 5, bytes: 90 + 70 + 7 + 8 + 60 });
  const removed = ["node_modules/xlsx/dist/xlsx.full.min.map", "node_modules/zod/index.d.cts", "node_modules/zod/index.d.ts",
    "node_modules/zod/index.js.map", "node_modules/zod/v4/core.d.mts"];
  assert.deepEqual(await listFiles(root), Object.keys(deploymentFiles).filter(path => !removed.includes(path)).sort());
  assert.equal(await readFile(join(root, "node_modules/zod/index.js"), "utf8"), "x".repeat(80));
});

test("the payload measure names each category and fails the budget for removed categories", async t => {
  const root = await fixture(t);
  const before = await measurePayload(root);
  assert.equal(before.total, Object.values(deploymentFiles).reduce((sum, bytes) => sum + bytes, 0));
  assert.deepEqual(before.categories, {
    "Codex CLI binary": 1000,
    "Computer use (cua-driver, @trycua)": 500,
    "Dependency source maps": 150,
    "Dependency declarations": 85,
    "Other dependencies": 121,
    "Plugin private setup chunks": 730,
    "Control UI": 50,
    "Graft": 60,
    "Other engine dist": 45,
    "Docs, skills and launchers": 30,
  });
  assert.deepEqual(before.setupChunks, { a2a: 700, reef: 30 });
  assert.deepEqual(payloadBudgetProblems(before), [
    "Codex CLI binary: 1000 bytes shipped; this category is removed from releases",
    "Dependency source maps: 150 bytes shipped; this category is removed from releases",
    "Dependency declarations: 85 bytes shipped; this category is removed from releases",
  ]);
  assert.match(formatPayload(before), /^\| Engine payload \| MiB \|\n\|---\|---:\|\n\| Codex CLI binary \| 0\.0 \|/u);

  await pruneProductionDependencies(root);
  await pruneCodexPlatformPackages(root);
  const after = await measurePayload(root);
  assert.equal(after.total, before.total - 150 - 85 - 1000);
  assert.deepEqual(payloadBudgetProblems(after), []);
});

test("the release payload no longer contains the Codex binary; the launcher stays", async t => {
  const root = await fixture(t);
  // A copy nested under another package (codex-acp also depends on @openai/codex) goes too.
  const nested = "node_modules/@agentclientprotocol/codex-acp/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex";
  await mkdir(dirname(join(root, nested)), { recursive: true });
  await writeFile(join(root, nested), "x".repeat(400));
  assert.deepEqual(await pruneCodexPlatformPackages(root), {
    packages: ["node_modules/@agentclientprotocol/codex-acp/node_modules/@openai/codex-linux-x64", "node_modules/@openai/codex-darwin-arm64"],
    files: 2, bytes: 1400,
  });
  const files = await listFiles(root);
  assert.deepEqual(files.filter(isCodexPlatformPackageFile), []);
  assert(!files.some(path => /@openai\/codex-(?:darwin|linux|win32)-/u.test(path)), "no Codex platform package folder is left");
  assert(files.includes("node_modules/@openai/codex/bin/codex.js") && files.includes("node_modules/@openai/codex/package.json"),
    "the small launcher stays; the engine points it at the downloaded platform package");
  const payload = await measurePayload(root);
  assert.equal(payload.categories["Codex CLI binary"], 0);
  assert.deepEqual(payloadBudgetProblems({ ...payload, categories: { ...payload.categories, "Dependency source maps": 0, "Dependency declarations": 0 } }), []);
  for (const path of ["node_modules/@openai/codex/bin/codex.js", "node_modules/@openai/codex-sdk/index.js", "node_modules/@agentclientprotocol/codex-acp/dist/index.js"]) {
    assert.equal(isCodexPlatformPackageFile(path), false, path);
  }
});

test("a plugin whose setup chunks copy the engine graph is over budget", async t => {
  const root = await fixture(t);
  await pruneProductionDependencies(root);
  await pruneCodexPlatformPackages(root);
  const payload = await measurePayload(root);
  assert.deepEqual(payloadBudgetProblems(payload, { ...PAYLOAD_BUDGET, setupChunkBytes: 100 }), [
    "dist/extensions/a2a/.setup: 700 bytes, over the 100-byte plugin setup budget; import engine code through branch/plugin-sdk",
  ]);
  assert.equal(PAYLOAD_BUDGET.setupChunkBytes, 16 * 1024 * 1024);
});

test("the release build prunes the engine deployment and enforces the payload budget before archiving", async () => {
  const source = await readFile(join(here, "release-build.mjs"), "utf8");
  const deploy = source.indexOf("productionDeployArguments(deployment");
  const prune = source.indexOf("pruneProductionDependencies(deployment)");
  const codex = source.indexOf("pruneCodexPlatformPackages(deployment)");
  const budget = source.indexOf("payloadBudgetProblems(payload)");
  const archive = source.indexOf("makeComponentRelease({");
  assert(deploy > 0 && prune > deploy && codex > prune && budget > codex && archive > budget,
    "Engine deploy, prune (dependency files, then Codex), budget and archive run in that order");
  assert.equal(PAYLOAD_BUDGET.removed.includes("Codex CLI binary"), true, "a returning Codex binary fails the release build");
  assert.match(source, /"node_modules\/@openai\/codex\/bin\/codex\.js"/u, "the release still asserts the Codex launcher ships");
});
