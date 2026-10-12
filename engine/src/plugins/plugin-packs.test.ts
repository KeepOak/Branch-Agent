// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tests/hermes_cli/test_plugin_packs.py (atlas TOOLS-0027, parse/validate/load tests)
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  loadPack,
  PackError,
  packEntryInstallIdentifier,
  parsePack,
  sanitizedEntryConfig,
  validateConfigSeed,
} from "./plugin-packs.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function packYaml(overrides: Record<string, unknown> = {}): string {
  return stringify({
    name: "voice-pack",
    description: "test pack",
    author: "hyper",
    version: "1.0.0",
    plugins: [
      { repo: "owner/tts-plugin", ref: SHA_A },
      { name: "index-plugin", ref: SHA_B },
    ],
    ...overrides,
  });
}

function packErrorMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PackError);
    return (error as Error).message;
  }
  throw new Error("expected PackError");
}

async function asyncPackErrorMessage(run: () => Promise<unknown>): Promise<string> {
  const error = await run().then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(PackError);
  return (error as Error).message;
}

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("plugin packs parse and validate", () => {
  it("test_parse_pack_happy_path", () => {
    const pack = parsePack(packYaml());
    expect(pack.name).toBe("voice-pack");
    expect(pack.author).toBe("hyper");
    expect(pack.plugins).toHaveLength(2);
    expect(pack.plugins[0]?.repo).toBe("owner/tts-plugin");
    expect(pack.plugins[0]?.ref).toBe(SHA_A);
    expect(pack.plugins[1]?.name).toBe("index-plugin");
  });

  it("test_parse_pack_accepts_nested_pack_meta_and_source_alias", () => {
    const pack = parsePack(
      stringify({
        pack: { name: "nested", version: "2.0.0" },
        plugins: [{ source: "github:owner/repo", version: SHA_A, subdir: "sub/dir" }],
      }),
    );
    expect(pack.name).toBe("nested");
    expect(pack.version).toBe("2.0.0");
    expect(pack.plugins[0]?.repo).toBe("owner/repo");
    expect(pack.plugins[0]?.subdir).toBe("sub/dir");
    expect(pack.plugins[0] && packEntryInstallIdentifier(pack.plugins[0])).toBe(
      "owner/repo/sub/dir",
    );
  });

  it.each(["main", "v1.2.0", "a".repeat(39), "a".repeat(41), "", null])(
    "test_parse_pack_rejects_non_sha_refs_naming_the_entry %s",
    (badRef) => {
      const text = stringify({ name: "p", plugins: [{ repo: "owner/repo", ref: badRef }] });
      const message = packErrorMessage(() => parsePack(text));
      expect(message).toContain("40-character");
      expect(message).toContain("owner/repo");
    },
  );

  it("test_parse_pack_normalizes_ref_to_lowercase", () => {
    const text = stringify({ name: "p", plugins: [{ repo: "o/r", ref: "A".repeat(40) }] });
    expect(parsePack(text).plugins[0]?.ref).toBe("a".repeat(40));
  });

  it.each([
    ["[]", "mapping"],
    ["name: p", "plugins"],
    ["name: p\nplugins: []", "plugins"],
    ["plugins:\n  - repo: o/r\n    ref: " + SHA_A, "name"],
    ["name: p\nplugins:\n  - ref: " + SHA_A, "either 'name'"],
    ["name: p\nplugins:\n  - not-a-mapping", "mapping"],
    ["{", "YAML"],
  ])("test_parse_pack_rejects_malformed_documents %#", (doc, fragment) => {
    expect(packErrorMessage(() => parsePack(doc))).toContain(fragment);
  });

  it("test_config_seed_rejects_secret_shaped_keys", () => {
    for (const key of ["api_key", "MY_TOKEN", "password", "auth_header", "private_key"]) {
      expect(
        packErrorMessage(() => validateConfigSeed("p", { [key]: "x" })).toLowerCase(),
      ).toContain("secret");
    }
  });

  it("test_config_seed_rejects_capability_and_trust_gate_keys", () => {
    for (const key of ["granted_capabilities", "capabilities_consent", "allow_tool_override"]) {
      expect(packErrorMessage(() => validateConfigSeed("p", { [key]: true }))).toContain(
        "reserved",
      );
    }
  });

  it.each([
    [{ settings: { api_key: "LEAK" } }, "secret-shaped key 'settings.api_key'"],
    [
      { security: { granted_capabilities: ["tools"] } },
      "reserved key 'security.granted_capabilities'",
    ],
    [{ profiles: [{ allow_tool_override: true }] }, "reserved key 'profiles.allow_tool_override'"],
  ])("test_config_seed_rejects_forbidden_keys_at_any_depth %#", (seed, fragment) => {
    expect(packErrorMessage(() => validateConfigSeed("p", seed))).toContain(fragment);
    expect(validateConfigSeed("p", { settings: { voice: "nova", tags: ["a"] } })).toEqual({
      settings: { voice: "nova", tags: ["a"] },
    });
  });

  it("test_sanitized_entry_config_strips_forbidden_keys_at_any_depth", () => {
    const entry = {
      smtp: { host: "mail.example", password: "hunter2" },
      rules: [{ name: "r1", auth_token: "t" }],
      voice: "nova",
    };
    expect(sanitizedEntryConfig(entry)).toEqual({
      smtp: { host: "mail.example" },
      rules: [{ name: "r1" }],
      voice: "nova",
    });
  });

  it("test_parse_pack_validates_config_section", () => {
    const bad = packYaml({ config: { "tts-plugin": { granted_capabilities: ["tools"] } } });
    expect(() => parsePack(bad)).toThrow(PackError);
    const ok = parsePack(packYaml({ config: { "tts-plugin": { voice: "nova" } } }));
    expect(ok.config["tts-plugin"]).toEqual({ voice: "nova" });
  });
});

describe("plugin packs load", () => {
  it("test_load_pack_rejects_insecure_url_schemes", async () => {
    expect(await asyncPackErrorMessage(() => loadPack("http://example.com/pack.yaml"))).toContain(
      "https",
    );
  });

  it("test_load_pack_reads_local_file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-plugin-pack-"));
    tempDirs.push(dir);
    const file = path.join(dir, "branch-pack.yaml");
    await fs.writeFile(file, packYaml(), "utf8");
    expect((await loadPack(file)).name).toBe("voice-pack");
  });

  it("test_load_pack_missing_file_errors", async () => {
    const missing = path.join(os.tmpdir(), "branch-plugin-pack-missing", "pack.yaml");
    expect(await asyncPackErrorMessage(() => loadPack(missing))).toContain("not found");
  });
});
