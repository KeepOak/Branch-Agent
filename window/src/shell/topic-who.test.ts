import { describe, expect, it } from "vitest";
import { lastSpeakerWho, topicSenderPrefix, topicSpeakerKeys } from "./topic-who";

describe("preview thread sender prefixes", () => {
  it("keeps General's who on General's last speaker when a child thread is open", () => {
    const keys = topicSpeakerKeys("agent:oak:main", [{ key: "agent:oak:trip" }]);
    expect(keys).toEqual(["agent:oak:main", "agent:oak:trip"]);
    const speakers = Object.fromEntries([
      ["agent:oak:main", topicSenderPrefix({ kind: "user" }, "Oak")],
      ["agent:oak:trip", topicSenderPrefix({ kind: "text" }, "Oak")],
    ]);
    expect(speakers["agent:oak:main"]).toBe("You");
    expect(speakers["agent:oak:trip"]).toBe("Oak");
  });

  it("uses You for a user line, the contact for a reply, and blank when there is no line", () => {
    expect(topicSenderPrefix({ kind: "user" }, "Oak")).toBe("You");
    expect(topicSenderPrefix({ kind: "text" }, "Oak")).toBe("Oak");
    expect(topicSenderPrefix(undefined, "Oak")).toBe("");
    expect(lastSpeakerWho([{ kind: "text" }, { kind: "user" }], "Oak")).toBe("You");
    expect(lastSpeakerWho([{ kind: "user" }, { kind: "text" }], "Oak")).toBe("Oak");
    expect(lastSpeakerWho([], "Oak")).toBe("");
  });
});
