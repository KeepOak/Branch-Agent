import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { modelFamilyFromRef, exportTrunkTemplate } from "./trunk-template-export.js";
import {
  buildTrunkTemplate,
  parseTrunkTemplate,
  redactPersonaText,
  skillIdForSlug,
  uninstalledSkillWarnings,
} from "./trunk-template.js";

const BUNDLED_DIR = path.resolve(import.meta.dirname, "../../skills/trunk-templates");

describe("trunk templates", () => {
  it("round-trips a built template through JSON and parse with no warnings", () => {
    const built = buildTrunkTemplate({
      name: "Scout",
      description: "Finds things.",
      agentsMd: "# Scout\n",
      skillSlugs: ["summarize-pdf"],
      toolsets: { browser: false, files: true },
      modelFamily: "gpt-5.5",
    });
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
    expect(files.length).toBe(3);
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

    const template = await exportTrunkTemplate({ cfg, agentId: "ops", env: {} });
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
});
