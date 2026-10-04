// Adapted from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf
// plugins/plugin-personal-assistant/test/resolve-referent-action.integration.test.ts.
// The real tool runs over real memory files in a temp workspace: no resolver mock.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCaptureHarness, runTool } from "./capture-registration.test-support.js";
import { isImplicitAsk, resolveImplicitReferent } from "./resolve-referent.js";

let workspaceDir: string;

beforeEach(async () => {
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "resolve-referent-"));
});

afterEach(async () => {
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

async function writeMemory(relativePath: string, lines: string[]) {
  const filePath = path.join(workspaceDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${lines.map((line) => `- ${line}`).join("\n")}\n`);
}

function resolveTool(senderIsOwner = true) {
  return createCaptureHarness({ workspaceDir }).tool("resolve_referent", { senderIsOwner });
}

describe("resolve_referent tool (real memory files)", () => {
  it("validates only for under-specified asks", () => {
    expect(isImplicitAsk("Book the usual.")).toBe(true);
    expect(isImplicitAsk("Book a table at Osteria for 7pm.")).toBe(false);
  });

  it("is restricted to the owner", () => {
    expect(resolveTool(false)).toBeNull();
  });

  it("resolves 'the usual' against a dominant owner fact and previews it", async () => {
    await writeMemory("USER.md", [
      "Owner's usual dinner is the corner table at Osteria at 7pm.",
    ]);
    await writeMemory("MEMORY.md", ["Owner sometimes grabs coffee."]);
    const result = await runTool(resolveTool(), { ask: "Book the usual dinner." });
    expect(result.decision).toBe("resolved");
    expect(String(result.text)).toContain("Osteria");
    expect(result.selectedId).toBe("USER.md#L1");
  });

  it("asks a disambiguating question when two facts tie", async () => {
    await writeMemory("MEMORY.md", [
      "Owner's usual is the board prep block on Thursday afternoon.",
      "Owner's usual is the investor prep block on Thursday afternoon.",
    ]);
    const result = await runTool(resolveTool(), { ask: "Clear the usual for Thursday." });
    expect(result.decision).toBe("ask");
    expect(String(result.text)).toMatch(/^Do you mean .+ or .+\?$/u);
    expect(result.rankedIds).toEqual(["MEMORY.md#L1", "MEMORY.md#L2"]);
  });

  it("uses recent daily notes as episodic anchors without crashing on empty stores", async () => {
    const empty = await runTool(resolveTool(), { ask: "Same as last time, please." });
    expect(["resolved", "ask"]).toContain(empty.decision);
    await writeMemory("memory/2026-10-03.md", ["Booked the aisle seat on the red-eye flight to Denver."]);
    const result = await runTool(resolveTool(), { ask: "Book the flight same as last time." });
    expect(result.decision).toBe("resolved");
    expect(String(result.text)).toContain("red-eye");
  });

  it("does not resolve fully specified asks", async () => {
    const result = await runTool(resolveTool(), { ask: "Book a table at Osteria for 7pm." });
    expect(result.decision).toBe("not_implicit");
  });
});

describe("resolveImplicitReferent", () => {
  it("asks when the top score is below the confidence floor", () => {
    const resolution = resolveImplicitReferent({
      ask: "you know why",
      nowIso: "2026-10-04T00:00:00.000Z",
      candidates: [
        { id: "a", source: "owner_fact", label: "a", summary: "a", confirmation: "a" },
      ],
    });
    expect(resolution.decision).toBe("ask");
    expect(resolution.question).toBe("Do you mean a?");
  });
});
