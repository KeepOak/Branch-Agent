import { describe, expect, it } from "vitest";
import { resolveSkillWorkshopConfig } from "./config.js";

describe("resolveSkillWorkshopConfig", () => {
  it("defaults autonomous learning to auto", () => {
    expect(resolveSkillWorkshopConfig().autonomous.mode).toBe("auto");
    expect(resolveSkillWorkshopConfig().highestStep).toBe("tool");
  });

  it.each(["off", "propose"] as const)("reads autonomous mode %s", (mode) => {
    expect(
      resolveSkillWorkshopConfig({ skills: { workshop: { autonomous: { mode } } } }).autonomous
        .mode,
    ).toBe(mode);
  });

  it("does not read the retired boolean key at runtime", () => {
    expect(
      resolveSkillWorkshopConfig({
        skills: { workshop: { autonomous: { enabled: false } } },
      } as never).autonomous.mode,
    ).toBe("auto");
  });
  it.each(["skill", "tool"] as const)("reads highest step %s", (highestStep) => {
    expect(resolveSkillWorkshopConfig({ skills: { workshop: { highestStep } } }).highestStep).toBe(
      highestStep,
    );
  });
});
