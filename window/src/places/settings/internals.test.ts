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
    // Host names, versions and ordinary sentences with a dot are never keys, so their summaries pass through.
    for (const plain of ["Signed in to keepoak.com", "Fetched example.org", "Updated to 0.4.4.", "Moved tools.dev to agents.io", "Done. Next step."]) {
      expect(hasRawKey(plain), plain).toBe(false);
    }
    // Real settings paths, with an index or a profile id, are gated.
    expect(hasRawKey("Changed agents.entries.x.model.fallbacks[0]")).toBe(true);
    expect(hasRawKey("Configuration updated: auth.profiles.anthropic:someone@example.com, plugins.installs")).toBe(true);
    expect(hasRawKey("Set update.channel")).toBe(true);
  });

  it("names a Branch version without its build hash below Technical", () => {
    expect(versionLabel("0.4.4-build-d1225fcd", 0)).toBe("0.4.4");
    expect(versionLabel("0.4.4-build-d1225fcd", "advanced")).toBe("0.4.4");
    expect(versionLabel("0.4.4-build-d1225fcd", 2)).toContain("d1225fcd");
  });
});
