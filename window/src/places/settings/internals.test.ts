import { describe, expect, it } from "vitest";
import { INTERNALS_FROM, hasRawKey, showsInternals, versionLabel } from "./internals";

describe("engine internals show only at Technical", () => {
  it("answers for R1's numbers and Classic's words alike", () => {
    expect(INTERNALS_FROM).toBe(2);
    expect([0, 1, 2].map(showsInternals)).toEqual([false, false, true]);
    expect((["regular", "advanced", "technical"] as const).map(showsInternals)).toEqual([false, false, true]);
  });

  it("finds raw settings keys and leaves plain words alone", () => {
    expect(hasRawKey("Branch has one switch for every app (messages.statusReactions.enabled).")).toBe(true);
    expect(hasRawKey("CLI updated configuration: agents.entries.main.model.fallbacks[0], plugins.installs")).toBe(true);
    expect(hasRawKey("Changed the night window")).toBe(false);
    expect(hasRawKey("You have Branch 0.4.4.")).toBe(false);
  });

  it("does not take a file name for a settings key", () => {
    expect(hasRawKey("Updated memory.md with the week's notes")).toBe(false);
    expect(hasRawKey("Saved session.json and skills.yaml")).toBe(false);
    expect(hasRawKey("Read notes.txt, build.ts and logo.png")).toBe(false);
    expect(hasRawKey("Exported the report.pdf")).toBe(false);
    expect(hasRawKey("Changed agents.entries.main.model.fallbacks[0]")).toBe(true);
    expect(hasRawKey("Set tools.exec.mode and session.json")).toBe(true);
  });

  it("names a Branch version without its build hash below Technical", () => {
    expect(versionLabel("0.4.4-build-d1225fcd", 0)).toBe("0.4.4");
    expect(versionLabel("0.4.4-build-d1225fcd", "advanced")).toBe("0.4.4");
    expect(versionLabel("0.4.4-build-d1225fcd", 2)).toContain("d1225fcd");
  });
});
