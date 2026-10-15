import { describe, expect, it } from "vitest";
import type { Topic } from "@branch/gateway-protocol";
import { graftedContactOf, isGraftedContactKey, newestGraftedTopic, openConversationName } from "./open-name";

const trunks = [{ id: "juniper", name: "Juniper" }, { id: "projects-manager", name: "Projects Manager" }];
const grafted = new Map([["a2a:claude-code", "Claude Code"]]);
const base = { trunks, grafted, defaultAgentId: "juniper", fallback: "Juniper" };

describe("grafted keys", () => {
  it("tells a grafted contact's key from a conversation key", () => {
    expect(isGraftedContactKey("a2a:claude-code")).toBe(true);
    expect(isGraftedContactKey("agent:juniper:a2a:claude-code")).toBe(false);
    expect(isGraftedContactKey("agent:juniper:main")).toBe(false);
    expect(isGraftedContactKey(null)).toBe(false);
  });

  it("reads the grafted contact of a direct conversation the way the engine's contacts projection does", () => {
    expect(graftedContactOf("agent:juniper:a2a:acct:direct:claude-code:1")).toBe("a2a:claude-code");
    expect(graftedContactOf("a2a:claude-code")).toBe("a2a:claude-code");
    // The default Trunk's own conversation filed under a bare a2a key is the Trunk's, as the engine counts it.
    expect(graftedContactOf("agent:juniper:a2a:claude-code")).toBeNull();
    expect(graftedContactOf("agent:projects-manager:main")).toBeNull();
  });
});

describe("openConversationName", () => {
  it("names the Trunk the open conversation belongs to, not the default Trunk", () => {
    expect(openConversationName({ ...base, key: "agent:projects-manager:main" })).toBe("Projects Manager");
    expect(openConversationName({ ...base, key: "agent:projects-manager:topic-1", row: { kind: "direct", title: "Release notes", agentId: "projects-manager" } })).toBe("Projects Manager");
    expect(openConversationName({ ...base, key: "agent:juniper:main" })).toBe("Juniper");
  });

  it("names a group by its own name and a grafted agent by its card name", () => {
    expect(openConversationName({ ...base, key: "agent:juniper:room:r1", row: { kind: "group", title: "Launch crew", agentId: "juniper", groupChat: true } })).toBe("Launch crew");
    expect(openConversationName({ ...base, key: "a2a:claude-code" })).toBe("Claude Code");
    expect(openConversationName({ ...base, key: "agent:juniper:a2a:acct:direct:claude-code:1" })).toBe("Claude Code");
    expect(openConversationName({ ...base, key: "a2a:unknown-peer" })).toBe("unknown-peer");
  });

  it("falls back while the Trunks list is still loading", () => {
    const loading = { ...base, trunks: [] };
    expect(openConversationName({ ...loading, key: "agent:juniper:main" })).toBe("Juniper");
    expect(openConversationName({ ...loading, key: "agent:main:main", defaultAgentId: undefined })).toBe("Sapling");
    expect(openConversationName({ ...loading, key: null })).toBe("Juniper");
  });
});

describe("newestGraftedTopic", () => {
  const topic = (key: string, at: number, status: Topic["status"] = "active"): Topic => ({ key, contactId: "a2a:claude-code", title: key, labelled: false, anchor: { threadKey: "a2a:claude-code", at }, status, unread: false });
  it("picks the most recent conversation that isn't archived, and none when there is none", () => {
    expect(newestGraftedTopic([topic("a", 1), topic("b", 3), topic("c", 5, "archived")])).toBe("b");
    expect(newestGraftedTopic([topic("c", 5, "archived")])).toBeNull();
    expect(newestGraftedTopic([])).toBeNull();
  });
});
