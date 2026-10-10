import { describe, expect, it } from "vitest";
import { channelOf, cleanName, plainStatus } from "./plain-words";

describe("plain words for conversations", () => {
  it("drops the chat-app id from a name", () => {
    expect(cleanName("Taofik Bishi id:5660235788")).toBe("Taofik Bishi");
    expect(cleanName("Ada (id 12345678)")).toBe("Ada");
  });
  it("keeps a name that has no id", () => {
    expect(cleanName("Juniper's notes")).toBe("Juniper's notes");
  });
  it("turns the heartbeat marker into a plain sentence with the chat app", () => {
    expect(plainStatus("[Branch Agent heartbeat poll]", "agent:juniper:telegram:direct:1")).toBe("Heartbeat check, from Telegram");
    expect(plainStatus("[Branch Agent heartbeat poll]")).toBe("Heartbeat check");
  });
  it("hides other bracketed engine markers rather than showing them", () => {
    expect(plainStatus("[Branch Agent exec completion]")).toBe("");
  });
  it("reads the chat app from a conversation key", () => {
    expect(channelOf("agent:ada:discord:group:9")).toBe("Discord");
    expect(channelOf("agent:ada:main")).toBe("");
  });
});
