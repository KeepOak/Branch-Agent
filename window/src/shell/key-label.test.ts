import { describe, expect, it } from "vitest";
import { keyLabel } from "./key-label";

describe("keyLabel (DA-114)", () => {
  it("writes keys with Mac symbols on a Mac, the way the search field does", () => {
    expect(keyLabel("Ctrl K", true)).toBe("⌘K");
    expect(keyLabel("Ctrl N", true)).toBe("⌘N");
    expect(keyLabel("Ctrl .", true)).toBe("⌘.");
    expect(keyLabel("Ctrl ,", true)).toBe("⌘,");
    expect(keyLabel("Ctrl Shift Space", true)).toBe("⌘⇧Space");
    expect(keyLabel("Ctrl Alt ;", true)).toBe("⌘⌥;");
    expect(keyLabel("Hide the list (Ctrl+B)", true)).toBe("Hide the list (⌘B)");
    expect(keyLabel("Leave focus mode · Ctrl+.", true)).toBe("Leave focus mode · ⌘.");
  });

  it("leaves other computers, and text that is not a key, as written", () => {
    expect(keyLabel("Ctrl Shift Space", false)).toBe("Ctrl Shift Space");
    expect(keyLabel("Hide the list (Ctrl+B)", false)).toBe("Hide the list (Ctrl+B)");
    expect(keyLabel("Use Ctrl or Alt with it", true)).toBe("Use Ctrl or Alt with it");
    expect(keyLabel("2 min", true)).toBe("2 min");
    expect(keyLabel("?", true)).toBe("?");
    expect(keyLabel("", true)).toBe("");
  });
});
