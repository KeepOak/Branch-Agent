import { describe, expect, it } from "vitest";
import {
  CONVERSATION_MORE_IDLE_LABEL,
  conversationMoreLabel,
  conversationNeedsCount,
  conversationNeedsYou,
  pendingQuestionCount,
} from "./conversation-more";

describe("conversation header needs-you count and label", () => {
  it("keeps today's idle label when nothing is waiting", () => {
    expect(conversationNeedsCount(0, 0)).toBe(0);
    expect(conversationMoreLabel(0)).toBe(CONVERSATION_MORE_IDLE_LABEL);
    expect(conversationMoreLabel(0, "Conversation menu")).toBe("Conversation menu");
  });

  it("counts this conversation's approvals and questions, then labels the ⋯", () => {
    expect(conversationNeedsCount(1, 0)).toBe(1);
    expect(conversationMoreLabel(1)).toBe("More for this conversation, 1 needs you");
    expect(conversationNeedsCount(1, 1)).toBe(2);
    expect(conversationMoreLabel(2)).toBe("More for this conversation, 2 need you");
    expect(conversationNeedsCount(0, 3)).toBe(3);
    expect(conversationMoreLabel(3)).toBe("More for this conversation, 3 need you");
  });

  it("filters pending questions and approvals to this conversation", () => {
    const now = 1_000;
    const questions = [
      { status: "pending", expiresAtMs: 2_000 },
      { status: "pending", expiresAtMs: 500 },
      { status: "answered", expiresAtMs: 2_000 },
      { status: "pending" },
    ];
    expect(pendingQuestionCount(questions, now)).toBe(2);
    expect(conversationNeedsYou(new Map([["agent:oak:main", 1], ["agent:oak:other", 4]]), "agent:oak:main", questions, now)).toBe(3);
    expect(conversationNeedsYou(new Map([["agent:oak:other", 4]]), "agent:oak:main", [], now)).toBe(0);
    expect(conversationNeedsYou(new Map([["agent:oak:main", 2]]), null, questions, now)).toBe(0);
  });
});
