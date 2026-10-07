import { describe, expect, it } from "vitest";
import { mayTalk } from "./who-it-knows";

describe("per-agent who-it-knows policy", () => {
  it("matches directional engine permissions", () => {
    const perAgent = { a: { agentToAgent: { allow: ["*"], deny: ["b"] } }, b: { agentToAgent: { deny: ["a"] } } };
    expect(mayTalk(undefined, undefined, "a", "later")).toBe(true);
    expect(mayTalk(undefined, perAgent, "a", "b")).toBe(false);
    expect(mayTalk(undefined, perAgent, "a", "later")).toBe(true);
    expect(mayTalk(undefined, perAgent, "b", "a")).toBe(false);
    expect(mayTalk(undefined, { a: { agentToAgent: { allow: [""] } } }, "a", "b")).toBe(false);
    expect(mayTalk(undefined, { a: { agentToAgent: { deny: [""] } } }, "a", "b")).toBe(false);
    expect(mayTalk({ enabled: false }, undefined, "a", "b")).toBe(false);
  });
});
