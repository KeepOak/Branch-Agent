// node --test scripts/check-packaged-no-key-plugin.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/check-packaged-no-key-plugin.mjs");

function run({ env = {}, cwd = ROOT } = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    windowsHide: true,
  });
}

test("fails closed when neither ENGINE_ROOT nor PLUGIN_IDS_JSON is set", () => {
  const stripped = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== "ENGINE_ROOT" && k !== "PLUGIN_IDS_JSON"),
    ),
    encoding: "utf8",
    windowsHide: true,
  });
  assert.notEqual(stripped.status, 0);
  assert.match(stripped.stderr, /set ENGINE_ROOT or PLUGIN_IDS_JSON/);
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
    const result2 = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([k]) => k !== "PLUGIN_IDS_JSON"),
        ),
        ENGINE_ROOT: root,
      },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result2.status, 0, result2.stderr);
    assert.match(result2.stdout, /ok \(llama-cpp present\)/);
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
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([k]) => k !== "PLUGIN_IDS_JSON"),
        ),
        ENGINE_ROOT: root,
      },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required plugin "llama-cpp"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("engine package.json ships llama-cpp in the stock dist (no files exclusion)", async () => {
  const { readFile } = await import("node:fs/promises");
  const packageJson = JSON.parse(
    await readFile(join(ROOT, "engine/package.json"), "utf8"),
  );
  const files = packageJson.files ?? [];
  assert.equal(
    files.includes("!dist/extensions/llama-cpp/**"),
    false,
    'engine/package.json must not exclude dist/extensions/llama-cpp (FreeModelSetup / #1090 needs it stock)',
  );
  // Peer local providers already ship; keep the contract explicit.
  for (const id of ["ollama", "lmstudio", "vllm", "sglang"]) {
    assert.equal(
      files.includes(`!dist/extensions/${id}/**`),
      false,
      `stock local provider ${id} must remain packaged`,
    );
  }
});
