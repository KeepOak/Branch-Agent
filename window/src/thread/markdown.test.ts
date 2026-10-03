import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("splits headings, lists, task lists, quotes, code and tables", () => {
    const text = [
      "# Title",
      "",
      "Some *text*",
      "more",
      "",
      "- a",
      "- [x] done",
      "",
      "> said",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    const blocks = parseMarkdown(text);
    expect(blocks.map((b) => b.type)).toEqual(["h", "p", "list", "quote", "code", "table"]);
    expect(blocks[1]).toEqual({ type: "p", text: "Some *text*\nmore" });
    expect(blocks[2]).toMatchObject({ items: [{ text: "a" }, { text: "done", task: true, done: true }] });
    expect(blocks[4]).toEqual({ type: "code", lang: "ts", text: "const a = 1;" });
    expect(blocks[5]).toEqual({ type: "table", head: ["a", "b"], rows: [["1", "2"]] });
  });

  it("keeps raw HTML as text (it is never parsed into markup)", () => {
    expect(parseMarkdown("<script>alert(1)</script>")).toEqual([{ type: "p", text: "<script>alert(1)</script>" }]);
  });
});
