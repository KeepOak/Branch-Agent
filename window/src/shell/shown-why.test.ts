// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { IN_BROWSER, NEEDS_NEWER_APP } from "../connect/desktop-controls";
import { NOSETUP } from "../places/settings/kit";
import { isDevNote, shownWhy } from "./shown-why";
import { visibleDevNotes } from "./shown-why.testing";

describe("shownWhy", () => {
  it("hides the three developer-note families", () => {
    for (const note of [
      "Needs the engine’s procedure store.",
      "Needs the engine's run replay method.",
      "Needs the engine to clean pages before a Trunk reads them.",
      "Needs the engine’s record of interrupted work",
      NEEDS_NEWER_APP,
      "Branch has no setting for this yet.",
      "  Needs the engine’s memory watch.",
      "Needs a per-tool ask setting in the engine.",
    ]) {
      expect(isDevNote(note)).toBe(true);
      expect(shownWhy(note)).toBeUndefined();
    }
  });
  it("keeps every other reason as it is", () => {
    for (const why of [NOSETUP, IN_BROWSER, "The desktop app owns this; the window can’t change it yet.", "Needs an owner", "Saving…"]) {
      expect(isDevNote(why)).toBe(false);
      expect(shownWhy(why)).toBe(why);
    }
  });
  it("passes no reason through as none", () => {
    expect(shownWhy(undefined)).toBeUndefined();
    expect(shownWhy(null)).toBeUndefined();
    expect(shownWhy("")).toBeUndefined();
    expect(isDevNote(undefined)).toBe(false);
  });
});

describe("visibleDevNotes", () => {
  it("finds a note in text, tooltips, labels and described-by targets", () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.innerHTML = `<p id="d">Branch has no setting for this yet.</p><button title="Shape. Needs the engine’s look." aria-describedby="d">Go</button>`;
    expect(visibleDevNotes(host.querySelector("button")!)).toEqual(["button[title]: Shape. Needs the engine’s look.", "button[aria-describedby]: Branch has no setting for this yet."]);
    expect(visibleDevNotes(host)).toHaveLength(3);
    host.innerHTML = `<button disabled data-reason="Needs the engine’s look." title="Only an owner can change this.">Go</button>`;
    expect(visibleDevNotes(host)).toEqual([]);
    host.remove();
  });
});
