// Tests for the grouped Grove manifest and read-only add plan.
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { buildGroveAddPlan } from "./lifecycle.js";
import { readGroveManifestFile } from "./reader.js";
import { parseGroveManifest, parseGroveBranchProfile } from "./schema.js";
import type { GroveManifest, GroveBranchProfile, GroveSourceIdentity } from "./types.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

const baseManifest = {
  schemaVersion: 1,
  agent: {
    id: "github-triage",
    name: "GitHub Triage",
    description: "Reviews incoming issues.",
    identity: { name: "Triage", emoji: "search" },
  },
  metadata: { "branch.config": "profiles/branch.yml" },
  workspace: {
    bootstrapFiles: {
      "AGENTS.md": { source: "workspace/AGENTS.md" },
    },
    files: [{ source: "workspace/reference/policy.md", path: "reference/policy.md" }],
  },
  packages: [
    {
      kind: "skill",
      source: "clawhub",
      ref: "@acme/triage",
      version: "1.2.0",
    },
    {
      kind: "plugin",
      source: "clawhub",
      ref: "@acme/github",
      version: "2.0.1",
    },
  ],
  mcpServers: {
    github: {
      command: "npx",
      args: ["--yes", "@acme/github-mcp@3.4.1"],
      env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
      toolFilter: { include: ["issues_list"], exclude: ["repository_delete"] },
      timeout: 30,
    },
  },
  cronJobs: [
    {
      id: "weekday-triage",
      name: "Weekday triage",
      schedule: { cron: "0 9 * * 1-5", timezone: "America/New_York" },
      session: "isolated",
      message: "Review new issues.",
      delivery: { mode: "announce", channel: "last" },
    },
  ],
} as const;

const baseBranchProfile: GroveBranchProfile = {
  schemaVersion: 1,
  agent: {
    groupChat: { mentionPatterns: ["@triage"] },
    sandbox: { mode: "all", scope: "agent", workspaceAccess: "rw" },
    tools: { allow: ["read", "write"], deny: ["exec"] },
    heartbeat: { every: "30m", lightContext: true },
    humanDelay: { mode: "natural" },
  },
};

function requireManifest(value: unknown = baseManifest): GroveManifest {
  const result = parseGroveManifest(value);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result.manifest;
}

async function createPlanSource(): Promise<{ source: GroveSourceIdentity; workspace: string }> {
  const root = tempDirs.make("branch-grove-plan-");
  await mkdir(join(root, "workspace", "reference"), { recursive: true });
  await writeFile(join(root, "workspace", "AGENTS.md"), "# Agent\n", "utf8");
  await writeFile(join(root, "workspace", "reference", "policy.md"), "Policy\n", "utf8");
  return {
    source: {
      kind: "package",
      name: "@acme/github-triage",
      version: "1.0.0",
      packageRoot: root,
      manifestPath: join(root, "branch.grove.json"),
      integrityKind: "development-snapshot",
      integrity: "sha256:test",
      byteLength: 0,
    },
    workspace: join(root, "new-workspace"),
  };
}

describe("parseGroveManifest", () => {
  it("defaults optional ownership groups without inventing agent settings", () => {
    const manifest = requireManifest({ schemaVersion: 1, agent: { id: "minimal-agent" } });

    expect(manifest).toEqual({
      schemaVersion: 1,
      agent: { id: "minimal-agent" },
      metadata: {},
      workspace: { bootstrapFiles: {}, files: [] },
      packages: [],
      mcpServers: {},
      cronJobs: [],
    });
  });

  it("rejects operator-controlled agent settings", () => {
    const result = parseGroveManifest({
      schemaVersion: 1,
      agent: { id: "unsafe-agent", model: "value" },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid_manifest", path: "$.agent" }),
    );
  });

  it.each(["model", "provider", "skills", "runtime", "bindings", "auth"])(
    "rejects operator-controlled agent field %s",
    (field) => {
      const result = parseGroveManifest({
        schemaVersion: 1,
        agent: { id: "unsafe-agent", [field]: field === "skills" ? ["demo"] : "value" },
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalid_manifest", path: "$.agent" }),
      );
    },
  );

  it.each([
    "model",
    "subagents",
    "groupChat",
    "sandbox",
    "tools",
    "memory",
    "heartbeat",
    "humanDelay",
  ])("keeps harness-specific %s out of the portable agent object", (field) => {
    expect(
      parseGroveManifest({
        schemaVersion: 1,
        agent: { id: "worker", [field]: {} },
      }).ok,
    ).toBe(false);
  });

  it("rejects non-v1 package fields and connector packages", () => {
    const connector = parseGroveManifest({
      ...baseManifest,
      packages: [{ kind: "connector", source: "clawhub", ref: "@acme/chat", version: "1.0.0" }],
    });
    expect(connector.ok).toBe(false);
    expect(connector.diagnostics[0]?.path).toBe("$.packages[0].kind");

    const required = parseGroveManifest({
      ...baseManifest,
      packages: [{ ...baseManifest.packages[0], required: false }],
    });
    expect(required.ok).toBe(false);
    expect(required.diagnostics[0]?.path).toBe("$.packages[0]");

    const manifestIntegrity = parseGroveManifest({
      ...baseManifest,
      packages: [
        {
          ...baseManifest.packages[0],
          integrity: `sha256:${"a".repeat(64)}`,
        },
      ],
    });
    expect(manifestIntegrity.ok).toBe(false);
    expect(manifestIntegrity.diagnostics[0]?.path).toBe("$.packages[0]");
  });

  it("requires exact package versions", () => {
    const result = parseGroveManifest({
      ...baseManifest,
      packages: [
        {
          kind: "skill",
          source: "clawhub",
          ref: "demo",
          version: "latest",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.path).toBe("$.packages[0].version");
  });

  it("rejects resolved MCP secrets", () => {
    const result = parseGroveManifest({
      ...baseManifest,
      mcpServers: {
        github: { command: "npx", env: { GITHUB_TOKEN: "secret-value" } },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.path).toBe("$.mcpServers.github.env.GITHUB_TOKEN");
  });

  it("accepts credential-free remote MCP with local OAuth completion", () => {
    const manifest = requireManifest({
      ...baseManifest,
      mcpServers: {
        linear: {
          url: "https://mcp.linear.app/mcp",
          transport: "streamable-http",
          auth: "oauth",
          toolFilter: { include: ["list_issues"] },
        },
      },
    });

    expect(manifest.mcpServers.linear).toEqual({
      url: "https://mcp.linear.app/mcp",
      transport: "streamable-http",
      auth: "oauth",
      toolFilter: { include: ["list_issues"] },
    });
  });

  it.each([
    {
      url: "https://example.com/mcp",
      transport: "streamable-http",
      headers: { Authorization: "secret" },
    },
    { url: "https://example.com/mcp", transport: "streamable-http", command: "npx" },
    { url: "https://example.com/mcp", transport: "stdio" },
  ])("rejects non-portable remote MCP config %#", (server) => {
    const result = parseGroveManifest({
      ...baseManifest,
      mcpServers: { unsafe: server },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.path).toMatch(/^\$\.mcpServers\.unsafe/);
  });

  it("rejects workspace traversal and duplicate destinations", () => {
    const traversal = parseGroveManifest({
      ...baseManifest,
      workspace: { files: [{ source: "../outside", path: "inside.md" }] },
    });
    expect(traversal.ok).toBe(false);

    const duplicate = parseGroveManifest({
      ...baseManifest,
      workspace: {
        bootstrapFiles: { "AGENTS.md": { source: "workspace/AGENTS.md" } },
        files: [{ source: "workspace/other.md", path: "AGENTS.md" }],
      },
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.diagnostics).toContainEqual(
      expect.objectContaining({ path: "$.workspace.files[0].path" }),
    );
  });

  it("rejects duplicate packages and cron ids", () => {
    const duplicatePackage = parseGroveManifest({
      ...baseManifest,
      packages: [baseManifest.packages[0], baseManifest.packages[0]],
    });
    expect(duplicatePackage.ok).toBe(false);

    const duplicateCron = parseGroveManifest({
      ...baseManifest,
      cronJobs: [baseManifest.cronJobs[0], baseManifest.cronJobs[0]],
    });
    expect(duplicateCron.ok).toBe(false);
  });

  it("rejects invalid heartbeat durations and cron expressions", () => {
    const heartbeat = parseGroveBranchProfile({
      schemaVersion: 1,
      agent: { heartbeat: { every: "eventually" } },
    });
    expect(heartbeat.ok).toBe(false);
    expect(heartbeat.diagnostics).toContainEqual(
      expect.objectContaining({ path: "$.agent.heartbeat.every" }),
    );

    const cron = parseGroveManifest({
      ...baseManifest,
      cronJobs: [
        {
          ...baseManifest.cronJobs[0],
          schedule: { cron: "not a cron expression", timezone: "UTC" },
        },
      ],
    });
    expect(cron.ok).toBe(false);
    expect(cron.diagnostics).toContainEqual(
      expect.objectContaining({ path: "$.cronJobs[0].schedule.cron" }),
    );
  });
});

describe("readGroveManifestFile", () => {
  it("takes published identity from package.json", async () => {
    const root = tempDirs.make("branch-grove-package-");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "@acme/github-triage",
        version: "3.2.1",
        branch: { grove: "branch.grove.json" },
      }),
      "utf8",
    );
    await writeFile(
      join(root, "branch.grove.json"),
      JSON.stringify({ schemaVersion: 1, agent: { id: "triage" } }),
      "utf8",
    );

    const result = await readGroveManifestFile(root);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected package to parse");
    }
    expect(result.source).toMatchObject({
      kind: "package",
      name: "@acme/github-triage",
      version: "3.2.1",
      integrityKind: "development-snapshot",
    });
    expect(result.source.integrity).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.source.byteLength).toBeGreaterThan(0);
  });

  it("reads a human-authored GROVE.md package through the same manifest schema", async () => {
    const root = tempDirs.make("branch-grove-markdown-");
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
      [
        "---",
        "schemaVersion: 1",
        "agent:",
        "  id: triage",
        "workspace: {}",
        "packages: []",
        "mcpServers: {}",
        "cronJobs: []",
        "---",
        "",
        "# GitHub Triage",
      ].join("\n"),
      "utf8",
    );

    const result = await readGroveManifestFile(root);

    expect(result).toMatchObject({
      ok: true,
      manifest: { schemaVersion: 1, agent: { id: "triage" } },
      source: { kind: "package", name: "@acme/github-triage", version: "3.2.1" },
    });
    if (!result.ok) {
      throw new Error("expected package to parse");
    }
    expect(result.source).not.toHaveProperty("manifestFormatPath");
    expect(result.groveMarkdownBody?.toString("utf8")).toBe("\n# GitHub Triage");
    const plan = await buildGroveAddPlan({
      manifest: result.manifest,
      groveMarkdownBody: result.groveMarkdownBody,
      source: result.source,
      context: { workspace: join(root, "workspace-triage") },
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        kind: "workspaceFile",
        id: "SOUL.md",
        sourceKind: "groveMarkdownBody",
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    );
  });

  it("accepts a UTF-8 BOM and includes its bytes in snapshot integrity", async () => {
    const root = tempDirs.make("branch-grove-markdown-bom-");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "@acme/github-triage",
        version: "3.2.1",
        branch: { grove: "GROVE.md" },
      }),
      "utf8",
    );
    const raw =
      "\uFEFF" +
      [
        "---",
        "schemaVersion: 1",
        "agent:",
        "  id: triage",
        "workspace: {}",
        "packages: []",
        "mcpServers: {}",
        "cronJobs: []",
        "---",
      ].join("\n");
    await writeFile(join(root, "GROVE.md"), raw, "utf8");

    const result = await readGroveManifestFile(root);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected BOM-prefixed GROVE.md to parse");
    }
    expect(result.manifest.agent.id).toBe("triage");
    expect(result.source).toMatchObject({
      integrityKind: "development-snapshot",
      byteLength: expect.any(Number),
    });

    await writeFile(join(root, "GROVE.md"), raw.slice(1), "utf8");
    const withoutBom = await readGroveManifestFile(root);
    expect(withoutBom.ok).toBe(true);
    if (!withoutBom.ok) {
      throw new Error("expected GROVE.md without BOM to parse");
    }
    expect(withoutBom.source.integrity).not.toBe(result.source.integrity);
  });

  it("rejects GROVE.md without YAML frontmatter", async () => {
    const root = tempDirs.make("branch-grove-markdown-invalid-");
    const path = join(root, "GROVE.md");
    await writeFile(path, "# Missing manifest\n", "utf8");

    const result = await readGroveManifestFile(path);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "missing_grove_frontmatter" }),
    );
  });

  it.each([
    ["anchor", "agent: &agent { id: triage }"],
    ["alias", "agent: { id: &id triage, name: *id }"],
    ["merge key", "agent: { <<: { id: triage } }"],
    ["explicit tag", "agent: { id: !!str triage }"],
  ])("rejects GROVE.md YAML %s", async (_label, declaration) => {
    const root = tempDirs.make("branch-grove-markdown-alias-");
    const path = join(root, "GROVE.md");
    await writeFile(
      path,
      [
        "---",
        "schemaVersion: 1",
        declaration,
        "workspace: {}",
        "packages: []",
        "mcpServers: {}",
        "cronJobs: []",
        "---",
      ].join("\n"),
      "utf8",
    );

    const result = await readGroveManifestFile(path);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unsupported_grove_yaml_feature" }),
    );
  });

  it("rejects a GROVE.md body that is not valid UTF-8", async () => {
    const root = tempDirs.make("branch-grove-markdown-original-bytes-");
    const path = join(root, "GROVE.md");
    const frontmatter = Buffer.from(
      [
        "---",
        "schemaVersion: 1",
        "agent: { id: triage }",
        "workspace: {}",
        "packages: []",
        "mcpServers: {}",
        "cronJobs: []",
        "---",
        "",
      ].join("\n"),
    );
    await writeFile(path, Buffer.concat([frontmatter, Buffer.from([0x80])]));
    const result = await readGroveManifestFile(path);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid_grove_markdown_utf8" }),
    );
  });

  it("rejects two competing SOUL.md sources", async () => {
    const root = tempDirs.make("branch-grove-markdown-soul-conflict-");
    const path = join(root, "GROVE.md");
    await writeFile(
      path,
      [
        "---",
        "schemaVersion: 1",
        "agent: { id: triage }",
        "workspace:",
        "  bootstrapFiles:",
        "    SOUL.md: { source: workspace/SOUL.md }",
        "packages: []",
        "mcpServers: {}",
        "cronJobs: []",
        "---",
        "Portable soul",
      ].join("\n"),
      "utf8",
    );

    const result = await readGroveManifestFile(path);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "grove_body_soul_conflict" }),
    );
  });

  it("synthesizes explicit development identity for a standalone manifest", async () => {
    const root = tempDirs.make("branch-grove-development-");
    const path = join(root, "demo.grove.json");
    await writeFile(
      path,
      JSON.stringify({ schemaVersion: 1, agent: { id: "demo-agent" } }),
      "utf8",
    );

    const result = await readGroveManifestFile(path);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected development manifest to parse");
    }
    expect(result.source).toMatchObject({
      kind: "development",
      name: "local:demo.grove",
      version: "0.0.0-development",
    });
  });

  it("rejects workspace sources through an intermediate symlink", async () => {
    const root = tempDirs.make("branch-grove-reader-symlink-");
    await mkdir(join(root, "workspace"));
    await writeFile(join(root, "workspace", "AGENTS.md"), "# Agent\n", "utf8");
    await symlink(
      join(root, "workspace"),
      join(root, "workspace-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const manifestPath = join(root, "demo.grove.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        agent: { id: "symlink-agent" },
        workspace: { bootstrapFiles: { "AGENTS.md": { source: "workspace-link/AGENTS.md" } } },
      }),
      "utf8",
    );

    const result = await readGroveManifestFile(manifestPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "workspace_source_unsafe" }),
    );
  });

  it("rejects a workspace source over the per-file byte limit", async () => {
    const root = tempDirs.make("branch-grove-reader-file-limit-");
    await writeFile(join(root, "large.md"), Buffer.alloc(1024 * 1024 + 1));
    const manifestPath = join(root, "demo.grove.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        agent: { id: "large-agent" },
        workspace: { files: [{ source: "large.md", path: "large.md" }] },
      }),
      "utf8",
    );

    const result = await readGroveManifestFile(manifestPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "workspace_source_too_large" }),
    );
  });

  it("rejects aggregate workspace bytes before reading source contents", async () => {
    const root = tempDirs.make("branch-grove-reader-aggregate-limit-");
    const files = [];
    for (let index = 0; index < 5; index += 1) {
      const source = `large-${index}.md`;
      await writeFile(join(root, source), Buffer.alloc(1024 * 1024, index));
      files.push({ source, path: source });
    }
    const manifestPath = join(root, "demo.grove.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        agent: { id: "large-agent" },
        workspace: { files },
      }),
      "utf8",
    );

    const result = await readGroveManifestFile(manifestPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "workspace_sources_too_large" }),
    );
  });

  it.runIf(process.platform !== "win32")(
    "uses the declared GROVE.md path when it is an in-package symlink",
    async () => {
      const root = tempDirs.make("branch-grove-markdown-link-");
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
        join(root, "manifest.json"),
        [
          "---",
          "schemaVersion: 1",
          "agent:",
          "  id: triage",
          "workspace: {}",
          "packages: []",
          "mcpServers: {}",
          "cronJobs: []",
          "---",
        ].join("\n"),
        "utf8",
      );
      await symlink("manifest.json", join(root, "GROVE.md"));

      const result = await readGroveManifestFile(root);

      expect(result).toMatchObject({
        ok: true,
        manifest: { agent: { id: "triage" } },
        source: { manifestPath: await realpath(join(root, "manifest.json")) },
      });
    },
  );

  it("rejects package manifests that escape the package root", async () => {
    const parent = tempDirs.make("branch-grove-escape-");
    const root = join(parent, "package");
    await mkdir(root);
    await writeFile(
      join(parent, "outside.json"),
      JSON.stringify({ schemaVersion: 1, agent: { id: "outside" } }),
      "utf8",
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "@acme/escape",
        version: "1.0.0",
        branch: { grove: "../outside.json" },
      }),
      "utf8",
    );

    const result = await readGroveManifestFile(root);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "manifest_escapes_package" }),
    );
  });
});

describe("buildGroveAddPlan", () => {
  it("materializes resolved package identity into the consented plan", async () => {
    const { source, workspace } = await createPlanSource();
    const plan = await buildGroveAddPlan({
      manifest: requireManifest(),
      source,
      context: {
        workspace,
        packagePreflight: async (pkg) => ({
          ok: true,
          action: "install",
          integrity: `sha256:${(pkg.kind === "skill" ? "a" : "b").repeat(64)}`,
          warning: `Review ${pkg.ref} before installation.`,
          ...(pkg.kind === "plugin" ? { installId: "github" } : {}),
        }),
      },
    });

    expect(plan.actions.filter((action) => action.kind === "package")).toEqual([
      expect.objectContaining({
        id: "skill:@acme/triage",
        digest: `sha256:${"a".repeat(64)}`,
        details: expect.objectContaining({
          ownerAction: "install",
          riskWarning: "Review @acme/triage before installation.",
        }),
        blocked: false,
      }),
      expect.objectContaining({
        id: "plugin:@acme/github",
        digest: `sha256:${"b".repeat(64)}`,
        details: expect.objectContaining({
          ownerAction: "install",
          installId: "github",
          riskWarning: "Review @acme/github before installation.",
        }),
        blocked: false,
      }),
    ]);
    expect(plan.capabilityChanges.filter((change) => change.kind === "package")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "skill:@acme/triage",
          effect: expect.objectContaining({
            integrity: `sha256:${"a".repeat(64)}`,
            riskWarning: "Review @acme/triage before installation.",
          }),
        }),
        expect.objectContaining({
          id: "plugin:@acme/github",
          effect: expect.objectContaining({
            integrity: `sha256:${"b".repeat(64)}`,
            installId: "github",
            riskWarning: "Review @acme/github before installation.",
          }),
        }),
      ]),
    );
  });

  it("includes package setup requirements in plan readiness", async () => {
    const { source, workspace } = await createPlanSource();
    const plan = await buildGroveAddPlan({
      manifest: requireManifest(),
      source,
      context: {
        workspace,
        packagePreflight: async (pkg) => ({
          ok: true,
          action: "install",
          integrity: `sha256:${"a".repeat(64)}`,
          ...(pkg.kind === "plugin"
            ? {
                installId: "github",
                requirements: [
                  {
                    kind: "plugin-setup" as const,
                    plugin: "github",
                    provider: "github",
                    envVars: ["GITHUB_TOKEN"],
                    authMethods: ["token"],
                  },
                ],
              }
            : {}),
        }),
      },
    });

    expect(plan.readiness.ready).toBe(false);
    expect(plan.readiness.requirements).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "plugin-setup", plugin: "github" })]),
    );
    expect(plan.actions.find((action) => action.id === "plugin:@acme/github")?.details).toEqual(
      expect.objectContaining({
        prerequisites: expect.arrayContaining([expect.objectContaining({ kind: "plugin-setup" })]),
      }),
    );
  });

  it("plans one new agent, workspace, packages, MCP servers, and agent-pinned cron jobs", async () => {
    const { source, workspace } = await createPlanSource();
    const canonicalWorkspace = join(await realpath(source.packageRoot), "new-workspace");
    const plan = await buildGroveAddPlan({
      manifest: requireManifest(),
      branchProfile: baseBranchProfile,
      source,
      context: { workspace },
    });

    expect(plan).toMatchObject({
      schemaVersion: "branch.groveAddPlan.v1",
      manifestSchemaVersion: 1,
      stability: "experimental",
      dryRun: true,
      mutationAllowed: false,
      planIntegrity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      agent: {
        requestedId: "github-triage",
        finalId: "github-triage",
        workspace: canonicalWorkspace,
      },
      readiness: {
        ready: false,
        requirements: [{ kind: "environment", mcpServer: "github", name: "GITHUB_TOKEN" }],
      },
      summary: {
        totalActions: 8,
        agentActions: 1,
        workspaceActions: 3,
        packageActions: 2,
        mcpServerActions: 1,
        cronJobActions: 1,
        blockedActions: 2,
        capabilityEscalations: 5,
      },
    });
    expect(plan.capabilityChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "agent", id: "github-triage" }),
        expect.objectContaining({ kind: "package", id: "plugin:@acme/github" }),
        expect.objectContaining({ kind: "mcpServer", id: "github" }),
        expect.objectContaining({ kind: "cronJob", id: "weekday-triage" }),
      ]),
    );
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        kind: "workspaceFile",
        id: "AGENTS.md",
        digest: expect.stringMatching(/^sha256:/),
      }),
    );
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        kind: "cronJob",
        id: "weekday-triage",
        target: "cron:weekday-triage:agent=github-triage",
      }),
    );
  });

  it("blocks agent, configured workspace, and MCP collisions", async () => {
    const { source, workspace } = await createPlanSource();
    const plan = await buildGroveAddPlan({
      manifest: requireManifest(),
      source,
      context: {
        workspace,
        existingAgentIds: ["github-triage"],
        existingWorkspacePaths: [workspace],
        existingMcpServerNames: ["github"],
      },
    });

    expect(plan.blockers.map((item) => item.code)).toEqual([
      "agent_id_collision",
      "workspace_collision",
      "package_install_unavailable",
      "package_install_unavailable",
      "mcp_server_collision",
    ]);
    expect(plan.summary.blockedActions).toBe(7);
  });

  it("canonicalizes a missing workspace through an existing aliased parent", async () => {
    const { source } = await createPlanSource();
    const root = tempDirs.make("branch-grove-workspace-alias-");
    const canonicalParent = join(root, "canonical");
    const aliasParent = join(root, "alias");
    await mkdir(canonicalParent);
    await symlink(canonicalParent, aliasParent, process.platform === "win32" ? "junction" : "dir");
    const canonicalWorkspace = join(await realpath(canonicalParent), "new-workspace");

    const plan = await buildGroveAddPlan({
      manifest: requireManifest(),
      source,
      context: {
        workspace: join(aliasParent, "new-workspace"),
        existingWorkspacePaths: [canonicalWorkspace],
      },
    });

    expect(plan.agent.workspace).toBe(canonicalWorkspace);
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: "workspace_collision" }));
  });

  it("plans reuse for an exact existing MCP server", async () => {
    const { source, workspace } = await createPlanSource();
    const manifest = requireManifest();
    const plan = await buildGroveAddPlan({
      manifest,
      source,
      context: {
        workspace,
        existingMcpServers: { github: manifest.mcpServers.github! },
      },
    });

    expect(plan.blockers.map((item) => item.code)).not.toContain("mcp_server_collision");
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        kind: "mcpServer",
        id: "github",
        blocked: false,
        details: expect.objectContaining({ expectedState: "present-exact" }),
      }),
    );
  });

  it("uses an explicit unused agent id for every derived action", async () => {
    const { source, workspace } = await createPlanSource();
    const plan = await buildGroveAddPlan({
      manifest: requireManifest(),
      source,
      context: { agentId: "triage-two", workspace },
    });

    expect(plan.agent.finalId).toBe("triage-two");
    expect(plan.actions.find((action) => action.kind === "agent")?.id).toBe("triage-two");
    expect(plan.actions.find((action) => action.kind === "cronJob")?.target).toContain(
      "agent=triage-two",
    );
  });

  it("rejects workspace sources through symlinked parents", async () => {
    const { source, workspace } = await createPlanSource();
    await symlink(
      join(source.packageRoot, "workspace"),
      join(source.packageRoot, "workspace-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const plan = await buildGroveAddPlan({
      manifest: requireManifest({
        schemaVersion: 1,
        agent: { id: "symlink-agent" },
        workspace: {
          bootstrapFiles: { "AGENTS.md": { source: "workspace-link/AGENTS.md" } },
        },
      }),
      source,
      context: { workspace },
    });

    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "workspace_source_unsafe" }),
    );
    const workspaceAction = plan.actions.find(
      (action) => action.kind === "workspaceFile" && action.id === "AGENTS.md",
    );
    expect(workspaceAction).toMatchObject({ kind: "workspaceFile", blocked: true });
    expect(workspaceAction).not.toHaveProperty("digest");
  });

  it.runIf(process.platform !== "win32")(
    "canonicalizes workspace identity through symlinked parents",
    async () => {
      const { source } = await createPlanSource();
      const realParent = join(source.packageRoot, "real-parent");
      const aliasParent = join(source.packageRoot, "alias-parent");
      await mkdir(realParent, { recursive: true });
      await symlink(realParent, aliasParent, "dir");

      const plan = await buildGroveAddPlan({
        manifest: requireManifest({ schemaVersion: 1, agent: { id: "canonical-agent" } }),
        source,
        context: { workspace: join(aliasParent, "workspace-canonical-agent") },
      });

      const canonicalWorkspace = join(await realpath(realParent), "workspace-canonical-agent");
      expect(plan.agent.workspace).toBe(canonicalWorkspace);
      expect(plan.agent.config.workspace).toBe(canonicalWorkspace);
      expect(plan.actions.find((action) => action.kind === "workspace")?.target).toBe(
        canonicalWorkspace,
      );
    },
  );

  it("blocks aggregate workspace bytes before hashing sources", async () => {
    const { source, workspace } = await createPlanSource();
    const files = [];
    for (let index = 0; index < 5; index += 1) {
      const sourcePath = `workspace/large-${index}.md`;
      await writeFile(join(source.packageRoot, sourcePath), Buffer.alloc(1024 * 1024, index));
      files.push({ source: sourcePath, path: `large-${index}.md` });
    }
    const plan = await buildGroveAddPlan({
      manifest: requireManifest({
        schemaVersion: 1,
        agent: { id: "large-agent" },
        workspace: { files },
      }),
      source,
      context: { workspace },
    });

    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "workspace_sources_too_large" }),
    );
    const workspaceFileActions = plan.actions.filter((action) => action.kind === "workspaceFile");
    expect(workspaceFileActions).toHaveLength(5);
    expect(workspaceFileActions.every((action) => action.blocked)).toBe(true);
    expect(workspaceFileActions.every((action) => !Object.hasOwn(action, "digest"))).toBe(true);
  });
  it("binds plan integrity to the source and planned mutations", async () => {
    const { source, workspace } = await createPlanSource();
    const first = await buildGroveAddPlan({
      manifest: requireManifest(),
      branchProfile: baseBranchProfile,
      source,
      context: { workspace },
    });
    const repeated = await buildGroveAddPlan({
      manifest: requireManifest(),
      branchProfile: baseBranchProfile,
      source,
      context: { workspace },
    });
    const changed = await buildGroveAddPlan({
      manifest: requireManifest(),
      branchProfile: baseBranchProfile,
      source: { ...source, integrity: "sha256:changed" },
      context: { workspace },
    });
    const changedCapability = await buildGroveAddPlan({
      manifest: requireManifest(),
      branchProfile: {
        ...baseBranchProfile,
        agent: {
          ...baseBranchProfile.agent,
          tools: { allow: ["read", "exec"] },
        },
      },
      source,
      context: { workspace },
    });

    expect(repeated.planIntegrity).toBe(first.planIntegrity);
    // Existing consent tokens bind this description for profiles without the new fields.
    expect(first.capabilityChanges.find((change) => change.kind === "agent")?.reason).toBe(
      "The new agent declares sandbox, tool, memory-search, or recurring heartbeat capabilities.",
    );
    expect(changed.planIntegrity).not.toBe(first.planIntegrity);
    expect(changedCapability.planIntegrity).not.toBe(first.planIntegrity);
  });
});
