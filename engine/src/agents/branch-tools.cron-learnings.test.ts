// AUTOMATION-0200: the production tool assembly gives learning tools to scheduled runs only.
import { describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../config/config.js";
import { createBranchTools } from "./branch-tools.js";
import { resolveCoreToolFactoryFamily } from "./core-tool-factory-descriptors.js";

vi.mock("./branch-plugin-tools.js", () => ({
  resolveBranchPluginToolsForOptions: () => [],
}));

const config: BranchConfig = { agents: { entries: { main: { default: true } } } };

function names(runSessionKey: string): string[] {
  return createBranchTools({
    config,
    agentSessionKey: "agent:main:cron:job-1",
    runSessionKey,
    disableMessageTool: true,
    disablePluginTools: true,
    wrapBeforeToolCallHook: false,
  }).map((tool) => tool.name);
}

describe("scheduled-run learning tools", () => {
  it("are assembled for an isolated scheduled run and nowhere else", () => {
    expect(names("agent:main:cron:job-1:run:run-1")).toEqual(
      expect.arrayContaining(["save_run_learning", "delete_run_learning"]),
    );
    expect(names("agent:main:main")).not.toContain("save_run_learning");
    expect(resolveCoreToolFactoryFamily("save_run_learning")).toBe("branch");
    expect(resolveCoreToolFactoryFamily("delete_run_learning")).toBe("branch");
  });
});
