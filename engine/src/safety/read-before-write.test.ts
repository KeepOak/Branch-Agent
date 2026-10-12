// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_read_before_write_middleware.py (atlas SAFETY-0170)
import { describe, expect, it } from "vitest";
import {
  ReadBeforeWriteGate,
  contentHash,
  countFileLines,
  formatReadBeforeWriteBlock,
} from "./read-before-write.js";

function missing(filePath: string): Error {
  return Object.assign(new Error("ENOENT: " + filePath), { code: "ENOENT" });
}

function memoryFiles(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const reader = async (filePath: string) => {
    const content = files.get(filePath);
    if (content === undefined) {
      throw missing(filePath);
    }
    return content;
  };
  return { files, gate: new ReadBeforeWriteGate(reader) };
}

const SCOPE = "session-1";

describe("read marks", () => {
  it("test_read_file_success_stamps_mark", async () => {
    const { gate } = memoryFiles({ "/w/a.md": "hello\n" });
    expect(await gate.recordRead(SCOPE, "/w/a.md", { isError: false })).toBe(true);
    expect(await gate.checkWrite(SCOPE, "/w/a.md", "write")).toBeNull();
  });

  it("test_error_tool_message_gets_no_mark", async () => {
    const { gate } = memoryFiles({ "/w/a.md": "hello\n" });
    expect(await gate.recordRead(SCOPE, "/w/a.md", { isError: true })).toBe(false);
    expect(await gate.checkWrite(SCOPE, "/w/a.md", "write")).not.toBeNull();
  });

  it("test_reader_failure_means_no_mark", async () => {
    const gate = new ReadBeforeWriteGate(async () => {
      throw new Error("sandbox hiccup");
    });
    expect(await gate.recordRead(SCOPE, "/w/a.md", { isError: false })).toBe(false);
  });

  it("test_no_mark_when_reread_returns_error_string", async () => {
    const { gate } = memoryFiles({ "/w/a.md": "Error: cannot read" });
    expect(await gate.recordRead(SCOPE, "/w/a.md", { isError: false })).toBe(false);
  });

  it("test_empty_file_read_still_stamps_mark", async () => {
    const { gate } = memoryFiles({ "/w/empty.md": "" });
    expect(await gate.recordRead(SCOPE, "/w/empty.md", { isError: false })).toBe(true);
    expect(await gate.checkWrite(SCOPE, "/w/empty.md", "write")).toBeNull();
  });
});

describe("write gate", () => {
  it("test_new_file_write_allowed", async () => {
    const { gate } = memoryFiles();
    expect(await gate.checkWrite(SCOPE, "/w/new.md", "write")).toBeNull();
  });

  it("test_overwrite_existing_without_read_blocked", async () => {
    const { gate } = memoryFiles({ "/w/a.md": "one\ntwo\n" });
    const blocked = await gate.checkWrite(SCOPE, "/w/a.md", "write");
    expect(blocked?.tool).toBe("write");
    expect(blocked?.path).toBe("/w/a.md");
    expect(blocked?.message).toContain("you have not read its current version");
  });

  it("test_str_replace_without_read_blocked", async () => {
    const { gate } = memoryFiles({ "/w/a.md": "x\n" });
    expect((await gate.checkWrite(SCOPE, "/w/a.md", "edit"))?.tool).toBe("edit");
  });

  it("test_str_replace_missing_file_passes_through", async () => {
    const { gate } = memoryFiles();
    expect(await gate.checkWrite(SCOPE, "/w/none.md", "edit")).toBeNull();
  });

  it("test_fresh_mark_allows_write", async () => {
    const { gate } = memoryFiles({ "/w/a.md": "v1" });
    await gate.recordRead(SCOPE, "/w/a.md", { isError: false });
    expect(await gate.checkWrite(SCOPE, "/w/a.md", "write")).toBeNull();
  });

  it("test_stale_mark_after_modification_blocked", async () => {
    const { files, gate } = memoryFiles({ "/w/a.md": "v1" });
    await gate.recordRead(SCOPE, "/w/a.md", { isError: false });
    files.set("/w/a.md", "v2");
    expect(await gate.checkWrite(SCOPE, "/w/a.md", "write")).not.toBeNull();
  });

  it("test_newest_mark_wins", async () => {
    const { files, gate } = memoryFiles({ "/w/a.md": "v1" });
    await gate.recordRead(SCOPE, "/w/a.md", { isError: false });
    files.set("/w/a.md", "v2");
    await gate.recordRead(SCOPE, "/w/a.md", { isError: false });
    expect(await gate.checkWrite(SCOPE, "/w/a.md", "write")).toBeNull();
  });

  it("test_mark_removed_by_summarization_blocks", async () => {
    const { gate } = memoryFiles({ "/w/a.md": "v1" });
    await gate.recordRead(SCOPE, "/w/a.md", { isError: false });
    gate.forgetReads(SCOPE, ["/w/a.md"]);
    expect(await gate.checkWrite(SCOPE, "/w/a.md", "write")).not.toBeNull();
  });

  it("test_gate_read_failure_fails_open", async () => {
    const gate = new ReadBeforeWriteGate(async () => {
      throw new Error("binary content");
    });
    expect(await gate.checkWrite(SCOPE, "/w/a.bin", "write")).toBeNull();
  });

  it("test_normalized_path_matching", async () => {
    const { gate } = memoryFiles({ "/w/a.md": "v1", "/w/./sub/../a.md": "v1" });
    await gate.recordRead(SCOPE, "/w/./sub/../a.md", { isError: false });
    expect(await gate.checkWrite(SCOPE, "/w/a.md", "write")).toBeNull();
  });

  it("marks are scoped per session (behaviour)", async () => {
    const { gate } = memoryFiles({ "/w/a.md": "v1" });
    await gate.recordRead(SCOPE, "/w/a.md", { isError: false });
    expect(await gate.checkWrite("other-session", "/w/a.md", "write")).not.toBeNull();
  });
});

describe("concurrency", () => {
  it("test_parallel_appends_exactly_one_lands", async () => {
    const { files, gate } = memoryFiles({ "/w/log.md": "start\n" });
    await gate.recordRead(SCOPE, "/w/log.md", { isError: false });
    const append = (line: string) =>
      gate.guardWrite(SCOPE, "/w/log.md", "write", async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 5);
        });
        files.set("/w/log.md", (files.get("/w/log.md") ?? "") + line);
        return line;
      });
    const results = await Promise.all([append("a\n"), append("b\n")]);
    expect(results.filter((result) => "result" in result)).toHaveLength(1);
    expect(results.filter((result) => "blocked" in result)).toHaveLength(1);
    expect(countFileLines(files.get("/w/log.md") ?? "")).toBe(2);
  });
});

describe("block message", () => {
  it.each([
    ["write", "", "0 lines"],
    ["write", "one", "1 line"],
    ["edit", "one\ntwo\n", "2 lines"],
  ])("test_block_message_line_desc %s %j", (tool, content, expected) => {
    expect(formatReadBeforeWriteBlock(tool, "/w/a.md", content)).toContain("(" + expected + ")");
  });

  it("hash covers the full file content (behaviour)", () => {
    expect(contentHash("a")).not.toBe(contentHash("a\n"));
  });
});
