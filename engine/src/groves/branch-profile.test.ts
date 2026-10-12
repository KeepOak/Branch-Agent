import { link, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { readGroveManifestFile } from "./reader.js";
import { parseGroveBranchProfile } from "./schema.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

async function profileFixture(pointer?: string) {
  const root = tempDirs.make("branch-grove-profile-");
  await mkdir(join(root, "profiles"));
  const path = join(root, "branch.grove.json");
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      agent: { id: "triage" },
      ...(pointer ? { metadata: { "branch.config": pointer } } : {}),
    }),
  );
  return { root, path };
}

describe("Branch Agent profile schema", () => {
  it("rejects disabled host filesystem confinement", () => {
    const result = parseGroveBranchProfile({
      schemaVersion: 1,
      agent: { tools: { fs: { workspaceOnly: false } } },
    });

    expect(result.ok).toBe(false);
  });

  it("rejects retired heartbeat fields with a heartbeat-scoped diagnostic", () => {
    const result = parseGroveBranchProfile({
      schemaVersion: 1,
      agent: { heartbeat: { every: "30m", skipWhenBusy: true } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        path: "$.agent.heartbeat",
        message: expect.stringContaining("skipWhenBusy"),
      }),
    );
  });

  it("rejects invalid profile policy", () => {
    for (const agent of [
      { tools: { profile: "future-profile" } },
      { tools: { profile: "full" } },
      { tools: { profile: "coding" } },
      { tools: { profile: "messaging" } },
      { tools: { profile: "coding", allow: ["bundle-mcp"] } },
      { tools: { allow: ["bundle-mcp"] } },
      { tools: { allow: ["*"] } },
      { tools: { profile: "coding", allow: ["tts"] } },
      { tools: { profile: "coding", allow: ["read", "tts"] } },
      { tools: { alsoAllow: ["read"] } },
      { tools: { alsoAllow: ["group:plugins"] } },
      { tools: { alsoAllow: ["GROUP:PLUGINS"] } },
      { tools: { allow: ["read"], alsoAllow: ["write"] } },
      { memory: { search: { provider: "openai" } } },
      { memory: { search: { sources: ["sessions"] } } },
    ]) {
      expect(parseGroveBranchProfile({ schemaVersion: 1, agent }).ok).toBe(false);
    }
  });
});

describe("Branch Agent profile reader", () => {
  it.each([
    ["anchor", "agent: &agent {}", "anchors"],
    ["alias", "agent: *agent", "aliases"],
    ["tag", "agent: !!map {}", "explicit tags"],
    ["merge", "agent: { <<: {} }", "merge keys"],
  ])(
    "rejects profile YAML %s with its profile diagnostic",
    async (_label, declaration, feature) => {
      const { root, path: manifestPath } = await profileFixture();
      await writeFile(join(root, "profiles", "branch.yml"), `schemaVersion: 1\n${declaration}\n`);

      const result = await readGroveManifestFile(manifestPath);

      expect(result).toMatchObject({
        ok: false,
        diagnostics: [
          {
            level: "error",
            phase: "parse",
            path: "$",
            code: "unsupported_branch_profile_yaml_feature",
            message: `profiles/branch.yml uses ${feature}; Branch Agent profile YAML must map directly to JSON data.`,
          },
        ],
      });
    },
  );

  it.each([
    ["duplicate key", "schemaVersion: 1\nschemaVersion: 1\nagent: {}\n"],
    ["invalid syntax", "schemaVersion: 1\nagent: [\n"],
  ])("reports a profile YAML %s as a parse failure", async (_label, profile) => {
    const { root, path: manifestPath } = await profileFixture();
    await writeFile(join(root, "profiles", "branch.yml"), profile);

    const result = await readGroveManifestFile(manifestPath);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          level: "error",
          phase: "parse",
          path: "$",
          code: "invalid_branch_profile",
          message: expect.stringContaining("Could not parse profiles/branch.yml:"),
        },
      ],
    });
  });

  it("loads and integrity-binds the conventional profile", async () => {
    const root = tempDirs.make("branch-grove-profile-");
    await mkdir(join(root, "profiles"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "@acme/github-triage",
        version: "3.2.1",
        branch: { grove: "GROVE.md" },
      }),
      "utf8",
    );
    await writeFile(
      join(root, "GROVE.md"),
      ["---", "schemaVersion: 1", "agent:", "  id: triage", "---", "", "# GitHub Triage"].join(
        "\n",
      ),
      "utf8",
    );
    const profilePath = join(root, "profiles", "branch.yml");
    await writeFile(
      profilePath,
      [
        "schemaVersion: 1",
        "agent:",
        "  tools:",
        "    profile: coding",
        "    allow: [read, github__list_issues]",
        "    deny: [exec]",
        "    fs:",
        "      workspaceOnly: true",
      ].join("\n"),
      "utf8",
    );

    const first = await readGroveManifestFile(root);
    expect(first).toMatchObject({
      ok: true,
      branchProfile: {
        schemaVersion: 1,
        agent: {
          tools: {
            profile: "coding",
            allow: ["read", "github__list_issues"],
            deny: ["exec"],
            fs: { workspaceOnly: true },
          },
        },
      },
    });
    if (!first.ok) {
      throw new Error("expected Branch Agent profile to parse");
    }

    await writeFile(
      profilePath,
      "schemaVersion: 1\nagent:\n  tools:\n    profile: messaging\n    allow: [message]\n",
      "utf8",
    );
    const second = await readGroveManifestFile(root);
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error("expected changed Branch Agent profile to parse");
    }
    expect(second.source.integrity).not.toBe(first.source.integrity);
  });

  it.each([
    { toolProfile: "coding", strictOk: false },
    { toolProfile: "minimal", strictOk: true },
  ] as const)(
    "loads a legacy dynamic $toolProfile profile through the update migration path",
    async ({ toolProfile, strictOk }) => {
      const { root } = await profileFixture();
      await writeFile(
        join(root, "profiles", "branch.yml"),
        `schemaVersion: 1\nagent:\n  tools:\n    profile: ${toolProfile}\n`,
        "utf8",
      );

      const manifestPath = join(root, "branch.grove.json");
      await expect(readGroveManifestFile(manifestPath)).resolves.toMatchObject({ ok: strictOk });
      const migrated = await readGroveManifestFile(manifestPath, {
        allowLegacyDynamicToolProfile: true,
      });

      expect(migrated).toMatchObject({
        ok: true,
        branchProfile: {
          agent: {
            tools: {
              profile: "full",
              allow: expect.not.arrayContaining(["bundle-mcp"]),
            },
          },
        },
        legacyBranchProfile: {
          agent: {
            tools: {
              profile: toolProfile,
            },
          },
        },
      });
    },
  );

  it("requires package authors to bound a legacy full profile before update", async () => {
    const { root } = await profileFixture();
    await writeFile(
      join(root, "profiles", "branch.yml"),
      "schemaVersion: 1\nagent:\n  tools:\n    profile: full\n",
      "utf8",
    );

    const result = await readGroveManifestFile(join(root, "branch.grove.json"), {
      allowLegacyDynamicToolProfile: true,
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          message: expect.stringContaining("bounded explicit allowlist"),
        }),
      ],
    });
  });

  it("rejects a hardlinked profile", async () => {
    const { root } = await profileFixture();
    const source = join(root, "source.yml");
    await writeFile(source, "schemaVersion: 1\nagent: {}\n", "utf8");
    await link(source, join(root, "profiles", "branch.yml"));

    const result = await readGroveManifestFile(join(root, "branch.grove.json"));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "branch_profile_unsafe" })],
    });
  });
  it("rejects a symlinked profile at the read boundary", async () => {
    const { root, path } = await profileFixture();
    await writeFile(join(root, "source.yml"), "schemaVersion: 1\nagent: {}\n", "utf8");
    await symlink("../source.yml", join(root, "profiles", "branch.yml"));

    const result = await readGroveManifestFile(path);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "branch_profile_unsafe" })],
    });
  });

  it("fails closed for an escaping metadata profile pointer", async () => {
    const root = tempDirs.make("branch-grove-profile-pointer-");
    const path = join(root, "branch.grove.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        agent: { id: "triage" },
        metadata: { "branch.config": "../branch.yml" },
      }),
      "utf8",
    );
    await writeFile(join(root, "branch.yml"), "schemaVersion: 1\nagent: {}\n", "utf8");

    const result = await readGroveManifestFile(path);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "invalid_branch_profile_path",
          path: "$.metadata.branch.config",
        }),
      ],
    });
  });

  it("still reads the deprecated metadata profile pointer with a warning", async () => {
    const { root, path } = await profileFixture("profiles/triage.branch.yml");
    await writeFile(
      join(root, "profiles", "triage.branch.yml"),
      "schemaVersion: 1\nagent:\n  tools:\n    profile: coding\n    allow: [read]\n",
      "utf8",
    );

    const result = await readGroveManifestFile(path);

    expect(result).toMatchObject({
      ok: true,
      branchProfile: {
        schemaVersion: 1,
        agent: { tools: { profile: "coding", allow: ["read"] } },
      },
    });
    if (!result.ok) {
      throw new Error("expected the deprecated pointer to keep resolving");
    }
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        level: "warning",
        code: "deprecated_branch_profile_pointer",
        path: "$.metadata.branch.config",
      }),
    );
    expect(result.diagnostics.some((entry) => entry.level === "error")).toBe(false);
  });

  it("accepts a deprecated pointer that already targets the conventional profile", async () => {
    const { root, path } = await profileFixture("profiles/branch.yml");
    await writeFile(
      join(root, "profiles", "branch.yml"),
      "schemaVersion: 1\nagent:\n  tools:\n    profile: coding\n    allow: [read]\n",
      "utf8",
    );

    const result = await readGroveManifestFile(path);

    expect(result).toMatchObject({ ok: true, branchProfile: { schemaVersion: 1 } });
  });

  it("fails closed when a deprecated pointer diverges from the conventional profile", async () => {
    const { root, path } = await profileFixture("profiles/other.branch.yml");
    await writeFile(join(root, "profiles", "branch.yml"), "schemaVersion: 1\n", "utf8");
    await writeFile(join(root, "profiles", "other.branch.yml"), "schemaVersion: 1\n", "utf8");

    const result = await readGroveManifestFile(path);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "conflicting_branch_profile_pointer",
          path: "$.metadata.branch.config",
        }),
      ],
    });
  });

  it("does not inspect profiles owned by other harnesses", async () => {
    const { root, path } = await profileFixture();
    await writeFile(join(root, "profiles", "codex.yml"), Buffer.alloc(300 * 1024, "x"));

    const result = await readGroveManifestFile(path);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      throw new Error("expected foreign profile to remain opaque");
    }
    expect(result.branchProfile).toBeUndefined();
  });
});
