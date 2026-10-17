import { describe, expect, it } from "vitest";
import { vimKey, type VimState } from "./vim";

/** Settings › General › "Vim keys in the message box" (preview: `sw15('Vim keys in the message box', …)`).
 *  Motions and edits come from this module's doc comments; Escape→normal is Composer.tsx, not vimKey. */
describe("vim keys in the message box", () => {
  const s = (text: string, caret: number, extra: Partial<VimState> = {}): VimState => ({
    text,
    caret,
    mode: "normal",
    pending: "",
    ...extra,
  });

  describe("i a A I o O return to insert with the caret where Vim puts it", () => {
    it("i stays at the caret", () => {
      expect(vimKey(s("hello", 2), "i")).toMatchObject({ mode: "insert", caret: 2, text: "hello", handled: true });
    });

    it("a moves one character right, but not past the end of the line", () => {
      expect(vimKey(s("hello", 2), "a")).toMatchObject({ mode: "insert", caret: 3 });
      expect(vimKey(s("hello", 5), "a")).toMatchObject({ mode: "insert", caret: 5 });
      expect(vimKey(s("hello\nworld", 5), "a")).toMatchObject({ mode: "insert", caret: 5, text: "hello\nworld" });
    });

    it("A goes to the end of the current line", () => {
      expect(vimKey(s("hello world", 2), "A")).toMatchObject({ mode: "insert", caret: 11 });
      expect(vimKey(s("hello\nworld", 2), "A")).toMatchObject({ mode: "insert", caret: 5 });
    });

    it("I goes to the start of the current line", () => {
      expect(vimKey(s("hello", 3), "I")).toMatchObject({ mode: "insert", caret: 0 });
      expect(vimKey(s("first\nsecond", 8), "I")).toMatchObject({ mode: "insert", caret: 6 });
    });

    it("o opens a line below and puts the caret on it", () => {
      expect(vimKey(s("hello", 2), "o")).toMatchObject({ mode: "insert", text: "hello\n", caret: 6 });
      expect(vimKey(s("first\nsecond", 2), "o")).toMatchObject({ mode: "insert", text: "first\n\nsecond", caret: 6 });
      expect(vimKey(s("hello", 5), "o")).toMatchObject({ mode: "insert", text: "hello\n", caret: 6 });
    });

    it("O opens a line above and puts the caret on it", () => {
      expect(vimKey(s("hello", 2), "O")).toMatchObject({ mode: "insert", text: "\nhello", caret: 0 });
      expect(vimKey(s("first\nsecond", 8), "O")).toMatchObject({ mode: "insert", text: "first\n\nsecond", caret: 6 });
      expect(vimKey(s("hello", 0), "O")).toMatchObject({ mode: "insert", text: "\nhello", caret: 0 });
    });
  });

  describe("h l w b 0 $ stay on the line and do not move past the ends", () => {
    it("h and l move one character and stop at the line edges", () => {
      expect(vimKey(s("hello", 3), "h").caret).toBe(2);
      expect(vimKey(s("hello", 0), "h").caret).toBe(0);
      expect(vimKey(s("hello\nworld", 6), "h").caret).toBe(6);
      expect(vimKey(s("hello", 2), "l").caret).toBe(3);
      expect(vimKey(s("hello", 5), "l").caret).toBe(5);
      expect(vimKey(s("hello\nworld", 5), "l").caret).toBe(5);
    });

    it("0 and $ go to the start and end of the current line", () => {
      expect(vimKey(s("hello", 3), "0").caret).toBe(0);
      expect(vimKey(s("first\nsecond", 8), "0").caret).toBe(6);
      expect(vimKey(s("hello", 2), "$").caret).toBe(5);
      expect(vimKey(s("first\nsecond", 2), "$").caret).toBe(5);
    });

    it("w moves to the next word and stops at the end of the text", () => {
      expect(vimKey(s("hello world", 0), "w").caret).toBe(6);
      expect(vimKey(s("a   b", 0), "w").caret).toBe(4);
      expect(vimKey(s("hello", 5), "w").caret).toBe(5);
      expect(vimKey(s("hello\nworld", 3), "w").caret).toBe(6);
      expect(vimKey(s("hello, world", 0), "w").caret).toBe(5);
    });

    it("b moves to the previous word and stops at the start of the text", () => {
      expect(vimKey(s("hello world", 6), "b").caret).toBe(0);
      expect(vimKey(s("a   b", 4), "b").caret).toBe(0);
      expect(vimKey(s("hello", 0), "b").caret).toBe(0);
      expect(vimKey(s("hello\nworld", 6), "b").caret).toBe(0);
      expect(vimKey(s("hello, world", 7), "b").caret).toBe(5);
    });
  });

  describe("j k G keep the column when the next line is long enough", () => {
    it("j and k move a line and stay put on the first or last line", () => {
      expect(vimKey(s("first\nsecond", 2), "j").caret).toBe(8);
      expect(vimKey(s("hello", 2), "j").caret).toBe(2);
      expect(vimKey(s("hello\nworld", 3), "j").caret).toBe(9);
      expect(vimKey(s("hello\nhi", 4), "j").caret).toBe(8);
      expect(vimKey(s("first\nsecond", 8), "k").caret).toBe(2);
      expect(vimKey(s("hello", 2), "k").caret).toBe(2);
      expect(vimKey(s("hello\nworld", 9), "k").caret).toBe(3);
      expect(vimKey(s("hi\nhello", 8), "k").caret).toBe(2);
      expect(vimKey(s("a\n\nb", 2), "j").caret).toBe(3);
    });

    it("G goes to the end of the text", () => {
      expect(vimKey(s("hello\nworld", 2), "G").caret).toBe(11);
    });
  });

  describe("x dd dw D edit the text and return the new caret", () => {
    it("x deletes the character under the caret", () => {
      expect(vimKey(s("hello", 1), "x")).toMatchObject({ text: "hllo", caret: 1, mode: "normal" });
      expect(vimKey(s("hello", 2), "x")).toMatchObject({ text: "helo", caret: 2 });
      expect(vimKey(s("hello", 5), "x")).toMatchObject({ text: "hello", caret: 5 });
    });

    it("D deletes from the caret to the end of the line", () => {
      expect(vimKey(s("hello world", 6), "D")).toMatchObject({ text: "hello ", caret: 6 });
      expect(vimKey(s("first\nsecond", 2), "D")).toMatchObject({ text: "fi\nsecond", caret: 2 });
    });

    it("d then d deletes the current line and leaves the caret on the next (or previous) line", () => {
      const pending = vimKey(s("first\nsecond\nthird", 8), "d");
      expect(pending).toMatchObject({ pending: "d", handled: true, text: "first\nsecond\nthird", caret: 8 });
      expect(vimKey(pending, "d")).toMatchObject({ text: "first\nthird", caret: 6, pending: "", mode: "normal" });
      expect(vimKey(s("hello", 2, { pending: "d" }), "d")).toMatchObject({ text: "", caret: 0 });
      expect(vimKey(s("first\nsecond", 8, { pending: "d" }), "d")).toMatchObject({ text: "first", caret: 5 });
      expect(vimKey(s("first\nsecond", 2, { pending: "d" }), "d")).toMatchObject({ text: "second", caret: 0 });
      expect(vimKey(s("first\nsecond\n", 8, { pending: "d" }), "d")).toMatchObject({ text: "first", caret: 5 });
    });

    it("d then w deletes from the caret to the next word", () => {
      expect(vimKey(s("hello world", 0, { pending: "d" }), "w")).toMatchObject({ text: "world", caret: 0, pending: "" });
      expect(vimKey(s("hello world", 2, { pending: "d" }), "w")).toMatchObject({ text: "heworld", caret: 2 });
    });

    it("d followed by an unknown operator cancels and leaves the text alone", () => {
      expect(vimKey(s("hello", 2, { pending: "d" }), "x")).toMatchObject({ text: "hello", caret: 2, pending: "", handled: true });
    });
  });

  describe("unknown keys in normal mode", () => {
    it("swallows a single unknown character so it never types into the box", () => {
      expect(vimKey(s("hello", 2), "q")).toMatchObject({ handled: true, text: "hello", caret: 2, pending: "" });
      expect(vimKey(s("hello", 2), "z")).toMatchObject({ handled: true, text: "hello" });
      expect(vimKey(s("hello", 2), "5")).toMatchObject({ handled: true, text: "hello" });
    });

    it("does not handle named keys such as Escape (Composer.tsx leaves insert mode)", () => {
      expect(vimKey(s("hello", 2, { mode: "insert" }), "Escape")).toMatchObject({
        handled: false,
        mode: "insert",
        text: "hello",
        caret: 2,
      });
    });
  });

  describe("empty text and a caret past the ends", () => {
    it("clamps the caret and still enters insert", () => {
      expect(vimKey(s("", 0), "i")).toMatchObject({ mode: "insert", caret: 0, text: "" });
      expect(vimKey(s("hi", 10), "i").caret).toBe(2);
      expect(vimKey(s("hello", -5), "i").caret).toBe(0);
    });
  });
});
