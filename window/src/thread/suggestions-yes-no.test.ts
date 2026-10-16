import { describe, expect, it } from "vitest";
import type { Block } from "./model";
import { isYesNoQuestion, suggestionsFor } from "./suggestions";

const user = (text: string): Block => ({ kind: "user", key: `u:${text}`, text });
const reply = (text: string): Block => ({ kind: "text", key: `r:${text}`, text, streaming: false });
const chips = (text: string) => suggestionsFor([user("Hi"), reply(text)], false, false);

describe("Yes and No only under a yes/no question", () => {
  it("offers none under a greeting or a question that asks what, how or which", () => {
    expect(chips("Hey Taofik! What's up?")).toEqual([]);
    expect(chips("Done. How would you like the report laid out?")).toEqual([]);
    expect(chips("Which branch should I use?")).toEqual([]);
    expect(chips("Do you want the short version or the full one?")).toEqual([]);
  });

  it("offers none under a request addressed to you", () => {
    expect(chips("Can you check the numbers before I send it?")).toEqual([]);
    expect(chips("Could you elaborate?")).toEqual([]);
    expect(isYesNoQuestion("Would you share the logs?")).toBe(false);
    expect(isYesNoQuestion("Ready?")).toBe(false);
    expect(isYesNoQuestion("Ready to ship?")).toBe(true);
  });

  it("offers Yes and No under a yes/no question", () => {
    expect(chips("I drafted the reply. Is that okay?")).toEqual(["Yes", "No"]);
    expect(chips("Did you check the numbers before I sent it?")).toEqual(["Yes", "No"]);
    expect(chips("So, should we keep the old name?")).toEqual(["Yes", "No"]);
    expect(chips("I'll merge it after the checks, sound good?")).toEqual(["Yes", "No"]);
  });

  it("keeps the offer chips for an offer", () => {
    expect(chips("Should I merge it?")).toEqual(["Yes, please", "Not now"]);
  });

  it("reads the question itself", () => {
    expect(isYesNoQuestion("Isn't that the one from last week?")).toBe(true);
    expect(isYesNoQuestion("Won't that break the build?")).toBe(true);
    expect(isYesNoQuestion("Should we ship it or not?")).toBe(true);
    expect(isYesNoQuestion("What's up?")).toBe(false);
    expect(isYesNoQuestion("Why did it fail?")).toBe(false);
  });
});
