import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { automationsFromCronJobs, connectionsFor, modelFamilyFromRef, exportTrunkTemplate } from "./trunk-template-export.js";
import { decodeTrunkTemplateLink, encodeTrunkTemplateLink } from "./trunk-template-link.js";
import {
  buildTrunkTemplate,
  NO_RESTRICTIONS_PERMISSION,
  parseTrunkTemplate,
  redactPersonaText,
  skillIdForSlug,
  uninstalledSkillWarnings,
} from "./trunk-template.js";

const BUNDLED_DIR = path.resolve(import.meta.dirname, "../../skills/trunk-templates");

describe("trunk templates", () => {
  it("round-trips a built template through JSON and parse with no warnings", () => {
    const { template: built, warnings } = buildTrunkTemplate({
      name: "Scout",
      description: "Finds things.",
      agentsMd: "# Scout\n",
      skillSlugs: ["summarize-pdf"],
      toolsets: { browser: false, files: true },
      modelFamily: "gpt-5.5",
    });
    expect(warnings).toEqual([]);
    const parsed = parseTrunkTemplate(structuredClone(built));
    expect(parsed).toEqual({ ok: true, template: built, warnings: [] });
    expect(built.skills).toEqual([skillIdForSlug("summarize-pdf")]);
  });

  it("warns, does not fail, on a malformed skill id and a non-boolean toolset", () => {
    const parsed = parseTrunkTemplate({
      format: "branch.trunk-template",
      version: 1,
      name: "Scout",
      persona: { agentsMd: "# Scout\n" },
      skills: ["not-a-catalog-id", skillIdForSlug("ok-skill")],
      toolsets: { browser: "no" },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.template.skills).toEqual([skillIdForSlug("ok-skill")]);
    expect(parsed.warnings).toHaveLength(2);
  });

  it("keeps only known toolset switches and warns on always-on and unknown names", () => {
    const parsed = parseTrunkTemplate({
      format: "branch.trunk-template",
      version: 1,
      name: "Scout",
      persona: { agentsMd: "# Scout\n" },
      skills: [],
      toolsets: { browser: false, message: false, nope: true },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.template.toolsets).toEqual({ browser: false });
    expect(parsed.warnings).toEqual([
      expect.stringContaining("always on"),
      expect.stringContaining("names no known toolset"),
    ]);
  });

  it("names skills this engine has not installed as plain warnings", () => {
    const parsed = parseTrunkTemplate({
      format: "branch.trunk-template",
      version: 1,
      name: "Scout",
      persona: { agentsMd: "" },
      skills: [skillIdForSlug("missing-skill")],
      toolsets: {},
    });
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(uninstalledSkillWarnings(parsed.template, new Set(["other"]))).toEqual([
      `Skill "${skillIdForSlug("missing-skill")}" is not installed here, so this Trunk starts without it.`,
    ]);
    expect(uninstalledSkillWarnings(parsed.template, new Set(["missing-skill"]))).toEqual([]);
  });

  it("rejects something that is not a template", () => {
    expect(parseTrunkTemplate({ name: "x" }).ok).toBe(false);
  });

  it("parses every bundled template with no warnings", () => {
    const files = readdirSync(BUNDLED_DIR).filter((f) => f.endsWith(".branch.trunk-template.json"));
    expect(files.length).toBe(9);
    for (const file of files) {
      const parsed = parseTrunkTemplate(JSON.parse(readFileSync(path.join(BUNDLED_DIR, file), "utf8")));
      expect(parsed, file).toMatchObject({ ok: true, warnings: [] });
    }
  });

  it("keeps the model family and drops account and profile suffixes", () => {
    expect(modelFamilyFromRef("openai-codex/gpt-5.5@acct-SECRET_ACCOUNT")).toBe("gpt-5.5");
    expect(modelFamilyFromRef(undefined)).toBeUndefined();
  });

  it("redacts workspace and home paths out of persona text", () => {
    const text = redactPersonaText("see /Users/me/work/ops/notes and /Users/me/x", {
      workspaceDir: "/Users/me/work/ops",
      homeDir: "/Users/me",
    });
    expect(text).toBe("see <workspace>/notes and ~/x");
  });

  it("never exports memory, USER.md, secrets, accounts, machine names or paths", async () => {
    const home = os.homedir();
    const workspace = mkdtempSync(path.join(os.tmpdir(), "trunk-template-"));
    mkdirSync(path.join(workspace, "memory"));
    writeFileSync(path.join(workspace, "AGENTS.md"), `# Ops\nWorkspace is ${workspace} and home is ${home}.\n`);
    writeFileSync(path.join(workspace, "SOUL.md"), "Calm.\n");
    writeFileSync(path.join(workspace, "USER.md"), "SENTINEL_USER_FILE\n");
    writeFileSync(path.join(workspace, "MEMORY.md"), "SENTINEL_MEMORY_FILE\n");
    writeFileSync(path.join(workspace, "memory", "2026-10-09.md"), "SENTINEL_MEMORY_DIR\n");
    const cfg = {
      agents: {
        entries: {
          ops: {
            name: "Ops",
            workspace,
            model: "openai-codex/gpt-5.5@SENTINEL_ACCOUNT",
            skills: ["summarize-pdf"],
            github: { login: "SENTINEL_GITHUB_LOGIN" },
            tools: { exec: { host: "node", node: "SENTINEL_MACHINE_NAME" } },
            authProfiles: ["SENTINEL_AUTH_PROFILE"],
          },
        },
      },
    } as unknown as BranchConfig;

    const result = await exportTrunkTemplate({ cfg, agentId: "ops", env: {} });
    if (!result.ok) {
      throw new Error(result.error);
    }
    const { template } = result;
    if (!template) {
      throw new Error("expected a template");
    }
    const serialized = JSON.stringify(template);
    for (const sentinel of [
      "SENTINEL_USER_FILE",
      "SENTINEL_MEMORY_FILE",
      "SENTINEL_MEMORY_DIR",
      "SENTINEL_ACCOUNT",
      "SENTINEL_GITHUB_LOGIN",
      "SENTINEL_MACHINE_NAME",
      "SENTINEL_AUTH_PROFILE",
      workspace,
      home,
    ]) {
      expect(serialized, sentinel).not.toContain(sentinel);
    }
    expect(template.persona.agentsMd).toContain("<workspace>");
    expect(template.model).toEqual({ family: "gpt-5.5" });
    expect(template.skills).toEqual([skillIdForSlug("summarize-pdf")]);
    expect(template.name).toBe("Ops");
  });

  it("refuses export when persona text looks like a secret, and never names the value", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "trunk-template-secret-"));
    writeFileSync(path.join(workspace, "AGENTS.md"), "# Ops\nToken: ghp_1234567890abcdefghijklmnopqrstuvwxyz\n");
    const cfg = { agents: { entries: { ops: { name: "Ops", workspace } } } } as unknown as BranchConfig;
    const result = await exportTrunkTemplate({ cfg, agentId: "ops", env: {} });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("looks like it contains a secret");
    expect(result.error).not.toContain("ghp_");
  });

  it("names a tool-limited Trunk's restriction in its permissions instead of claiming no restrictions", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "trunk-template-limit-"));
    writeFileSync(path.join(workspace, "AGENTS.md"), "# Ops\n");
    const cfg = { agents: { entries: { ops: { name: "Ops", workspace, tools: { deny: ["exec"] } } } } } as unknown as BranchConfig;
    const result = await exportTrunkTemplate({ cfg, agentId: "ops", env: {} });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.template.permissions).toEqual([expect.stringContaining("has its own tool list")]);
    expect(result.template.permissions).not.toContain(NO_RESTRICTIONS_PERMISSION);
  });

  it("states no restrictions only when the Trunk has none", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "trunk-template-free-"));
    writeFileSync(path.join(workspace, "AGENTS.md"), "# Ops\n");
    const cfg = { agents: { entries: { ops: { name: "Ops", workspace } } } } as unknown as BranchConfig;
    const result = await exportTrunkTemplate({ cfg, agentId: "ops", env: {} });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.template.permissions).toEqual([NO_RESTRICTIONS_PERMISSION]);
  });

  it("drops a malformed skill slug the same way on export and on import", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "trunk-template-skill-"));
    writeFileSync(path.join(workspace, "AGENTS.md"), "# Ops\n");
    const cfg = { agents: { entries: { ops: { name: "Ops", workspace, skills: ["Bad Slug", "summarize-pdf"] } } } } as unknown as BranchConfig;
    const exported = await exportTrunkTemplate({ cfg, agentId: "ops", env: {} });
    if (!exported.ok) {
      throw new Error(exported.error);
    }
    expect(exported.template.skills).toEqual([skillIdForSlug("summarize-pdf")]);
    expect(exported.warnings).toEqual(["One skill entry is not a catalog id and was skipped."]);
    const imported = parseTrunkTemplate({
      format: "branch.trunk-template",
      version: 1,
      name: "Ops",
      persona: { agentsMd: "" },
      skills: [skillIdForSlug("Bad Slug"), skillIdForSlug("summarize-pdf")],
      toolsets: {},
    });
    if (!imported.ok) {
      throw new Error(imported.error);
    }
    expect(imported.template.skills).toEqual(exported.template.skills);
    expect(imported.warnings).toEqual(["One skill entry is not a catalog id and was skipped."]);
  });

  it.each([
    ["Windows user path", "C:\\Users\\alice\\notes\\plan.md", "alice"],
    ["Windows user path with forward slashes", "C:/Users/alice/notes/plan.md", "alice"],
    ["macOS user path", "see /Users/alice/notes/plan.md", "alice"],
    ["Linux home path", "see /home/alice/notes/plan.md", "alice"],
  ])("redacts a %s to ~", (_label, text, name) => {
    const redacted = redactPersonaText(text, {});
    expect(redacted).toContain("~");
    expect(redacted).not.toContain(name);
  });

  it("redacts PEM private key blocks and headers", () => {
    const block = "-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----";
    expect(redactPersonaText(block, {})).toBe("<redacted key>");
    expect(redactPersonaText("-----BEGIN PRIVATE KEY-----", {})).toBe("<redacted key header>");
  });

  it("accepts a plain model family token and drops anything else with a warning", () => {
    const plain = buildTrunkTemplate({ name: "Scout", modelFamily: "gpt-5.5" });
    expect(plain.template.model).toEqual({ family: "gpt-5.5" });
    const pathLike = buildTrunkTemplate({ name: "Scout", modelFamily: "../etc/passwd" });
    expect(pathLike.template.model).toBeUndefined();
    expect(pathLike.warnings).toEqual(["The model family was not a plain model name and was skipped."]);
  });

  it("never echoes a path-shaped skill slug, on export or on import", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "trunk-template-path-slug-"));
    writeFileSync(path.join(workspace, "AGENTS.md"), "# Ops\n");
    const cfg = { agents: { entries: { ops: { name: "Ops", workspace, skills: ["/Users/alice/secret-skill"] } } } } as unknown as BranchConfig;
    const exported = await exportTrunkTemplate({ cfg, agentId: "ops", env: {} });
    if (!exported.ok) {
      throw new Error(exported.error);
    }
    expect(exported.template.skills).toEqual([]);
    expect(JSON.stringify(exported)).not.toContain("/Users/alice");
    const imported = parseTrunkTemplate({
      format: "branch.trunk-template",
      version: 1,
      name: "Ops",
      persona: { agentsMd: "" },
      skills: ["/Users/alice/secret-skill"],
      toolsets: {},
    });
    if (!imported.ok) {
      throw new Error(imported.error);
    }
    expect(JSON.stringify(imported)).not.toContain("/Users/alice");
  });

  it("refuses export when persona text contains a private key block", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "trunk-template-pem-"));
    writeFileSync(path.join(workspace, "SOUL.md"), "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n");
    const cfg = { agents: { entries: { ops: { name: "Ops", workspace } } } } as unknown as BranchConfig;
    const result = await exportTrunkTemplate({ cfg, agentId: "ops", env: {} });
    expect(result.ok).toBe(false);
  });

  it("counts persona bytes, not characters, when it cuts a long file", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "trunk-template-bytes-"));
    // Two-byte characters: fewer than 64K characters, but more than 64 KB of bytes.
    writeFileSync(path.join(workspace, "AGENTS.md"), "\u00e9".repeat(40_000));
    const cfg = { agents: { entries: { ops: { name: "Ops", workspace } } } } as unknown as BranchConfig;
    const result = await exportTrunkTemplate({ cfg, agentId: "ops", env: {} });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(Buffer.byteLength(result.template.persona.agentsMd, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(result.warnings).toEqual(["AGENTS.md was cut to 64 KB for the template."]);
  });

  it("treats a Trunk with fs.workspaceOnly set as tool-limited", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "trunk-template-fs-"));
    writeFileSync(path.join(workspace, "AGENTS.md"), "# Ops\n");
    const cfg = { agents: { entries: { ops: { name: "Ops", workspace, tools: { fs: { workspaceOnly: true } } } } } } as unknown as BranchConfig;
    const result = await exportTrunkTemplate({ cfg, agentId: "ops", env: {} });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.template.permissions).toEqual([expect.stringContaining("has its own tool list")]);
  });
});

describe("trunk template routines, connections and links", () => {
  const base = { format: "branch.trunk-template", version: 1, name: "Night Shift", persona: { agentsMd: "# Night\n" }, skills: [], toolsets: {} };

  it("keeps whole routines and channel ids from a file, and warns on the rest", () => {
    const parsed = parseTrunkTemplate({
      ...base,
      automations: [{ name: "Digest", cron: "0 7 * * *", prompt: "Summarize." }, { name: "No prompt", cron: "0 8 * * *" }, "junk"],
      connections: ["telegram", "Not A Channel", "telegram"],
    });
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.template.automations).toEqual([{ name: "Digest", cron: "0 7 * * *", prompt: "Summarize." }]);
    expect(parsed.template.connections).toEqual(["telegram"]);
    expect(parsed.warnings).toEqual([
      "One routine is missing its name, schedule or prompt and was skipped.",
      "One routine is missing its name, schedule or prompt and was skipped.",
      "One connection is not a plain channel id and was skipped.",
    ]);
  });

  it("round-trips a template through a link", () => {
    const parsed = parseTrunkTemplate({ ...base, automations: [{ name: "Digest", cron: "0 7 * * *", prompt: "Summarize." }] });
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const link = encodeTrunkTemplateLink(parsed.template);
    expect(link.startsWith("branch-template:1:")).toBe(true);
    expect(decodeTrunkTemplateLink(`  ${link}\n`)).toEqual({ ok: true, value: parsed.template });
  });

  it("refuses a link with the wrong prefix or damaged bytes", () => {
    expect(decodeTrunkTemplateLink("https://example.com/x").ok).toBe(false);
    expect(decodeTrunkTemplateLink("branch-template:1:not-deflate").ok).toBe(false);
  });

  it("exports scheduled prompts only, without paths or secrets", () => {
    const result = automationsFromCronJobs(
      [
        { name: "Digest", schedule: { kind: "cron", expr: "0 7 * * *" }, payload: { kind: "agentTurn", message: "Read /home/someone/notes.md" } },
        { name: "Watcher", schedule: { kind: "cron", expr: "*/5 * * * *" }, payload: { kind: "agentTurn", message: "Check." }, trigger: { script: "x" } },
        { name: "Health", declarationKey: "system:health", schedule: { kind: "cron", expr: "0 * * * *" }, payload: { kind: "agentTurn", message: "Check." } },
        { name: "Key", schedule: { kind: "cron", expr: "0 9 * * *" }, payload: { kind: "agentTurn", message: "Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" } },
      ],
      {},
    );
    expect(result.automations).toEqual([{ name: "Digest", cron: "0 7 * * *", prompt: "Read ~/notes.md" }]);
    expect(result.warnings).toEqual([
      'Routine "Watcher" is not a scheduled prompt, so the template leaves it out.',
      'Routine "Health" is managed by Branch or a plugin, so the template leaves it out.',
      "One routine looks like it contains a secret (a token or key), so the template leaves it out.",
    ]);
  });

  it("names the channels a Trunk is bound to, never the account", () => {
    const cfg = {
      bindings: [
        { agentId: "night", match: { channel: "Telegram", accountId: "bot-1" } },
        { agentId: "night", match: { channel: "telegram", accountId: "bot-2" } },
        { agentId: "main", match: { channel: "slack" } },
      ],
    } as unknown as BranchConfig;
    expect(connectionsFor(cfg, "night")).toEqual(["telegram"]);
  });
});
