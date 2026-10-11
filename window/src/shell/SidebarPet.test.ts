import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { petWords, SidebarPet } from "./SidebarPet";

describe("the pet in the list", () => {
  it("says who needs a yes first", () => {
    expect(petWords("Ledger")).toBe("Ledger needs a yes. It’s in your Inbox.");
  });
  it("otherwise gives the tip for this minute", () => {
    expect(petWords(null, 0)).toBe("Type @ to call a Trunk into any conversation.");
    expect(petWords(null, 60000)).toBe("Ctrl K finds anything, even settings.");
  });
  it("names the pet's button for its menu, and never prints a loose z", () => {
    const markup = renderToStaticMarkup(createElement(SidebarPet, { pet: { id: "px-squirrel", name: "Hazel" }, waiting: null, still: true }));
    expect(markup).toContain('aria-label="Hazel. Tips and options."');
    expect(markup).not.toContain(">z<");
  });
});
