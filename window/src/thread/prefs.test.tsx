import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ThreadContext } from "./context";
import { highlight } from "./highlight";
import { Markdown, parseMarkdown } from "./markdown";
import { DEFAULT_PREFS, readPrefs } from "./prefs";
import { vimKey } from "../composer/vim";

describe("conversation choices", () => {
  it("reads users.prefs and the look, with each default for anything missing or unknown", () => {
    expect(readPrefs({}, {})).toEqual(DEFAULT_PREFS);
    const p = readPrefs({ "conversation.sendWith": "ctrl", "conversation.taskProgress": false, "conversation.messageTimes": "always", "conversation.vimKeys": true }, { msgLook: "full", dir: "rtl", math: false, codeCol: "monokai", scroll: "bogus" });
    expect(p).toMatchObject({ sendWith: "ctrl", taskProgress: false, messageTimes: "always", vimKeys: true, msgLook: "full", dir: "rtl", math: false, codeCol: "monokai", scroll: "scrolling" });
  });
});

describe("vim keys", () => {
  const s = (text: string, caret: number) => ({ text, caret, mode: "normal" as const, pending: "" });
  it("moves, edits and goes back to insert", () => {
    expect(vimKey(s("hello world", 0), "w").caret).toBe(6);
    expect(vimKey(s("hello world", 6), "b").caret).toBe(0);
    expect(vimKey(s("hello world", 3), "$").caret).toBe(11);
    expect(vimKey(s("hello", 0), "x").text).toBe("ello");
    expect(vimKey(s("one\ntwo", 1), "j").caret).toBe(5);
    const dd = vimKey({ ...s("one\ntwo", 5), pending: "d" }, "d");
    expect(dd.text).toBe("one");
    expect(vimKey(s("one", 1), "A")).toMatchObject({ mode: "insert", caret: 3 });
    expect(vimKey(s("one", 1), "o")).toMatchObject({ mode: "insert", text: "one\n", caret: 4 });
    expect(vimKey(s("one", 1), "q").handled).toBe(true);
  });
});

describe("maths and code colours", () => {
  it("finds maths blocks and inline maths only when maths are on", async () => {
    expect(parseMarkdown("$$\nE = mc^2\n$$")).toEqual([{ type: "math", tex: "E = mc^2", raw: "$$\nE = mc^2\n$$" }]);
    const host = document.createElement("div");
    const root = createRoot(host);
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => root.render(<ThreadContext.Provider value={{ name: "", toast: () => undefined, running: false, prefs: { ...DEFAULT_PREFS, math: false } }}><Markdown text="It costs $5 and $x^2$ grows." /></ThreadContext.Provider>));
    expect(host.querySelector(".md-tex, .md-math-i")).toBeNull();
    await act(async () => root.render(<ThreadContext.Provider value={{ name: "", toast: () => undefined, running: false, prefs: DEFAULT_PREFS }}><Markdown text="It costs $5 and $x^2$ grows." /></ThreadContext.Provider>));
    expect(host.querySelectorAll(".md-tex, .md-math-i").length).toBe(1);
    await act(async () => root.unmount());
  });

  it("highlights known languages and leaves others plain", () => {
    expect(highlight("const a = 1;", "ts")).toContain("hljs-keyword");
    expect(highlight("<b>x</b>", "nope")).toBeNull();
    expect(highlight("<script>", "html")).not.toContain("<script>");
  });
});
