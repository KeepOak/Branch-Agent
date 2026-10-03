import { describe, expect, it } from "vitest";
import { projectConversation } from "./conversations";

describe("projectConversation", () => {
  it("reads a sessions.list row", () => {
    const row = projectConversation(
      {
        key: "agent:dev:dashboard:1",
        label: "Garden plan",
        displayName: "Ignored",
        agentId: "dev",
        pinned: true,
        archived: false,
        unread: true,
        snoozedUntil: 5000,
        createdAt: 10,
        updatedAt: 20,
        lastMessagePreview: "hello\n  there",
        hasActiveRun: false,
        activeRunIds: ["r1"],
        totalTokens: 100,
        contextTokens: 400,
      },
      "agent:dev:main",
    );
    expect(row).toMatchObject({
      key: "agent:dev:dashboard:1",
      title: "Garden plan",
      agentId: "dev",
      isMain: false,
      pinned: true,
      unread: true,
      snoozedUntil: 5000,
      preview: "hello there",
      working: true,
      totalTokens: 100,
      contextTokens: 400,
    });
  });

  it("falls back to displayName, then derivedTitle, and marks the main conversation", () => {
    expect(projectConversation({ key: "agent:dev:main", derivedTitle: "First words" }, "agent:dev:main")).toMatchObject({
      title: "First words",
      isMain: true,
      agentId: "dev",
      createdAt: 0,
    });
    expect(projectConversation({ key: "k", displayName: "Shown" }, null).title).toBe("Shown");
  });

  it("tolerates junk", () => {
    expect(projectConversation(null, null)).toMatchObject({ key: "", title: "", pinned: false, snoozedUntil: null });
  });
});
