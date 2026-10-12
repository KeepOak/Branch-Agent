import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareMetadata,
  dedupeMetadata,
  readBundledMetadata,
  removeBundledMetadata,
} from "./lib/model-metadata-dedupe.js";

const engine = fileURLToPath(new URL("../", import.meta.url));
const scratch = path.join(
  os.tmpdir(),
  "Codex-session-files",
  "branch-feature-third-20261003",
  "models",
);
const roots: string[] = [];
type Metadata = Record<string, unknown>;

function fixture(providers: Record<string, Metadata[]>, upstream: unknown = {}) {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, "metadata-fixture-"));
  roots.push(root);
  const directory = path.join(root, "extensions", "fixture");
  fs.mkdirSync(directory, { recursive: true });
  const manifestPath = path.join(directory, "branch.plugin.json");
  const manifest = {
    id: "fixture",
    providers: Object.keys(providers),
    auth: [{ type: "api-key", envVars: ["FIXTURE_API_KEY"] }],
    contracts: { retained: "contract" },
    modelPricing: { providers: { openai: { source: "provider" } } },
    modelCatalog: {
      discovery: Object.fromEntries(Object.keys(providers).map((id) => [id, "static"])),
      providers: Object.fromEntries(
        Object.entries(providers).map(([id, models]) => [
          id,
          { api: "openai-completions", models },
        ]),
      ),
    },
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const snapshotPath = path.join(root, "litellm.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(upstream));
  return { root, manifestPath, snapshotPath, manifest };
}

function cli(root: string, snapshotPath: string, input = "") {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/tsx.mjs",
      "scripts/model-metadata-dedupe.mts",
      "--root",
      root,
      "--litellm",
      snapshotPath,
    ],
    {
      cwd: engine,
      input,
      encoding: "utf8",
      windowsHide: true,
      timeout: 120_000,
    },
  );
}

async function run(f: ReturnType<typeof fixture>, answers: string[] = []) {
  const output: string[] = [];
  const prompts: string[] = [];
  const result = await dedupeMetadata({
    rootDir: f.root,
    snapshotPath: f.snapshotPath,
    output: (text) => output.push(text),
    answer: async (prompt) => {
      prompts.push(prompt);
      return answers.shift() ?? "";
    },
  });
  return { ...result, output: output.join("\n"), prompts };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== path.resolve(scratch) ||
      !path.basename(root).startsWith("metadata-fixture-")
    ) {
      throw new Error(`Unexpected fixture cleanup target: ${root}`);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("bundled metadata dedupe through native manifests", () => {
  it("includes real runtime and refreshable bundled declarations without overlays", async () => {
    const f = fixture(
      {
        openai: [{ id: "runtime", contextWindow: 1 }],
        anthropic: [{ id: "refresh", contextWindow: 1 }],
      },
      {
        runtime: { litellm_provider: "openai", max_input_tokens: 2 },
        refresh: { litellm_provider: "anthropic", max_input_tokens: 2 },
      },
    );
    const manifest = JSON.parse(fs.readFileSync(f.manifestPath, "utf8"));
    manifest.modelCatalog.discovery = { openai: "runtime", anthropic: "refreshable" };
    fs.writeFileSync(f.manifestPath, JSON.stringify(manifest));
    const result = await run(f);
    expect(result.compared).toBe(2);
    expect(result.prompts.map((prompt) => prompt.match(/'([^']+)'/)?.[1])).toEqual([
      "anthropic/refresh",
      "openai/runtime",
    ]);
  });

  it("uses source lexical sorting for mixed-case literal model identities", () => {
    const f = fixture({ openai: [{ id: "zebra" }, { id: "Alpha" }, { id: "apple" }] });
    const result = compareMetadata(readBundledMetadata(f.root), {
      zebra: { litellm_provider: "openai" },
      Alpha: { litellm_provider: "openai" },
      apple: { litellm_provider: "openai" },
    });
    expect(result.map((row) => row.bundled.ref)).toEqual([
      "openai/Alpha",
      "openai/apple",
      "openai/zebra",
    ]);
  });

  it("compares sorted common refs and leaves source-only rows untouched", async () => {
    const f = fixture(
      {
        openai: [
          { id: "z", contextWindow: 1 },
          { id: "a", contextWindow: 1 },
          { id: "native-only" },
        ],
      },
      {
        z: { litellm_provider: "openai", max_input_tokens: 2 },
        a: { litellm_provider: "openai", max_input_tokens: 2 },
        external: { litellm_provider: "openai" },
        external_only_scalar: 123,
      },
    );
    const before = fs.readFileSync(f.manifestPath, "utf8");
    const result = await run(f);
    expect(result.compared).toBe(2);
    expect(result.prompts.map((prompt) => prompt.match(/'([^']+)'/)?.[1])).toEqual([
      "openai/a",
      "openai/z",
    ]);
    expect(result.output).not.toContain("native-only");
    expect(fs.readFileSync(f.manifestPath, "utf8")).toBe(before);
  });

  it("skips identical metadata without prompting even when y is supplied", async () => {
    const f = fixture(
      {
        openai: [
          {
            id: "same",
            cost: { output: 2, input: 0.1, cacheRead: 0.01, cacheWrite: 0.15 },
            contextWindow: 100,
          },
        ],
      },
      {
        same: {
          max_input_tokens: 100,
          input_cost_per_token: 0.0000001,
          litellm_provider: "openai",
          output_cost_per_token: 0.000002,
          cache_read_input_token_cost: 0.00000001,
          cache_creation_input_token_cost: 0.00000015,
        },
      },
    );
    const result = await run(f, ["y"]);
    expect(result).toMatchObject({ removed: 0, compared: 1, prompts: [] });
    expect(result.output).toContain("metadata is identical");
    expect(readBundledMetadata(f.root)).toHaveLength(1);
  });

  it("shows complete context, modality, price and unmatched-field diffs", () => {
    const f = fixture({
      openai: [
        {
          id: "diff",
          contextWindow: 100,
          maxTokens: 20,
          reasoning: false,
          input: ["text"],
          cost: { input: 1 },
          compat: { supportsTools: false },
        },
      ],
    });
    const [comparison] = compareMetadata(readBundledMetadata(f.root), {
      diff: {
        litellm_provider: "openai",
        max_input_tokens: 200,
        max_output_tokens: 40,
        supports_reasoning: true,
        supports_vision: true,
        input_cost_per_token: 0.000002,
        source_only: { preserved: true },
      },
    });
    expect(comparison?.diff).toContain("--- openai/diff (Branch, prices/million tokens)");
    expect(comparison?.diff).toContain("+++ openai/diff (LiteLLM, prices/million tokens)");
    for (const field of [
      "contextWindow",
      "maxTokens",
      "input",
      "reasoning",
      "supportsTools",
      "source_only",
      '"input": 2',
    ]) {
      expect(comparison?.diff).toContain(field);
    }
    expect(comparison?.diff).not.toContain("0.000002");
  });

  it("removes only literal normalized y and keeps blank, n and yes", async () => {
    const f = fixture(
      { openai: ["a", "b", "c", "d"].map((id) => ({ id, contextWindow: 1 })) },
      Object.fromEntries(
        ["a", "b", "c", "d"].map((id) => [id, { litellm_provider: "openai", max_input_tokens: 2 }]),
      ),
    );
    const result = await run(f, ["", "n", "yes", " Y "]);
    expect(result.removed).toBe(1);
    expect(readBundledMetadata(f.root).map((row) => row.ref)).toEqual([
      "openai/a",
      "openai/b",
      "openai/c",
    ]);
  });

  it("preserves sibling providers, authentication, contracts and pricing on removal", async () => {
    const f = fixture(
      { openai: [{ id: "remove", contextWindow: 1 }, { id: "keep" }], anthropic: [{ id: "keep" }] },
      { remove: { litellm_provider: "openai", max_input_tokens: 2 } },
    );
    expect((await run(f, ["y"])).removed).toBe(1);
    const updated = JSON.parse(fs.readFileSync(f.manifestPath, "utf8"));
    expect(updated.auth).toEqual(f.manifest.auth);
    expect(updated.contracts).toEqual(f.manifest.contracts);
    expect(updated.modelPricing).toEqual(f.manifest.modelPricing);
    expect(updated.modelCatalog.providers.anthropic).toEqual(
      f.manifest.modelCatalog.providers.anthropic,
    );
    expect(readBundledMetadata(f.root).map((row) => row.ref)).toEqual([
      "openai/keep",
      "anthropic/keep",
    ]);
  });

  it("keeps provider identity and literal nested gateway IDs", () => {
    const f = fixture({
      openai: [{ id: "same" }],
      anthropic: [{ id: "same" }],
      openrouter: [{ id: "openai/same" }],
    });
    const rows = compareMetadata(readBundledMetadata(f.root), {
      same: { litellm_provider: "openai", max_input_tokens: 1 },
      "anthropic/same": { litellm_provider: "anthropic", max_input_tokens: 2 },
      "openrouter/openai/same": { litellm_provider: "openrouter", max_input_tokens: 3 },
    });
    expect(rows.map((row) => row.bundled.ref)).toEqual([
      "anthropic/same",
      "openai/same",
      "openrouter/openai/same",
    ]);
    expect(() =>
      compareMetadata(readBundledMetadata(f.root), {
        same: { litellm_provider: "openai" },
        "openai/same": {},
      }),
    ).toThrow("Ambiguous LiteLLM");
  });

  it("does not discard unknown or colliding metadata fields", () => {
    const f = fixture({ openai: [{ id: "fields", contextWindow: 10 }] });
    const snapshot = JSON.parse(
      '{"fields":{"litellm_provider":"openai","max_input_tokens":10,"contextWindow":20,"cost":{"source":1},"input_cost_per_token":0.000001,"supports_vision":true,"supported_input_modalities":["text"],"__proto__":{"retained":true}}}',
    );
    const [comparison] = compareMetadata(readBundledMetadata(f.root), snapshot);
    for (const field of [
      "max_input_tokens",
      "contextWindow",
      "input_cost_per_token",
      "supports_vision",
      "__proto__",
      "retained",
    ]) {
      expect(comparison?.diff).toContain(field);
    }
    expect(comparison?.identical).toBe(false);
  });

  it("reports no common rows without prompting or rewriting manifests", async () => {
    const f = fixture({ openai: [{ id: "local" }] }, { remote: { litellm_provider: "openai" } });
    const before = fs.readFileSync(f.manifestPath, "utf8");
    const result = await run(f, ["y"]);
    expect(result).toMatchObject({ removed: 0, compared: 0, prompts: [] });
    expect(result.output).toContain("No common");
    expect(fs.readFileSync(f.manifestPath, "utf8")).toBe(before);
  });

  it("rejects missing or malformed local snapshots and malformed native metadata", async () => {
    const f = fixture({ openai: [{ id: "local" }] });
    fs.rmSync(f.snapshotPath);
    await expect(run(f)).rejects.toThrow("ENOENT");
    fs.writeFileSync(f.snapshotPath, "{ // JSON5 is not a LiteLLM JSON snapshot\n}");
    await expect(run(f)).rejects.toThrow();
    fs.writeFileSync(f.snapshotPath, "{}");
    fs.writeFileSync(
      f.manifestPath,
      JSON.stringify({ modelCatalog: { providers: { openai: { models: "invalid" } } } }),
    );
    await expect(run(f)).rejects.toThrow("models must be an array");
  });

  it("rejects missing or changed model entries rather than removing another row", () => {
    const f = fixture({ openai: [{ id: "local", contextWindow: 1 }] });
    const entry = readBundledMetadata(f.root)[0]!;
    const manifest = JSON.parse(fs.readFileSync(f.manifestPath, "utf8"));
    manifest.modelCatalog.providers.openai.models[0].contextWindow = 2;
    fs.writeFileSync(f.manifestPath, JSON.stringify(manifest));
    expect(() => removeBundledMetadata(entry)).toThrow("changed since comparison");
    manifest.modelCatalog.providers.openai.models = [];
    fs.writeFileSync(f.manifestPath, JSON.stringify(manifest));
    expect(() => removeBundledMetadata(entry)).toThrow("found 0");
  });

  it("reports a real filesystem removal failure without a successful count", async () => {
    const f = fixture(
      { openai: [{ id: "local", contextWindow: 1 }] },
      { local: { litellm_provider: "openai", max_input_tokens: 2 } },
    );
    const output: string[] = [];
    const result = await dedupeMetadata({
      rootDir: f.root,
      snapshotPath: f.snapshotPath,
      output: (text) => output.push(text),
      answer: async () => {
        fs.rmSync(f.manifestPath);
        fs.mkdirSync(f.manifestPath);
        return "y";
      },
    });
    expect(result).toMatchObject({ removed: 0, errors: 1 });
    expect(output.join("\n")).toContain("Could not remove openai/local");
    expect(output.join("\n")).toContain("removed 0 entries");
  });

  it.skipIf(process.platform !== "win32")(
    "reports a real Windows read-only manifest write failure",
    async () => {
      const f = fixture(
        { openai: [{ id: "local", contextWindow: 1 }] },
        { local: { litellm_provider: "openai", max_input_tokens: 2 } },
      );
      const before = fs.readFileSync(f.manifestPath, "utf8");
      const protectedFile = spawnSync("attrib.exe", ["+R", f.manifestPath], {
        encoding: "utf8",
        windowsHide: true,
      });
      expect(protectedFile.status, protectedFile.stderr).toBe(0);
      try {
        const result = await run(f, ["y"]);
        expect(result).toMatchObject({ removed: 0, errors: 1 });
        expect(result.output).toContain("Could not remove openai/local");
        expect(fs.readFileSync(f.manifestPath, "utf8")).toBe(before);
      } finally {
        const restored = spawnSync("attrib.exe", ["-R", f.manifestPath], {
          encoding: "utf8",
          windowsHide: true,
        });
        expect(restored.status, restored.stderr).toBe(0);
      }
    },
  );

  it("runs the actual CLI with default-No input and unchanged manifest bytes", () => {
    const f = fixture(
      { openai: [{ id: "local", contextWindow: 1 }] },
      { local: { litellm_provider: "openai", max_input_tokens: 2 } },
    );
    const before = fs.readFileSync(f.manifestPath, "utf8");
    const result = cli(f.root, f.snapshotPath, "\n");
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("(y/N)");
    expect(result.stdout).toContain("removed 0 entries");
    expect(fs.readFileSync(f.manifestPath, "utf8")).toBe(before);
  }, 150_000);

  it("runs the actual CLI with buffered multiple confirmations and native reread", () => {
    const f = fixture(
      {
        openai: [
          { id: "a", contextWindow: 1 },
          { id: "b", contextWindow: 1 },
        ],
      },
      {
        a: { litellm_provider: "openai", max_input_tokens: 2 },
        b: { litellm_provider: "openai", max_input_tokens: 2 },
      },
    );
    const result = cli(f.root, f.snapshotPath, "y\ny\n");
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("removed 2 entries");
    expect(readBundledMetadata(f.root)).toEqual([]);
  }, 150_000);

  it("returns actual CLI failure for missing source files", () => {
    const f = fixture({ openai: [{ id: "local" }] });
    const before = fs.readFileSync(f.manifestPath, "utf8");
    const result = cli(f.root, path.join(f.root, "missing.json"));
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Metadata dedupe failed");
    expect(result.stderr).toContain("ENOENT");
    expect(fs.readFileSync(f.manifestPath, "utf8")).toBe(before);
  }, 150_000);
});
