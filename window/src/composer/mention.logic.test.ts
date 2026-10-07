import { describe, expect, it } from "vitest";
import { MENTION_PEOPLE_MAX, matches, replaceToken, skillTokenAt, tokenAt } from "./mention";

describe("tokenAt", () => {
  it("finds @sc at the start of the box and after a space, not inside an email address", () => {
    expect(tokenAt("@sc", 3, "@")).toEqual({ start: 0, end: 3, query: "sc" });
    expect(tokenAt("hi @sc", 6, "@")).toEqual({ start: 3, end: 6, query: "sc" });
    expect(tokenAt("mail@x", 6, "@")).toBeNull();
    expect(tokenAt("user@example.com", 16, "@")).toBeNull();
  });

  it("lowercases the letters after @ so the list can filter them (preview POPS.mention)", () => {
    expect(tokenAt("@Sarah", 6, "@")).toEqual({ start: 0, end: 6, query: "sarah" });
    expect(tokenAt("hi @TEAM", 8, "@")).toEqual({ start: 3, end: 8, query: "team" });
  });

  it("returns null when the @ word has a space or the caret is past it", () => {
    expect(tokenAt("@sa ra", 6, "@")).toBeNull();
    expect(tokenAt("hello", 5, "@")).toBeNull();
    expect(tokenAt("@sarah", 4, "@")).toEqual({ start: 0, end: 4, query: "sar" });
  });

  it("treats a bare @ at the caret as an empty query", () => {
    expect(tokenAt("@", 1, "@")).toEqual({ start: 0, end: 1, query: "" });
    expect(tokenAt("hi @", 4, "@")).toEqual({ start: 3, end: 4, query: "" });
  });
});

describe("skillTokenAt", () => {
  it("finds a mid-message / but not a command at the start", () => {
    expect(skillTokenAt("do /su", 6)).toEqual({ start: 3, end: 6, query: "su" });
    expect(skillTokenAt("try /search", 11)).toEqual({ start: 4, end: 11, query: "search" });
    expect(skillTokenAt("/think", 6)).toBeNull();
    expect(skillTokenAt("/help", 5)).toBeNull();
  });

  it("does not treat a path slash as a skill", () => {
    expect(skillTokenAt("file/path", 9)).toBeNull();
    expect(skillTokenAt("hello", 5)).toBeNull();
  });
});

describe("replaceToken", () => {
  it("inserts the name with exactly one space after it and returns the right caret", () => {
    expect(replaceToken("hi @sa there", { start: 3, end: 6, query: "sa" }, "@Sapling")).toEqual({
      text: "hi @Sapling there",
      caret: 12,
    });
    expect(replaceToken("@sc test", { start: 0, end: 3, query: "sc" }, "@Scout")).toEqual({
      text: "@Scout test",
      caret: 7,
    });
    expect(replaceToken("hi @sa", { start: 3, end: 6, query: "sa" }, "@Sapling")).toEqual({
      text: "hi @Sapling ",
      caret: 12,
    });
    expect(replaceToken("do /su", { start: 3, end: 6, query: "su" }, "/summarize")).toEqual({
      text: "do /summarize ",
      caret: 14,
    });
  });
});

describe("matches", () => {
  it("is case-insensitive and matches a first or later word, like the preview People filter", () => {
    expect(matches("Sarah", "sa")).toBe(true);
    expect(matches("SARAH", "sarah")).toBe(true);
    expect(matches("Jane Smith", "sm")).toBe(true);
    expect(matches("Alice Bob Carol", "bob")).toBe(true);
    expect(matches("Oak", "bir")).toBe(false);
    expect(matches("Sarah", "rah")).toBe(false);
  });

  it("uses the lowercased query tokenAt already returns", () => {
    const token = tokenAt("@SA", 3, "@");
    expect(token?.query).toBe("sa");
    expect(matches("Sarah", token!.query)).toBe(true);
    expect(matches("Sarah", "SA")).toBe(false);
  });
});

describe("MENTION_PEOPLE_MAX", () => {
  it("is 10, the preview's 'You can mention up to 10 people in one message.'", () => {
    expect(MENTION_PEOPLE_MAX).toBe(10);
  });
});
