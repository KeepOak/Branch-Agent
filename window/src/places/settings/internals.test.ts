import { describe, expect, it } from "vitest";
import { INTERNALS_FROM, hasRawKey, plainCopy, showsInternals, versionLabel } from "./internals";

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

  it("says engine for Gateway below Technical, and keeps the raw key at Technical", () => {
    expect(plainCopy("Gateway comes in a later update.", 0)).toBe("The engine comes in a later update.");
    expect(plainCopy("Turn it off when the Gateway is idle.", "regular")).toBe("Turn it off when the engine is idle.");
    expect(plainCopy("Needs a Gateway restart.", "advanced")).toBe("Needs an engine restart.");
    expect(plainCopy("Set gateway.auth.token in the file.", 0)).toBe("Set gateway.auth.token in the file.");
    expect(plainCopy("Gateway comes in a later update.", 2)).toBe("Gateway comes in a later update.");
  });

  it("leaves copy without the word alone, and no Regular row keeps Gateway", () => {
    expect(plainCopy("Branch is running.", 0)).toBe("Branch is running.");
    const rows = ["Remote access", "Gateway (Off / When needed / On)", "Keep the gateway running while Trunks work"];
    for (const row of rows) expect(plainCopy(row, 0)).not.toMatch(/gateway/i);
  });
});
