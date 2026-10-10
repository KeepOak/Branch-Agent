import { describe, expect, it } from "vitest";
import { listToolsetIds } from "../agents/tool-toolsets.js";
import { AgentsSchema } from "./zod-schema.agents.js";

function issuesFor(toolsets: Record<string, boolean>): string[] {
  const result = AgentsSchema.safeParse({ entries: { ops: { toolsets } } });
  if (result.success) {
    return [];
  }
  return result.error.issues.map((issue) => issue.message);
}

describe("agents.entries.<id>.toolsets", () => {
  it("accepts on and off switches for known toolsets", () => {
    const result = AgentsSchema.safeParse({
      entries: { ops: { toolsets: { browser: false, files: true } } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown toolset name with a plain message listing the known names", () => {
    expect(issuesFor({ brwoser: false })).toEqual([
      `Unknown toolset "brwoser". Known toolsets: ${listToolsetIds().join(", ")}.`,
    ]);
  });

  it("rejects switching off an always-on tool", () => {
    expect(issuesFor({ message: false })).toEqual([
      '"message" is always on and cannot be switched off.',
    ]);
  });
});
