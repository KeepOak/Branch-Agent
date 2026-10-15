import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPluginManifest } from "../../../src/plugins/manifest.js";
import { approvalForReaTool, RISKY_REA_TOOLS } from "./rea-approval.js";

const pluginRoot = path.join(import.meta.dirname, "..");
const HARD_RULE =
  "Copy code only from permissively licensed sources. Closed apps (like an Electron app) may only be studied for behavior and design, never copied.";

function readPluginJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(pluginRoot, name), "utf8")) as Record<string, unknown>;
}

describe("harvest plugin", () => {
  it("validates the manifest", () => {
    const result = loadPluginManifest(pluginRoot, false);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest.id).toBe("harvest");
    expect(result.manifest.categories).toEqual(["research"]);
    expect(result.manifest.mcpServers?.rea).toMatchObject({
      command: "npx",
      args: ["-y", "rea-agents@6.4.0", "mcp"],
    });
  });

  it("pins rea-agents to 6.4.0", () => {
    const manifest = readPluginJson("branch.plugin.json");
    const servers = manifest.mcpServers as { rea: { args: string[]; command: string } };
    expect(servers.rea.command).toBe("npx");
    expect(servers.rea.args).toEqual(["-y", "rea-agents@6.4.0", "mcp"]);
    expect(servers.rea.args.join(" ")).toContain("rea-agents@6.4.0");
    expect(servers.rea.args.join(" ")).not.toContain("@latest");
  });

  it("requires approval for risky REA tools", () => {
    const manifest = readPluginJson("branch.plugin.json");
    const rea = (manifest.mcpServers as { rea: { codex: { defaultToolsApprovalMode: string } } })
      .rea;
    expect(rea.codex.defaultToolsApprovalMode).toBe("prompt");

    for (const tool of RISKY_REA_TOOLS) {
      for (const callName of [tool, `rea__${tool}`, `mcp__rea__${tool}`, `rea_${tool}`]) {
        expect(approvalForReaTool(callName)?.requireApproval.allowedDecisions).toEqual([
          "allow-once",
          "deny",
        ]);
      }
    }
    expect(approvalForReaTool("rea__open_binary")).toBeUndefined();
    expect(approvalForReaTool("rea__analyze_javascript_application")).toBeUndefined();

    const skill = readFileSync(
      path.join(pluginRoot, "skills/reverse-engineer-anything/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain(HARD_RULE);
    for (const tool of RISKY_REA_TOOLS) {
      expect(skill).toContain(`rea__${tool}`);
    }
  });

  it("sets the pack tier to official", () => {
    const pack = readPluginJson("branch.pack.json");
    expect(pack).toMatchObject({
      schema: "branch.pack/v1",
      kind: "plugin",
      tier: "official",
      id: "harvest",
    });
    expect(pack.permissions).toEqual({
      network: true,
      files: "workspace",
      runCommands: true,
      secrets: false,
      computerControl: true,
    });
    expect(String(pack.summary)).toContain("asks you before");
  });

  it("points at the Harvest skill instead of copying it", () => {
    const skill = readFileSync(path.join(pluginRoot, "skills/harvest/SKILL.md"), "utf8");
    expect(skill).toContain("engine/skills/harvest/SKILL.md");
    expect(skill).toContain(HARD_RULE);
    expect(skill.length).toBeLessThan(1200);
    expect(skill).not.toContain("git clone");
  });
});
