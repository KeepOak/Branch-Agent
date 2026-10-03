// Scheduled show_widget registration and allowlist coverage.
import { describe, expect, it, vi } from "vitest";
import { createBranchCodingTools } from "./agent-tools.js";
import { resolveEmbeddedAttemptToolConstructionPlan } from "./embedded-agent-runner/run/attempt-tool-construction-plan.js";
import { createBranchTools } from "./branch-tools.js";

vi.mock("./branch-plugin-tools.js", () => ({
  resolveBranchPluginToolsForOptions: () => [],
}));

function expectWidget(tools: ReturnType<typeof createBranchTools>) {
  const tool = tools.find((candidate) => candidate.name === "show_widget");
  if (!tool) {
    throw new Error("Expected show_widget to be registered");
  }
  return tool;
}

function expectPinnedOnlySchema(tool: ReturnType<typeof expectWidget>): void {
  const schema = tool.parameters as {
    properties?: { pin?: { const?: boolean } };
    required?: string[];
  };
  expect(tool.requiredClientCaps).toBeUndefined();
  expect(schema.required).toContain("pin");
  expect(schema.properties?.pin?.const).toBe(true);
}

describe("pinned show_widget registration", () => {
  it.each([undefined, "agent:main:cron:job:run:detached"])(
    "requires a persistent session for recovered authoring (%s)",
    (agentSessionKey) => {
      const tools = createBranchTools({ agentSessionKey, pinnedWidgetAuthoring: true });
      expect(tools.some((tool) => tool.name === "show_widget")).toBe(false);
    },
  );

  it("applies tool policy to recovered dashboard authoring", () => {
    const options = {
      sessionKey: "agent:main:dashboard:recovered",
      pinnedWidgetAuthoring: true,
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: false,
        includeChannelTools: false,
        includeBranchTools: true,
        includePluginTools: false,
      },
    };
    expectPinnedOnlySchema(expectWidget(createBranchCodingTools(options)));
    const deniedTools = createBranchCodingTools({
      ...options,
      config: { tools: { deny: ["show_widget"] } },
    });
    expect(deniedTools.some((tool) => tool.name === "show_widget")).toBe(false);
  });

  it("does not let scheduled provenance replace an explicit widget cap", () => {
    const tools = createBranchTools({
      agentSessionKey: "agent:main:dashboard:scheduled",
      gatewayCallerScheduled: true,
    });

    expect(tools.some((tool) => tool.name === "show_widget")).toBe(false);
  });

  it("honors an explicit widget deny on the scheduled surface", () => {
    const tools = createBranchTools({
      agentSessionKey: "agent:main:dashboard:scheduled",
      gatewayCallerScheduled: true,
      runtimeToolAllowlist: ["show_widget"],
      config: { tools: { deny: ["show_widget"] } },
    });

    expect(tools.some((tool) => tool.name === "show_widget")).toBe(false);
  });

  it.each(["show_widget", "canvas"])(
    "lets a server-authorized %s cap select pinned widget authoring",
    (toolName) => {
      const toolsAllow = [toolName];
      const plan = resolveEmbeddedAttemptToolConstructionPlan({ toolsAllow });
      const tools = createBranchCodingTools({
        sessionKey: "agent:main:dashboard:scheduled",
        scheduledToolPolicy: { version: 1, mode: "trusted" },
        runtimeToolAllowlist: plan.runtimeToolAllowlist,
        includeCoreTools: plan.includeCoreTools,
        config: { tools: { allow: toolsAllow } },
        toolConstructionPlan: plan.codingToolConstructionPlan,
      });

      expectPinnedOnlySchema(expectWidget(tools));
    },
  );

  it("keeps scheduled turns with a real inline client on the normal widget surface", () => {
    const tool = expectWidget(
      createBranchTools({
        agentSessionKey: "agent:main:dashboard:scheduled",
        gatewayCallerScheduled: true,
        runtimeToolAllowlist: ["show_widget"],
        clientCaps: ["inline-widgets"],
      }),
    );
    const schema = tool.parameters as { required?: string[] };

    expect(tool.requiredClientCaps).toEqual(["inline-widgets"]);
    expect(schema.required).not.toContain("pin");
  });
});
