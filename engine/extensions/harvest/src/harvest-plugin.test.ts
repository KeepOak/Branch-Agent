import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPluginManifest } from "../../../src/plugins/manifest.js";
import { approvalForReaTool, RISKY_REA_TOOLS } from "./rea-approval.js";

const pluginRoot = path.join(import.meta.dirname, "..");
const LOCKED_REA_ENTRY = "./rea-pin/node_modules/rea-agents/scripts/rea.mjs";
const HARD_RULE =
  "Copy code only from permissively licensed sources. Closed apps (like an Electron app) may only be studied for behavior and design, never copied.";

type ReaToolEffect = {
  mutatesTarget: boolean;
  mutatesSession: boolean;
  writesFilesystem: boolean;
  launchesProcess: boolean;
  accessesNetwork: boolean;
  changesUiState: boolean;
  mayDiscardData: boolean;
  idempotent: boolean;
};

/** A tool changes something when it runs a command, drives an app, writes a file, or changes state. */
function reaToolChangesSomething(effect: ReaToolEffect): boolean {
  return (
    effect.launchesProcess ||
    effect.changesUiState ||
    effect.writesFilesystem ||
    effect.mutatesTarget ||
    effect.mayDiscardData
  );
}

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
      command: "node",
      args: [LOCKED_REA_ENTRY, "mcp"],
      cwd: "./rea-pin",
    });
  });

  it("pins rea-agents to 6.4.0 with a lockfile integrity hash", () => {
    const pinPackage = JSON.parse(
      readFileSync(path.join(pluginRoot, "rea-pin/package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    const lock = JSON.parse(
      readFileSync(path.join(pluginRoot, "rea-pin/package-lock.json"), "utf8"),
    ) as {
      packages: Record<string, { version?: string; integrity?: string }>;
    };
    expect(pinPackage.dependencies["rea-agents"]).toBe("6.4.0");
    const locked = lock.packages["node_modules/rea-agents"];
    expect(locked?.version).toBe("6.4.0");
    expect(locked?.integrity).toMatch(/^sha512-/);

    const manifest = readPluginJson("branch.plugin.json");
    const servers = manifest.mcpServers as {
      rea: { args: string[]; command: string; cwd: string };
    };
    expect(servers.rea.command).toBe("node");
    expect(servers.rea.cwd).toBe("./rea-pin");
    expect(servers.rea.args).toEqual([LOCKED_REA_ENTRY, "mcp"]);
    const launch = servers.rea.args.join(" ");
    expect(launch).not.toContain("-y");
    expect(launch).not.toContain("@latest");
    expect(launch).not.toContain("rea-agents@");
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
    expect(approvalForReaTool("rea__open_binary")?.requireApproval.allowedDecisions).toEqual([
      "allow-once",
      "deny",
    ]);
    expect(approvalForReaTool("rea__analyze_javascript_application")).toBeUndefined();
    expect(approvalForReaTool("rea__list_strings")).toBeUndefined();

    const skill = readFileSync(
      path.join(pluginRoot, "skills/reverse-engineer-anything/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain(HARD_RULE);
    for (const tool of RISKY_REA_TOOLS) {
      expect(skill).toContain(`rea__${tool}`);
    }
  });

  it("asks first for every REA tool that changes something", () => {
    const effects = JSON.parse(
      readFileSync(path.join(pluginRoot, "rea-pin/tool-effects.json"), "utf8"),
    ) as Record<string, ReaToolEffect>;
    expect(Object.keys(effects)).toHaveLength(170);

    const mutating = Object.entries(effects)
      .filter(([, effect]) => reaToolChangesSomething(effect))
      .map(([name]) => name)
      .toSorted();
    expect([...RISKY_REA_TOOLS].toSorted()).toEqual(mutating);

    for (const tool of mutating) {
      expect(approvalForReaTool(`rea__${tool}`)?.requireApproval.allowedDecisions).toEqual([
        "allow-once",
        "deny",
      ]);
    }

    expect(effects.open_binary?.launchesProcess).toBe(true);
    expect(mutating).toContain("open_binary");
    expect(effects.analyze_javascript_application?.mutatesSession).toBe(true);
    expect(effects.analyze_javascript_application?.launchesProcess).toBe(false);
    expect(effects.analyze_javascript_application?.writesFilesystem).toBe(false);
    expect(mutating).not.toContain("analyze_javascript_application");
    expect(mutating).not.toContain("list_strings");
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
