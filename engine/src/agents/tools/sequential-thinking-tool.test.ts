import { describe, expect, it } from "vitest";
import { createSequentialThinkingTool } from "./sequential-thinking-tool.js";

const thought = {
  thought: "Inspect the supplied facts",
  thoughtNumber: 1,
  totalThoughts: 2,
  nextThoughtNeeded: true,
};
describe("harvested sequential thinking", () => {
  it("returns the thought and tracks subsequent steps", async () => {
    const tool = createSequentialThinkingTool();
    const first = await tool.execute("a", thought);
    expect(JSON.parse(first.content[0].text!)).toMatchObject({
      ...thought,
      thoughtHistoryLength: 1,
      branches: [],
    });
    const second = await tool.execute("b", {
      ...thought,
      thoughtNumber: 2,
      nextThoughtNeeded: false,
    });
    expect(second.details).toMatchObject({ thoughtHistoryLength: 2, nextThoughtNeeded: false });
  });
  it("expands the estimate when more steps are required", async () => {
    const result = await createSequentialThinkingTool().execute("a", {
      ...thought,
      thoughtNumber: 5,
    });
    expect(result.details).toMatchObject({ totalThoughts: 5, thoughtNumber: 5 });
  });
  it("supports revisions and named branches without resetting history", async () => {
    const tool = createSequentialThinkingTool();
    await tool.execute("a", thought);
    await tool.execute("b", { ...thought, isRevision: true, revisesThought: 1 });
    await tool.execute("c", { ...thought, branchFromThought: 1, branchId: "alternative" });
    const result = await tool.execute("d", {
      ...thought,
      branchFromThought: 1,
      branchId: "alternative",
    });
    expect(result.details).toMatchObject({ thoughtHistoryLength: 4, branches: ["alternative"] });
  });
  it("isolates state between assembled instances", async () => {
    const a = createSequentialThinkingTool();
    const b = createSequentialThinkingTool();
    await a.execute("a", { ...thought, branchFromThought: 1, branchId: "a" });
    expect((await b.execute("b", thought)).details).toMatchObject({
      thoughtHistoryLength: 1,
      branches: [],
    });
  });
  it.each([
    null,
    {},
    { ...thought, thought: "" },
    { ...thought, thoughtNumber: "1" },
    { ...thought, totalThoughts: 0 },
    { ...thought, nextThoughtNeeded: "false" },
  ])(
    "returns the upstream failure shape without adding invalid input to history (%j)",
    async (input) => {
      const tool = createSequentialThinkingTool();
      expect((await tool.execute("bad", input)).details).toMatchObject({
        status: "failed",
        isError: true,
      });
      expect((await tool.execute("valid", thought)).details).toMatchObject({
        thoughtHistoryLength: 1,
      });
    },
  );
  it("retains source schema and default behavior without invented caps", () => {
    const tool = createSequentialThinkingTool();
    expect(tool.name).toBe("sequentialthinking");
    expect(tool.parameters.required).toEqual([
      "thought",
      "nextThoughtNeeded",
      "thoughtNumber",
      "totalThoughts",
    ]);
    expect(tool.parameters.properties.totalThoughts).toEqual({
      type: "integer",
      description: "Estimated total thoughts needed",
      minimum: 1,
    });
  });
});
