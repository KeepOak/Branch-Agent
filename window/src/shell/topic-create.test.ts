// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTopicSession, TOPIC_EMOJI_KEY } from "./topic-create";

const target = { agentId: "oak", parentKey: "agent:oak:main" };
afterEach(() => localStorage.clear());

describe("R1 New topic", () => {
  it("creates a session under the Trunk's main conversation, named by its label, with no turn", async () => {
    const request = vi.fn(async () => ({ key: "agent:oak:trip" }));
    const key = await createTopicSession(request, target, { name: "Lisbon trip", icon: "✈️", colour: null });
    expect(key).toBe("agent:oak:trip");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("sessions.create", { agentId: "oak", parentSessionKey: "agent:oak:main", label: "Lisbon trip", displayName: "Lisbon trip" });
  });

  it("sends the chosen engine colour with sessions.patch, and keeps the icon in the rail's emoji map", async () => {
    const request = vi.fn(async (method: string) => (method === "sessions.create" ? { key: "agent:oak:trip" } : {}));
    await createTopicSession(request, target, { name: "Trip", icon: "🧠", colour: "purple" });
    expect(request).toHaveBeenLastCalledWith("sessions.patch", { key: "agent:oak:trip", agentId: "oak", color: "purple" });
    expect(JSON.parse(localStorage.getItem(TOPIC_EMOJI_KEY)!)).toEqual({ "agent:oak:trip": "🧠" });
  });

  it("refuses an empty name and an engine reply with no key", async () => {
    const request = vi.fn(async () => ({}));
    await expect(createTopicSession(request, target, { name: "   ", icon: "💬", colour: null })).rejects.toThrow("Give the topic a name.");
    expect(request).not.toHaveBeenCalled();
    await expect(createTopicSession(request, target, { name: "Trip", icon: "💬", colour: null })).rejects.toThrow("The engine made no topic.");
  });
});
