import { expect, it, vi } from "vitest";
import { createInstalledSkillTools } from "./installed-skill-tools.js";

const instructions = "---\nname: reviewed-skill\n---\nRead references/guide.md.\n";

it("delivers whole installed instructions and optional source readiness facts through skills_read", async () => {
  const reader = vi.fn(async () => instructions);
  const tools = createInstalledSkillTools([
    {
      name: "reviewed-skill",
      description: "Review fixture",
      location: "library://reviewed/SKILL.md",
      source: { filePath: "/not-an-ambient-host-file/SKILL.md" },
      reader,
    },
  ]);
  const read = tools.find((tool) => tool.name === "skills_read");
  expect(read).toBeDefined();
  const plain = await read!.execute("plain", { name: "reviewed-skill" });
  expect(plain.content).toEqual([{ type: "text", text: instructions }]);
  expect(plain.details).toEqual({ name: "reviewed-skill", content: instructions });
  const reviewed = await read!.execute("review", { name: "reviewed-skill", review: true });
  expect(reviewed.content[0]).toEqual({ type: "text", text: instructions });
  expect(reviewed.details).toMatchObject({
    content: instructions,
    review: {
      declaredName: "reviewed-skill",
      findings: [{ ruleId: "structure.missing-description", severity: "blocker" }],
      completeness: { packageEnumerated: false, textContentComplete: true },
      resources: {
        unresolved: [{ source: "SKILL.md", target: "references/guide.md" }],
        findings: [],
      },
    },
  });
  expect(reader).toHaveBeenCalledTimes(2);
});

it("uses catalog inline instructions without exposing another path and rejects unknown skills", async () => {
  const tools = createInstalledSkillTools([
    {
      name: "reviewed-skill",
      description: "Review fixture",
      location: "memory://fixture/SKILL.md",
      source: { filePath: "/not-an-ambient-host-file/SKILL.md", readContent: instructions },
    },
  ]);
  const read = tools.find((tool) => tool.name === "skills_read")!;
  await expect(read.execute("unknown", { name: "other", review: true })).rejects.toThrow(
    "Unknown installed skill",
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    read.execute("aborted", { name: "reviewed-skill", review: true }, controller.signal),
  ).rejects.toThrow();
  expect(
    (await read.execute("inline", { name: "reviewed-skill", review: true })).details,
  ).toMatchObject({ content: instructions, review: { declaredName: "reviewed-skill" } });
});

it("does not publish a review after catalog revision changes during an opaque read", async () => {
  let current = true;
  const tools = createInstalledSkillTools([
    {
      name: "reviewed-skill",
      description: "Review fixture",
      location: "library://fixture/SKILL.md",
      source: { filePath: "/not-an-ambient-host-file/SKILL.md" },
      reader: async () => {
        current = false;
        return instructions;
      },
      assertCurrent: () => {
        if (!current) {
          throw new Error("Catalog changed");
        }
      },
    },
  ]);
  const read = tools.find((tool) => tool.name === "skills_read")!;
  await expect(read.execute("stale", { name: "reviewed-skill", review: true })).rejects.toThrow(
    "Catalog changed",
  );
});
