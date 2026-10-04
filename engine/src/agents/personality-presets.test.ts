// Adapted from letta-ai/letta-code@3687ea51f6d11eabc4ad7a7b163c649d023801ba src/agent/personality.test.ts.
import { describe, expect, it } from "vitest";
import {
  PERSONALITY_OPTIONS,
  getPersonalityOption,
  loadPersonalityFiles,
  resolvePersonalityId,
} from "./personality-presets.js";

describe("personality presets", () => {
  it("resolvePersonalityId accepts preset ids and the upstream aliases", () => {
    expect(resolvePersonalityId("rooted")).toBe("rooted");
    expect(resolvePersonalityId(" Blank ")).toBe("blank");
    expect(resolvePersonalityId("memo")).toBe("rooted");
    expect(resolvePersonalityId("kawaii")).toBe("blossom");
    expect(resolvePersonalityId("linus")).toBe("thorn");
    expect(resolvePersonalityId("unknown")).toBeNull();
    expect(resolvePersonalityId("")).toBeNull();
  });

  it("rejects unknown personalities", () => {
    expect(() => getPersonalityOption("missing" as never)).toThrow("Unknown personality: missing");
  });

  it("personality files always include both persona and human", async () => {
    for (const option of PERSONALITY_OPTIONS) {
      const files = await loadPersonalityFiles(option.id);
      expect(files["SOUL.md"].trim().length, option.id).toBeGreaterThan(0);
      expect(files["USER.md"].trim().length, option.id).toBeGreaterThan(0);
      expect(files["SOUL.md"]).not.toMatch(/^---/u);
    }
  });

  it("blank personality uses the blank persona and the default human file", async () => {
    const files = await loadPersonalityFiles("blank");
    expect(files["SOUL.md"]).toContain("This is a blank starter personality.");
    expect(files["USER.md"]).toContain("I haven't gotten to know this person yet.");
  });

  it("rooted personality carries the memory-first persona under Branch's name", async () => {
    const files = await loadPersonalityFiles("rooted");
    expect(files["SOUL.md"]).toContain("Branch for now. If they give me a better name, keep it.");
    expect(files["SOUL.md"]).toContain("Memory is part of my mind.");
    expect(files["USER.md"]).toContain("Learn sideways, through the work.");
  });

  it("personality content names no other product or real person", async () => {
    for (const option of PERSONALITY_OPTIONS) {
      const files = await loadPersonalityFiles(option.id);
      const content = `${files["SOUL.md"]}\n${files["USER.md"]}`;
      expect(content, option.id).not.toMatch(/letta|linus|torvalds|linux|claude|codex/iu);
    }
  });
});
