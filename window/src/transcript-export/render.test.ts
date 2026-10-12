// From OpenHands/OpenHands@a8c05584ec6bb063a0857460b9cbff48e136919f:src/utils/transcript-export/index.test.ts (atlas SESSIONS-0047). Ported message/tool/export cases to Branch blocks.
import { describe, expect, it } from "vitest";
import { eventsToHtml, eventsToMarkdown } from "./render";
import type { Block } from "../thread/model";

const timestamp = Date.parse("2026-07-10T12:34:56.000Z");
const blocks: Block[] = [
  { kind: "user", key: "u", text: "Please diagnose **the failure**.", meta: { timestamp } },
  { kind: "step", key: "s", tool: "terminal", title: "Run the unit tests", status: "ok", detail: "3 tests passed", output: "3 tests passed" },
  { kind: "text", key: "a", text: "Fixed it.", streaming: false, meta: { timestamp } },
];
const options = { title: "Debug session", model: "local/model", includeToolDetails: true, includeTimestamps: true };

describe("conversation transcript rendering", () => {
  it("exports messages and collapsed tool details as Markdown", () => {
    const markdown = eventsToMarkdown(blocks, options);
    for (const text of ["# Debug session", "**Model:** local/model", "## User", "**the failure**", "<details>", "Run the unit tests", "3 tests passed", "## Assistant"]) expect(markdown).toContain(text);
    expect(markdown.match(/3 tests passed/g)).toHaveLength(1);
  });
  it("honors tool-detail and timestamp options in both formats", () => {
    for (const render of [eventsToMarkdown, eventsToHtml]) {
      const output = render(blocks, { ...options, includeToolDetails: false, includeTimestamps: false });
      expect(output).toContain("Run the unit tests");
      expect(output).not.toContain("3 tests passed");
      expect(output).not.toContain("<details>");
      expect(output).not.toContain(new Date(timestamp).toISOString());
    }
  });
  it("keeps untrusted content inert in HTML and Markdown", () => {
    const messages: Block[] = [{ kind: "user", key: "u", text: '<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(2)>', meta: { timestamp } }];
    const html = eventsToHtml(messages, { ...options, title: "<script>title</script>" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Content-Security-Policy");
    const markdown = eventsToMarkdown(messages, options);
    expect(markdown).toContain("\\[x\\](javascript:");
    expect(markdown).not.toContain("<script>");
  });
  it("uses a fence longer than any tool-output backticks", () => {
    const tool: Block = { ...blocks[1] as Extract<Block, { kind: "step" }>, detail: "before\n````\n<script>x</script>", output: undefined };
    expect(eventsToMarkdown([tool], options)).toContain("`````text");
  });
  it("exports errors and notes, and never invents unknown timestamps", () => {
    const output = eventsToMarkdown([{ kind: "error", key: "e", message: "Failed\n<script>x</script>" }, { kind: "notice", key: "n", text: "Restarted" }], options);
    expect(output).toContain("## Error");
    expect(output).toContain("> Failed");
    expect(output).toContain("Restarted");
    expect(output).not.toContain("<sub>");
  });
  it("exports readable attachment labels without embedded data or remote fetches", () => {
    const message: Block = { kind: "user", key: "u", text: "See file", attachments: [{ kind: "image", name: "photo.png", kept: true, src: "data:image/png;base64,privatebytes" }] };
    const html = eventsToHtml([message], options);
    expect(html).toContain("[image: photo.png]");
    expect(html).not.toContain("privatebytes");
  });
  it("exports separate and inline reasoning through the display projection", () => {
    const messages: Block[] = [{ kind: "thinking", key: "t", text: "Separate reasoning", live: false }, { kind: "text", key: "a", text: "<think>Inline reasoning</think>Visible answer", streaming: false }];
    const markdown = eventsToMarkdown(messages, options);
    for (const words of ["Separate reasoning", "Inline reasoning", "Visible answer"]) expect(markdown).toContain(words);
    expect(markdown).not.toContain("&lt;think&gt;");
  });
  it("preserves finalized literal think tags and strips only leading reasoning", () => {
    const markdown = eventsToMarkdown([{ kind: "text", key: "a", text: "Use <think> tags in the documentation.", streaming: false }], options);
    expect(markdown).toContain("Use &lt;think&gt; tags");
    const literal = eventsToMarkdown([{ kind: "text", key: "a", text: "<think>", streaming: false }], options);
    expect(literal).toContain("&lt;think&gt;");
  });
});
