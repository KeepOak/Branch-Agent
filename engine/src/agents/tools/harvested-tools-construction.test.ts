import { describe, expect, it } from "vitest";
import { resolveCoreToolFactoryFamily } from "../core-tool-factory-descriptors.js";
import {
  applyEmbeddedAttemptToolsAllow,
  resolveEmbeddedAttemptToolConstructionPlan,
} from "../embedded-agent-runner/run/attempt-tool-construction-plan.js";
import { createSequentialThinkingTool } from "./sequential-thinking-tool.js";
import { createWeatherTool } from "./weather-tool.js";

describe("harvested tool backend construction", () => {
  it.each(["get_weather", "sequentialthinking", "calculate"])(
    "selects the actual core factory for narrow allowlist %s",
    (name) => {
      const plan = resolveEmbeddedAttemptToolConstructionPlan({
        toolsEnabled: true,
        toolsAllow: [name],
      });
      expect(resolveCoreToolFactoryFamily(name)).toBe("branch");
      expect(plan.constructTools).toBe(true);
      expect(plan.codingToolConstructionPlan).toMatchObject({
        includeBranchTools: true,
        includePluginTools: false,
        includeShellTools: false,
        includeBaseCodingTools: false,
      });
      expect(plan.runtimeToolAllowlist).toEqual([name]);
    },
  );
  it("retains existing allowlist and model-capability gates", async () => {
    const assembled = [createSequentialThinkingTool(), createWeatherTool()];
    const selected = applyEmbeddedAttemptToolsAllow(assembled, ["sequentialthinking"]);
    expect(selected.map((tool) => tool.name)).toEqual(["sequentialthinking"]);
    const result = await selected[0].execute("step", {
      thought: "Use supplied facts",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
    });
    expect(result.details).toMatchObject({ thoughtHistoryLength: 1, nextThoughtNeeded: false });
    expect(applyEmbeddedAttemptToolsAllow(assembled, [])).toEqual([]);
    expect(
      resolveEmbeddedAttemptToolConstructionPlan({
        toolsEnabled: false,
        toolsAllow: ["get_weather"],
      }).constructTools,
    ).toBe(false);
  });
});
