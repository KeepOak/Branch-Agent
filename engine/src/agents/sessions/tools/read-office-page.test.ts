import { describe, expect, it } from "vitest";
import { collectOfficeReadPageText, createOfficeReadTextPage } from "./read-office-page.js";
import { createReadToolDefinition } from "./read.js";

describe("bounded Office stream paging", () => {
  it("counts discarded sparse wide rows without retaining their text", () => {
    let consumed = 0;
    function* chunks() {
      yield "--- Sheet: Wide ---\n";
      for (let row = 0; row < 128; row += 1) {
        consumed += 1;
        yield `${"\t".repeat(16_383)}row-${row}\n`;
      }
    }
    const options = { chunks: chunks(), cursor: 0, maxBytes: 256, fileBytes: 1000 };
    const collected = collectOfficeReadPageText(options);
    expect(consumed).toBe(128);
    expect(collected.line).toBe(129);
    expect(collected.selectedBytes).toBeGreaterThan(2_000_000);
    expect(collected.retainedChars).toBeLessThanOrEqual(258);
    expect(collected.retained.length).toBe(collected.retainedChars);
    const page = createOfficeReadTextPage({ ...options, chunks: chunks() });
    expect(page.details).toMatchObject({ kind: "truncated", truncation: { totalLines: 129 } });
    expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(256);
  });

  it.each([
    { content: "first\nsecond\n", limit: 1 },
    { content: "first\nsecond\n", offset: 2, limit: 1 },
    { content: "one\n\ntwo\n", offset: 2, limit: 1 },
    { content: "🌿first\n二second\n", limit: 1 },
    { content: "first\r\nsecond\r\n", limit: 1 },
    { content: "", offset: 1 },
    { content: "one\ntwo\n", offset: 3 },
    { content: "x".repeat(1500) + "\nsecond\n", maxBytes: 256 },
    { content: "🌿".repeat(800) + "\nsecond\n", cursor: 2, maxBytes: 256 },
    { content: "one\ntwo\nthree\n", limit: 2, cursor: 1 },
  ])("matches the existing reader page contract case %#", async (example) => {
    const maxBytes = "maxBytes" in example ? example.maxBytes : 1024;
    const bytes = Buffer.from(example.content);
    const tool = createReadToolDefinition("/fixture", {
      maxBytes,
      operations: { access: async () => {}, readFile: async () => bytes },
    });
    const args = { path: "plain.txt", ...example };
    const plain = await tool.execute("plain", args, undefined, undefined, {} as never);
    const page = createOfficeReadTextPage({
      chunks: [example.content],
      fileBytes: bytes.length,
      maxBytes,
      offset: "offset" in example ? example.offset : undefined,
      limit: "limit" in example ? example.limit : undefined,
      cursor: "cursor" in example ? example.cursor : 0,
      adaptive: true,
    });
    expect(page.text).toBe(plain.content[0]?.type === "text" ? plain.content[0].text : "");
    expect(page.details).toEqual(plain.details);
  });

  it("preserves cursor rejection and cancellation before draining more chunks", () => {
    expect(() =>
      createOfficeReadTextPage({ chunks: ["🌿text\n"], cursor: 1, maxBytes: 256, fileBytes: 10 }),
    ).toThrow("splits a UTF-16 surrogate pair");
    const signal = AbortSignal.abort();
    expect(() =>
      createOfficeReadTextPage({
        chunks: ["text\n"],
        cursor: 0,
        maxBytes: 256,
        fileBytes: 10,
        signal,
      }),
    ).toThrow();
  });
});
