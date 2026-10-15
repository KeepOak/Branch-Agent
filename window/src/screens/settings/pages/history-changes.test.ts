import { describe, expect, it } from "vitest";
import { changeLines } from "./history-live";

// Every change at Regular and Advanced: plain sentences. Raw keys stay at Technical.
describe("Every change lines", () => {
  it("keeps a file name in a summary as plain words below Technical", () => {
    const line = changeLines({ source: "cli", summary: "Saved memory.md and session.json", at: 1, changedPaths: [] }, false);
    expect(line.title).toContain("Saved memory.md and session.json");
  });

  it("counts settings in words below Technical instead of listing their keys", () => {
    const line = changeLines({ source: "cli", summary: "Configuration updated", at: 1, changedPaths: ["tools.exec.mode", "plugins.installs"] }, false);
    expect(line.title).toContain("Changed 2 settings");
    expect(line.title).not.toContain("tools.exec.mode");
  });

  it("shows the keys at Technical", () => {
    const line = changeLines({ source: "cli", summary: "Configuration updated", at: 1, changedPaths: ["tools.exec.mode"] }, true);
    expect(line.sub).toContain("tools.exec.mode");
  });
});
