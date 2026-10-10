import { describe, expect, it } from "vitest";
import type { Conversation } from "../connect/conversations";
import { countOf, cutAround, markParts, matchConversations, readFileHits, readMessageHits, plainSnippet } from "./search-model";

const conv = (key: string, title: string, archived = false) => ({ key, title, archived, preview: "", agentId: "dev" }) as Conversation;

describe("search model", () => {
  it("matches names case-insensitively and splits archived ones into Past", () => {
    const r = matchConversations([conv("a", "Garden plan"), conv("b", "Old garden", true), conv("c", "Taxes")], "GARDEN", () => "Sapling");
    expect(r.chats.map((c) => c.key)).toEqual(["a"]);
    expect(r.past.map((c) => c.key)).toEqual(["b"]);
    expect(matchConversations([conv("a", "x")], "sap", () => "Sapling").chats).toHaveLength(1);
  });
  it("reads sessions.search and memory.search", () => {
    const m = readMessageHits({ results: [{ sessionKey: "k", role: "user", snippet: "a\nb", timestamp: 5, messageId: "m" }] });
    expect(m).toEqual([{ key: "k", role: "user", snippet: "a b", at: 5, messageId: "m" }]);
    expect(readMessageHits({ results: Array.from({ length: 40 }, () => ({})) })).toHaveLength(25);
    expect(readFileHits({ results: [{ path: "memory/x.md", snippet: "hi" }] })).toEqual([{ title: "memory/x.md", snippet: "hi" }]);
    expect(readFileHits(null)).toEqual([]);
  });
  it("cuts about 36 characters before the match and marks every match", () => {
    const text = `${"x".repeat(50)}needle and needle`;
    expect(cutAround(text, "needle").startsWith("…")).toBe(true);
    expect(cutAround("short needle", "needle")).toBe("short needle");
    expect(markParts("a Needle b needle", "needle").filter((p) => p.hit).map((p) => p.text)).toEqual(["Needle", "needle"]);
  });
  it("counts", () => {
    expect(countOf({ chats: [conv("a", "x")], messages: [], past: [], files: [] }, "all")).toBe(1);
  });
});

it("shows a message snippet as plain words, without markdown links or emphasis", () => {
  expect(plainSnippet("See [the report](https://example.test/r) and **the table** with `grep`.")).toBe("See the report and the table with grep.");
  expect(plainSnippet("plain   text")).toBe("plain text");
});

it("keeps literal underscores and asterisks that are part of words or spaced out", () => {
  expect(plainSnippet("set my_var_name first")).toBe("set my_var_name first");
  expect(plainSnippet("compute a * b * c")).toBe("compute a * b * c");
  expect(plainSnippet("run `my_var_name` now")).toBe("run my_var_name now");
  expect(plainSnippet("snake_case and __dunder__ names")).toBe("snake_case and dunder names");
  expect(plainSnippet("an *emphasised* word and _this_ one")).toBe("an emphasised word and this one");
});
