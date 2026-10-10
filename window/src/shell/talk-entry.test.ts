// DA-16: the top bar's "Ask <Trunk>" and the sidebar's talk button open the same pane; only one shows at a time.
import { describe, expect, it } from "vitest";
import { sideShown, topBarTalk, type SideState } from "./talk-entry";

const entry = { name: "Oak", keys: "Ctrl Shift H", open: false, onToggle: () => undefined };
const wide: SideState = { dedicated: false, focus: false, narrow: false, slideOpen: false, hidden: false };

describe("DA-16 one talk entry on screen", () => {
  it("keeps the top bar button away while the sidebar shows its own", () => {
    expect(sideShown(wide)).toBe(true);
    expect(topBarTalk(entry, wide)).toBeNull();
    expect(topBarTalk(entry, { ...wide, narrow: true, slideOpen: true })).toBeNull();
  });

  it("puts it in the top bar when the list is out of sight", () => {
    for (const side of [{ ...wide, hidden: true }, { ...wide, focus: true }, { ...wide, dedicated: true }, { ...wide, narrow: true, slideOpen: false }]) {
      expect(sideShown(side)).toBe(false);
      expect(topBarTalk(entry, side)).toBe(entry);
    }
  });

  it("stays absent on pages with no talk entry (a conversation)", () => {
    expect(topBarTalk(null, { ...wide, hidden: true })).toBeNull();
  });
});
