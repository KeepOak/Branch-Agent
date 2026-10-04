import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { makeComponentRelease } from "./make-component-release.mjs";
import { extractProductionArchive, productionDeployArguments, productionDeployEnvironment } from "./release-production-layout.mjs";
import { preparePnpm, run } from "../../scripts/feature-batch-ci-runtime.mjs";

const library = "@fixture/library-with-a-long-production-dependency-name";
const transitive = "@fixture/transitive-with-a-long-production-dependency-name";
const leaf = "dependency-payload-with-a-long-but-valid-ustar-file-name-and-unchanged-content-0123456789.txt";
const member = `assets/native/${leaf}`;
const commit = "a".repeat(40);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

/** Tarballs live inside the project: the deploy refuses lockfile paths that leave the workspace. */
async function createPackedDependency(root, vendor, pnpm, name, body, extra = {}) {
  const folder = join(root, name === transitive ? "transitive" : "library"); await mkdir(folder);
  await writeFile(join(folder, "package.json"), JSON.stringify({ name, version: "1.0.0", main: "index.cjs", ...extra }));
  await writeFile(join(folder, "index.cjs"), body);
  if (name === library) { await mkdir(join(folder, "assets/native"), { recursive: true }); await writeFile(join(folder, member), "whole production payload\n"); }
  await run(pnpm, ["pack", "--pack-destination", vendor], folder);
  const filename = (await readdir(vendor)).find(value => value.endsWith(".tgz") && value.includes(name === transitive ? "transitive-with" : "library-with"));
  assert(filename, "Fixture tarball missing"); return join(vendor, filename);
}

/** The root depends only on the library; the library's own dependency is never a root dependency. */
async function createProject(root, libraryTar) {
  const project = join(root, "project"); await mkdir(join(project, "dist"), { recursive: true });
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "branch", version: "1.0.0", bin: { branch: "branch.mjs" },
    files: ["branch.mjs", "dist"], dependencies: { [library]: `file:${libraryTar}` } }));
  await writeFile(join(project, "pnpm-workspace.yaml"), "packages:\n  - .\n");
  await writeFile(join(project, "branch.mjs"), "#!/usr/bin/env node\nexport {};\n"); await chmod(join(project, "branch.mjs"), 0o755);
  await writeFile(join(project, "dist/entry.js"), "export {};\n");
  await writeFile(join(project, "dist/build-info.json"), JSON.stringify({ commit }));
  return project;
}

function resolutionProof(folder) {
  const source = `const {createRequire}=require("node:module"); const {readFileSync}=require("node:fs"); const requireHere=createRequire(require("node:path").join(process.argv[1],"package.json")); const loaded=requireHere(${JSON.stringify(library)}); const file=requireHere.resolve(${JSON.stringify(`${library}/${member}`)}); console.log(JSON.stringify({loaded,payload:readFileSync(file,"utf8")}));`;
  return JSON.parse(execFileSync(process.execPath, ["-e", source, folder], { encoding: "utf8", windowsHide: true, timeout: 5000, stdio: ["ignore", "pipe", "pipe"] }));
}

async function links(folder) {
  const found = [];
  for (const name of await readdir(folder)) {
    const path = join(folder, name), info = await lstat(path);
    if (info.isSymbolicLink()) found.push(path); else if (info.isDirectory()) found.push(...await links(path));
  }
  return found;
}

async function archiveAndExtract(root, engine, label) {
  const window = join(root, `${label}-window`); await mkdir(window); await writeFile(join(window, "index.html"), "<!doctype html>");
  const output = join(root, `${label}-assets`);
  const manifest = await makeComponentRelease({ version: "1.0.0", sourceCommit: commit, tag: "v1.0.0", engine, window, output, platform: process.platform, arch: process.arch });
  const reader = await import(pathToFileURL(join(resolve(process.env.BRANCH_DESKTOP_TEST_DIST), "component-update-archive.js")));
  const archive = join(output, `branch-engine-1.0.0-${process.platform}-${process.arch}.tar.gz`);
  const extracted = await extractProductionArchive(archive, manifest.components.engine, commit, join(root, `${label}-extracted`), reader.extractComponentArchive);
  return { manifest, archive, extracted, reader };
}

test("production deploy installs a hoisted real-file tree from the frozen lock without changing reviewed exceptions", () => {
  const flags = ["--config.minimum-release-age-exclude=reviewed@1.0.0"];
  const args = productionDeployArguments("deployment", flags);
  const parent = { EXISTING: "preserved", PNPM_CONFIG_VIRTUAL_STORE_DIR_MAX_LENGTH: "120" };
  assert.deepEqual(productionDeployEnvironment(parent), { EXISTING: "preserved", PNPM_CONFIG_VIRTUAL_STORE_DIR_MAX_LENGTH: "60" });
  assert.equal(parent.PNPM_CONFIG_VIRTUAL_STORE_DIR_MAX_LENGTH, "120", "Parent environment must remain unchanged");
  assert(args.includes(flags[0])); assert(args.includes("--prod"));
  assert(args.includes("--config.node-linker=hoisted")); assert(args.includes("--config.inject-workspace-packages=true"));
  assert(!args.includes("--legacy"), "The legacy deploy hoists into the source workspace instead of the deployment");
  assert.equal(args.at(-1), "deployment"); assert(!args.some(value => /ignore-scripts|no-frozen/.test(value)));
});

test("extracted release archive resolves non-root dependencies only with the hoisted production deploy", async () => {
  const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? process.env.BRANCH_RELEASE_TEST_TEMP ?? tmpdir(), "release-layout-fixture-"));
  try {
    const pnpm = await preparePnpm(root);
    const vendor = join(root, "project", "vendor"); await mkdir(vendor, { recursive: true });
    const transitiveTar = await createPackedDependency(root, vendor, pnpm, transitive, 'module.exports = "transitive identity preserved";\n');
    const libraryTar = await createPackedDependency(root, vendor, pnpm, library, `module.exports = { transitive: require(${JSON.stringify(transitive)}) };\n`,
      { dependencies: { [transitive]: `file:${transitiveTar}` } });
    const project = await createProject(root, libraryTar);
    await run(pnpm, ["install", "--ignore-scripts"], project);
    const sourceLock = digest(await readFile(join(project, "pnpm-lock.yaml")));
    const expected = { loaded: { transitive: "transitive identity preserved" }, payload: "whole production payload\n" };

    // Negative control: the previous isolated deploy works in place but not after the archive materializes its links.
    const isolated = join(root, "isolated-deployment");
    await run(pnpm, ["--filter", "branch", "deploy", "--prod", "--legacy", isolated], project, productionDeployEnvironment(process.env));
    assert.deepEqual(resolutionProof(isolated), expected);
    const control = await archiveAndExtract(root, isolated, "isolated");
    assert.throws(() => resolutionProof(control.extracted), /Cannot find module/, "Materialized isolated layout must lose its non-root dependency");

    const portable = join(root, "portable-deployment");
    await run(pnpm, productionDeployArguments(portable, []), project, productionDeployEnvironment(process.env));
    assert.deepEqual(await links(join(portable, "node_modules")).then(found => found.filter(path => !path.includes(".bin"))), [], "Hoisted deployment must contain real files only");
    assert.deepEqual(resolutionProof(portable), expected);
    assert.equal(digest(await readFile(join(project, "pnpm-lock.yaml"))), sourceLock, "Production layout must not rewrite the source lock");
    const { manifest, archive, extracted, reader } = await archiveAndExtract(root, portable, "portable");
    assert.deepEqual(resolutionProof(extracted), expected);
    assert.deepEqual(await readFile(join(extracted, "dist/build-info.json")), await readFile(join(portable, "dist/build-info.json")));
    await assert.rejects(extractProductionArchive(archive, { ...manifest.components.engine, sha256: "f".repeat(64) }, commit, join(root, "corrupt"), reader.extractComponentArchive), /differs from its manifest/);
    await assert.rejects(extractProductionArchive(archive, manifest.components.engine, "b".repeat(40), join(root, "wrong-source"), reader.extractComponentArchive), /different source identity/);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
