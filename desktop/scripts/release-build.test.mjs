import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { adoptSharedEngineDist } from "./release-build.mjs";

async function withScratch(body) {
  const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? process.env.BRANCH_RELEASE_TEST_TEMP ?? tmpdir(), "release-build-"));
  try { await body(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("adoptSharedEngineDist copies a matching prebuilt dist and rejects a different commit", async () => {
  await withScratch(async root => {
    const source = join(root, "shared");
    const destination = join(root, "engine", "dist");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "build-info.json"), `${JSON.stringify({ commit: "a".repeat(40), version: "1.0.0" }, null, 2)}\n`);
    await writeFile(join(source, "entry.js"), "export {}\n");
    await adoptSharedEngineDist(source, destination, { commit: "a".repeat(40) });
    assert.equal(JSON.parse(await readFile(join(destination, "build-info.json"), "utf8")).commit, "a".repeat(40));
    assert.equal(await readFile(join(destination, "entry.js"), "utf8"), "export {}\n");
    await writeFile(join(source, "build-info.json"), `${JSON.stringify({ commit: "b".repeat(40), version: "1.0.0" }, null, 2)}\n`);
    await assert.rejects(() => adoptSharedEngineDist(source, destination, { commit: "a".repeat(40) }), /Shared engine build differs from source freeze/);
  });
});

test("component-release archives the shared engine dist as a tarball before upload", async () => {
  const workflow = await readFile(resolve(import.meta.dirname, "../../.github/workflows/component-release.yml"), "utf8");
  assert.match(workflow, /tar -C "\$\{\{ runner\.temp \}\}\/shared-engine" -h -czf "\$\{\{ runner\.temp \}\}\/shared-engine\.tar\.gz" \./);
  assert.match(workflow, /test -f shared-engine\/postinstall-inventory\.json/);
  assert.match(workflow, /needs: \[identity, engine, window\]/);
  assert.doesNotMatch(workflow, /artifacts\/\$artifact\/zip/);
  assert.match(workflow, /cd "\$RUNNER_TEMP"/);
  assert.match(workflow, /tar -xzf shared-engine\.tar\.gz -C shared-engine/);
  assert.match(workflow, /test -f shared-engine\/build-info\.json/);
  assert.match(workflow, /shared-engine\.tar\.gz/);
});
