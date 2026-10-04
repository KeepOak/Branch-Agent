import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { makeComponentRelease } from "./make-component-release.mjs";
import { extractProductionArchive, productionDeployArguments, productionDeployEnvironment } from "./release-production-layout.mjs";
import { preparePnpm, run } from "../../scripts/feature-batch-ci-runtime.mjs";

const library = "@fixture/library-with-a-long-production-dependency-name";
const peer = "@fixture/peer-with-a-long-production-dependency-name";
const leaf = "dependency-payload-with-a-long-but-valid-ustar-file-name-and-unchanged-content-0123456789.txt";
const member = `assets/native/${leaf}`;
const commit = "a".repeat(40);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function createPackedDependency(root, pnpm, name, body, extra = {}) {
  const folder = join(root, name === peer ? "peer" : "library"); await mkdir(folder);
  await writeFile(join(folder, "package.json"), JSON.stringify({ name, version: "1.0.0", main: "index.cjs", ...extra }));
  await writeFile(join(folder, "index.cjs"), body);
  if (name === library) { await mkdir(join(folder, "assets/native"), { recursive: true }); await writeFile(join(folder, member), "whole production payload\n"); }
  await run(pnpm, ["pack", "--pack-destination", root], folder);
  const filename = (await readdir(root)).find(value => value.endsWith(".tgz") && value.includes(name === peer ? "peer-with" : "library-with"));
  assert(filename, "Fixture tarball missing"); return join(root, filename);
}

async function createProject(root, libraryTar, peerTar) {
  const project = join(root, "project"); await mkdir(join(project, "dist"), { recursive: true });
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "branch", version: "1.0.0", bin: { branch: "branch.mjs" },
    files: ["branch.mjs", "dist"], dependencies: { [library]: `file:${libraryTar}`, [peer]: `file:${peerTar}` } }));
  await writeFile(join(project, "pnpm-workspace.yaml"), "packages:\n  - .\n");
  await writeFile(join(project, "branch.mjs"), "#!/usr/bin/env node\nexport {};\n"); await chmod(join(project, "branch.mjs"), 0o755);
  await writeFile(join(project, "dist/entry.js"), "export {};\n");
  await writeFile(join(project, "dist/build-info.json"), JSON.stringify({ commit }));
  return project;
}

function resolutionProof(folder) {
  const source = `const {createRequire}=require("node:module"); const {readFileSync}=require("node:fs"); const requireHere=createRequire(require("node:path").join(process.argv[1],"package.json")); const loaded=requireHere(${JSON.stringify(library)}); const file=requireHere.resolve(${JSON.stringify(`${library}/${member}`)}); console.log(JSON.stringify({loaded,payload:readFileSync(file,"utf8")}));`;
  return JSON.parse(execFileSync(process.execPath, ["-e", source, folder], { encoding: "utf8", windowsHide: true, timeout: 5000 }));
}

test("production-only directory encoding changes no dependency defaults or reviewed install exceptions", () => {
  const flags = ["--config.minimum-release-age-exclude=reviewed@1.0.0"];
  const args = productionDeployArguments("deployment", flags);
  const parent = { EXISTING: "preserved", PNPM_CONFIG_VIRTUAL_STORE_DIR_MAX_LENGTH: "120" };
  assert.deepEqual(productionDeployEnvironment(parent), { EXISTING: "preserved", PNPM_CONFIG_VIRTUAL_STORE_DIR_MAX_LENGTH: "60" });
  assert.equal(parent.PNPM_CONFIG_VIRTUAL_STORE_DIR_MAX_LENGTH, "120", "Parent environment must remain unchanged");
  assert(args.includes(flags[0])); assert(args.includes("--prod")); assert(args.includes("--legacy"));
  assert.equal(args.at(-1), "deployment"); assert(!args.some(value => /ignore-scripts|node-linker|no-frozen/.test(value)));
});

test("real pinned pnpm long peer topology overflows at120 but archives/extracts/resolves every byte at60", async () => {
  const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? process.env.BRANCH_RELEASE_TEST_TEMP ?? tmpdir(), "release-layout-fixture-"));
  try {
    const pnpm = await preparePnpm(root);
    const peerTar = await createPackedDependency(root, pnpm, peer, 'module.exports = "peer identity preserved";\n');
    const libraryTar = await createPackedDependency(root, pnpm, library, `module.exports = { peer: require(${JSON.stringify(peer)}) };\n`, { peerDependencies: { [peer]: "*" } });
    const project = await createProject(root, libraryTar, peerTar);
    await run(pnpm, ["install", "--ignore-scripts"], project);
    const sourceLock = digest(await readFile(join(project, "pnpm-lock.yaml")));
    const long = join(root, "long-deployment"), portable = join(root, "portable-deployment");
    await run(pnpm, productionDeployArguments(long, []), project, { ...process.env, PNPM_CONFIG_VIRTUAL_STORE_DIR_MAX_LENGTH: "120" });
    await run(pnpm, productionDeployArguments(portable, []), project, productionDeployEnvironment(process.env));
    assert((await readdir(join(long, "node_modules/.pnpm"))).some(name => Buffer.byteLength(name) > 60), "Negative control must exercise a real long native directory");
    assert((await readdir(join(portable, "node_modules/.pnpm"))).every(name => Buffer.byteLength(name) <= 60), "Portable deployment must use the short directory encoding");
    assert.deepEqual(resolutionProof(long), { loaded: { peer: "peer identity preserved" }, payload: "whole production payload\n" });
    assert.deepEqual(resolutionProof(portable), resolutionProof(long));
    assert.equal(digest(await readFile(join(project, "pnpm-lock.yaml"))), sourceLock, "Production layout must not rewrite the source lock");
    const window = join(root, "window"); await mkdir(window); await writeFile(join(window, "index.html"), "<!doctype html>");
    const options = { version: "1.0.0", sourceCommit: commit, tag: "v1.0.0", window, platform: process.platform, arch: process.arch };
    await assert.rejects(makeComponentRelease({ ...options, engine: long, output: join(root, "long-assets") }), error => {
      assert.match(error.message, /Path exceeds ustar format: node_modules\/.pnpm\//);
      assert(error.message.includes("UTF-8 bytes")); console.log(`Observed native overflow member: ${error.message}`); return true;
    });
    const output = join(root, "portable-assets");
    const manifest = await makeComponentRelease({ ...options, engine: portable, output });
    const reader = await import(pathToFileURL(join(resolve(process.env.BRANCH_DESKTOP_TEST_DIST), "component-update-archive.js")));
    const archive = join(output, `branch-engine-1.0.0-${process.platform}-${process.arch}.tar.gz`);
    const extracted = await extractProductionArchive(archive, manifest.components.engine, commit, join(root, "extracted"), reader.extractComponentArchive);
    assert.deepEqual(resolutionProof(extracted), resolutionProof(portable));
    assert.deepEqual(await readFile(join(extracted, "dist/build-info.json")), await readFile(join(portable, "dist/build-info.json")));
    await assert.rejects(extractProductionArchive(archive, { ...manifest.components.engine, sha256: "f".repeat(64) }, commit, join(root, "corrupt"), reader.extractComponentArchive), /differs from its manifest/);
    await assert.rejects(extractProductionArchive(archive, manifest.components.engine, "b".repeat(40), join(root, "wrong-source"), reader.extractComponentArchive), /different source identity/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
