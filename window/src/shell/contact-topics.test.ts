import { describe, expect, it } from "vitest";
import type { Topic } from "@branch/gateway-protocol";
import { groupContactTopics, type TopicListItem } from "./contact-topics";

const item = (key: string, title: string, at: number, extras: Partial<Topic> = {}): TopicListItem => ({
  topic: { key, title, contactId: "trunk:oak", status: "active", unread: false, ...extras }, updatedAt: at, preview: "Last line",
});

describe("contact conversations", () => {
  it("groups only this contact's topics by time, project and status, with pinned conversations first", () => {
    const now = Date.UTC(2026, 9, 5, 12);
    const rows = [item("older", "Older", now - 3 * 86400000, { status: "done", projectId: "p" }), item("today", "Today", now, { pinnedAt: 1 })];
    expect(groupContactTopics(rows, "flat", "", now)[0]?.items.map((x) => x.topic.key)).toEqual(["today", "older"]);
    expect(groupContactTopics(rows, "time", "", now).map((x) => x.label)).toEqual(["Today", "This week"]);
    expect(groupContactTopics(rows, "project", "", now).map((x) => x.label)).toEqual(["No project", "Other project"]);
    expect(groupContactTopics(rows, "status", "", now).map((x) => x.label)).toEqual(["Active", "Done"]);
  });

  it("searches title and last line without changing the contact's topic keys", () => {
    const rows = [item("agent:oak:one", "Garden", 1), { ...item("agent:oak:two", "Taxes", 2), preview: "Invoice due" }];
    expect(groupContactTopics(rows, "status", "invoice")[0]?.items.map((x) => x.topic.key)).toEqual(["agent:oak:two"]);
  });
});
