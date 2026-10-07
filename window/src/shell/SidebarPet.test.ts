import { describe, expect, it } from "vitest";
import { petWords } from "./SidebarPet";

describe("the pet in the list", () => {
  it("says who needs a yes first", () => {
    expect(petWords("Ledger")).toBe("Ledger needs a yes. It’s in your Inbox.");
  });
  it("otherwise gives the tip for this minute", () => {
    expect(petWords(null, 0)).toBe("Type @ to call a Trunk into any conversation.");
    expect(petWords(null, 60000)).toBe("Ctrl K finds anything, even settings.");
  });
});
