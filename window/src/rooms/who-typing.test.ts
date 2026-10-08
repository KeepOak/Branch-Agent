import { describe, expect, it } from "vitest";
import { whoTypingLine, whoTypingName } from "./who-typing";

describe("whoTypingName", () => {
  it("names the first room member in a group, else the Trunk", () => {
    expect(whoTypingName({ kind: "group", roomPicks: [{ name: "Dana" }, { name: "Ada" }] }, "Ada")).toBe("Dana");
    expect(whoTypingName({ kind: "chatGroup" }, "Scout")).toBe("Scout");
    expect(whoTypingName({ kind: "trunk" }, "Ada")).toBeUndefined();
    expect(whoTypingName({ kind: "group" }, "")).toBeUndefined();
  });

  it("writes the preview's whoTypT5 words", () => {
    expect(whoTypingLine("Dana")).toBe("Dana is typing…");
  });
});
