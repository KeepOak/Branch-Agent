import { describe, expect, it } from "vitest";
import { lastSpeakerWho } from "./topic-who";

describe("lastSpeakerWho", () => {
  it("reads You from a user line and the contact name from that thread's own last text", () => {
    expect(lastSpeakerWho([{ kind: "text" }, { kind: "user" }], "Oak")).toBe("You");
    expect(lastSpeakerWho([{ kind: "user" }, { kind: "text" }], "Oak")).toBe("Oak");
    expect(lastSpeakerWho([], "Oak")).toBe("");
  });
});
