// node --test scripts/check-packaged-no-key-plugin.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  evaluatePackageFiles,
  excludedExtensionIds,
} from "./check-packaged-no-key-plugin.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/check-packaged-no-key-plugin.mjs");

function strippedEnv(extra = {}) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) =>
          k !== "ENGINE_ROOT" &&
          k !== "PLUGIN_IDS_JSON" &&
          k !== "PACKAGE_JSON",
      ),
    ),
    ...extra,
  };
}

function run({ env = {}, cwd = ROOT } = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    env: strippedEnv(env),
    encoding: "utf8",
    windowsHide: true,
  });
}

test("evaluatePackageFiles fails when llama-cpp is pack-excluded", () => {
  const result = evaluatePackageFiles([
    "dist/**",
    "!dist/extensions/llama-cpp/**",
    "!dist/extensions/qa-lab/**",
  ]);
  assert.equal(result.ok, false);
  assert.match(result.message, /excludes required plugin "llama-cpp"/);
});

test("evaluatePackageFiles passes when llama-cpp is not excluded", () => {
  const files = [
    "dist/**",
    "!dist/extensions/qa-lab/**",
    "!dist/extensions/ollama-extra/**",
  ];
  const result = evaluatePackageFiles(files);
  assert.equal(result.ok, true);
  assert.deepEqual([...excludedExtensionIds(files)].sort(), [
    "ollama-extra",
    "qa-lab",
  ]);
});

test("PACKAGE_JSON fails when files exclude llama-cpp", async () => {
  const dir = await mkdtemp(join(tmpdir(), "packaged-no-key-pkg-"));
  try {
    const pkg = join(dir, "package.json");
    await writeFile(
      pkg,
      JSON.stringify({
        files: ["dist/**", "!dist/extensions/llama-cpp/**"],
      }),
    );
    const result = run({ env: { PACKAGE_JSON: pkg } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /excludes required plugin "llama-cpp"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PACKAGE_JSON passes when llama-cpp is not excluded", async () => {
  const dir = await mkdtemp(join(tmpdir(), "packaged-no-key-pkg-"));
  try {
    const pkg = join(dir, "package.json");
    await writeFile(
      pkg,
      JSON.stringify({
        files: ["dist/**", "!dist/extensions/qa-lab/**"],
      }),
    );
    const result = run({ env: { PACKAGE_JSON: pkg } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /not pack-excluded/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("default (no env) checks engine/package.json and passes when llama-cpp ships", () => {
  const result = run({});
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /not pack-excluded/);
});

test("engine package.json ships llama-cpp in the stock dist (no files exclusion)", async () => {
  const packageJson = JSON.parse(
    await readFile(join(ROOT, "engine/package.json"), "utf8"),
  );
  const files = packageJson.files ?? [];
  assert.equal(
    files.includes("!dist/extensions/llama-cpp/**"),
    false,
    "engine/package.json must not exclude dist/extensions/llama-cpp (FreeModelSetup / #1090 needs it stock)",
  );
  for (const id of ["ollama", "lmstudio", "vllm", "sglang"]) {
    assert.equal(
      files.includes(`!dist/extensions/${id}/**`),
      false,
      `stock local provider ${id} must remain packaged`,
    );
  }
});

test("PLUGIN_IDS_JSON passes when llama-cpp is listed", () => {
  const result = run({
    env: { PLUGIN_IDS_JSON: JSON.stringify(["anthropic", "llama-cpp", "ollama"]) },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok \(llama-cpp present\)/);
});

test("PLUGIN_IDS_JSON fails when llama-cpp is missing", () => {
  const result = run({
    env: { PLUGIN_IDS_JSON: JSON.stringify(["anthropic", "ollama", "openai"]) },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required plugin "llama-cpp"/);
});

test("ENGINE_ROOT passes when extensions include llama-cpp manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "packaged-no-key-"));
  try {
    await mkdir(join(root, "extensions", "llama-cpp"), { recursive: true });
    await mkdir(join(root, "extensions", "ollama"), { recursive: true });
    await writeFile(
      join(root, "extensions", "llama-cpp", "branch.plugin.json"),
      JSON.stringify({ id: "llama-cpp" }),
    );
    await writeFile(
      join(root, "extensions", "ollama", "branch.plugin.json"),
      JSON.stringify({ id: "ollama" }),
    );
    const result = run({ env: { ENGINE_ROOT: root } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ok \(llama-cpp present\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ENGINE_ROOT fails when llama-cpp plugin dir is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "packaged-no-key-"));
  try {
    await mkdir(join(root, "extensions", "ollama"), { recursive: true });
    await writeFile(
      join(root, "extensions", "ollama", "branch.plugin.json"),
      JSON.stringify({ id: "ollama" }),
    );
    const result = run({ env: { ENGINE_ROOT: root } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required plugin "llama-cpp"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
