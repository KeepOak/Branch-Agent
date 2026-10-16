import { describe, expect, it } from "vitest";
import { countTextLines, createFileReadLedger } from "./file-read-ledger.js";

const FILE = "/workspace/project/main.ts";

describe("countTextLines", () => {
  it("does not count a trailing newline as a new line", () => {
    expect(countTextLines("")).toBe(0);
    expect(countTextLines("a")).toBe(1);
    expect(countTextLines("a\nb\n")).toBe(2);
    expect(countTextLines("a\nb")).toBe(2);
  });
});

describe("file read ledger", () => {
  it("treats a read that skips unread lines as not extending coverage", () => {
    const ledger = createFileReadLedger();
    ledger.recordRead({ absolutePath: FILE, startLine: 1, endLine: 2000, totalLines: 3412 });
    ledger.recordRead({ absolutePath: FILE, startLine: 3000, endLine: 3412, totalLines: 3412 });

    expect(() =>
      ledger.assertWholeFileWriteAllowed({ absolutePath: FILE, newBytes: 1, existingBytes: 1 }),
    ).toThrow("You only read part of this file");
  });

  it("allows a whole-file write once contiguous reads cover every line", () => {
    const ledger = createFileReadLedger();
    ledger.recordRead({ absolutePath: FILE, startLine: 1, endLine: 2000, totalLines: 3412 });
    ledger.recordRead({ absolutePath: FILE, startLine: 2001, endLine: 3412, totalLines: 3412 });

    expect(() =>
      ledger.assertWholeFileWriteAllowed({ absolutePath: FILE, newBytes: 1, existingBytes: 1 }),
    ).not.toThrow();
  });

  it("marks a path fully known after a successful write", () => {
    const ledger = createFileReadLedger();
    ledger.recordRead({ absolutePath: FILE, startLine: 1, endLine: 10, totalLines: 3412 });
    ledger.recordWrite({ absolutePath: FILE, content: "one\ntwo\n" });

    expect(() =>
      ledger.assertWholeFileWriteAllowed({ absolutePath: FILE, newBytes: 1, existingBytes: 900 }),
    ).not.toThrow();
  });
});
