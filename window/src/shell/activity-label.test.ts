import { describe, expect, it } from "vitest";
import { ROUTINE_CHECK_IN, activityLabel, activityRowLines } from "./activity-label";

describe("activityLabel", () => {
  it("turns a heartbeat-poll session label into a routine check-in", () => {
    expect(activityLabel("[Branch Agent heartbeat poll]")).toBe(ROUTINE_CHECK_IN);
    expect(activityLabel("Branch Agent heartbeat poll")).toBe(ROUTINE_CHECK_IN);
    expect(activityLabel("heartbeat wake")).toBe(ROUTINE_CHECK_IN);
  });

  it("shows only the display name from a sender label with a numeric chat-app id", () => {
    expect(activityLabel("Alex River id:10001")).toBe("Alex River");
    expect(activityLabel("Alex River  id:10001")).toBe("Alex River");
    expect(activityLabel("Alex River ID:10001")).toBe("Alex River");
  });

  it("never keeps an id: prefix or a bare chat-app id", () => {
    expect(activityLabel("id:10001", "Conversation")).toBe("Conversation");
    expect(activityLabel("Alex River id:10001")).not.toMatch(/id:/i);
    expect(activityLabel("Alex River id:10001")).not.toContain("10001");
  });

  it("keeps an ordinary conversation title", () => {
    expect(activityLabel("Sort the receipts")).toBe("Sort the receipts");
    expect(activityLabel("  ", "Conversation")).toBe("Conversation");
  });
});

describe("activityRowLines", () => {
  it("pairs a contact name with a friendly check-in detail", () => {
    expect(activityRowLines("Alex River id:10001", "[Branch Agent heartbeat poll]")).toEqual({
      title: "Alex River",
      detail: ROUTINE_CHECK_IN,
    });
  });

  it("uses the friendly check-in as the title when that is the session label", () => {
    expect(activityRowLines("[Branch Agent heartbeat poll]", "Alex River id:10001")).toEqual({
      title: ROUTINE_CHECK_IN,
      detail: "Alex River",
    });
  });
});
