import { describe, expect, it } from "vitest";
import { bannerFor, firstLine } from "./banner-news";

const names = { title: (k: string) => `Title ${k}`, trunk: () => "Sapling" };

describe("banner words (§4.10.1)", () => {
  it("a Trunk that needs a yes, with what it wants to run", () => {
    expect(bannerFor("exec.approval.requested", { id: "1", request: { sessionKey: "a", command: "rm -rf build" } }, "b", names)).toMatchObject({ title: "Sapling needs a yes", text: "rm -rf build", sessionKey: "a" });
  });
  it("a finished conversation, with the first line of its answer; nothing for the one on screen", () => {
    const final = { sessionKey: "a", state: "final", message: { content: [{ type: "text", text: "## Done\nThe invoice is $100 short." }] } };
    expect(bannerFor("chat", final, "b", names)).toMatchObject({ title: "Title a", text: "Done" });
    expect(bannerFor("chat", final, "a", names)).toBeNull();
    expect(firstLine({ content: "\n**The invoice** is short" })).toBe("The invoice is short");
  });
});
