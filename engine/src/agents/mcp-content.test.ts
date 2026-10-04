import { describe, expect, it } from "vitest";
import { consumeMcpCodeModeGuestResult, projectMcpCallToolResult } from "./mcp-content.js";

function nestedStructuredContent(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }
  return value;
}

describe("projectMcpCallToolResult", () => {
  it("passes embedded image resources to vision and preserves the guest resource", () => {
    const resource = { uri: "asset://chart", mimeType: "image/png", blob: "iVBORw0KGgo=" };
    const result = projectMcpCallToolResult({ content: [{ type: "resource", resource }] });

    expect(result.content).toEqual([{ type: "image", data: resource.blob, mimeType: "image/png" }]);
    expect(consumeMcpCodeModeGuestResult(result)).toEqual({
      content: [{ type: "resource", resource }],
    });
  });

  it("identifies non-image blobs without putting binary bytes into model text", () => {
    const result = projectMcpCallToolResult({
      content: [
        {
          type: "resource",
          resource: {
            uri: "asset://document",
            mimeType: "application/pdf",
            blob: "JVBERi0=",
          },
        },
      ],
    });

    expect(result.content).toEqual([
      { type: "text", text: "[Binary Data (application/pdf)] asset://document" },
    ]);
  });

  it("retains empty text resources and falls back to URI for untyped blobs", () => {
    const result = projectMcpCallToolResult({
      content: [
        {
          type: "resource",
          resource: { uri: "asset://empty", text: "", mimeType: "image/png", blob: "ignored" },
        },
        { type: "resource", resource: { uri: "asset://unknown", blob: "opaque" } },
      ],
    });

    expect(result.content).toEqual([
      { type: "text", text: "" },
      { type: "text", text: "asset://unknown" },
    ]);
  });

  it("mirrors an ordinary structuredContent for the model", () => {
    const result = projectMcpCallToolResult({
      content: [],
      structuredContent: { answer: 42 },
    });

    expect(result.content).toEqual([
      { type: "text", text: 'structuredContent:\n{\n  "answer": 42\n}' },
    ]);
    expect(result.details).toMatchObject({ structuredContent: { answer: 42 } });
    expect((result.details as { status?: string }).status).toBeUndefined();
  });

  it("degrades a deeply nested structuredContent to a handled failure", () => {
    // Serializing this value recurses per level; the depth is far past every
    // engine's stack limit, which is what makes the remote MCP payload fatal.
    const structuredContent = nestedStructuredContent(100_000);

    const result = projectMcpCallToolResult({ content: [], structuredContent });

    expect(result.content).toEqual([
      {
        type: "text",
        text: "structuredContent was too deeply nested to project. Ask the MCP server for a flatter result or query a specific field.",
      },
    ]);
    expect(result.details).toMatchObject({ status: "error" });
    // Retained details feed recursive digests downstream (loop detection), so the
    // unprojectable value must not survive into them.
    expect(result.details).not.toHaveProperty("structuredContent");
  });

  it("keeps server content blocks beside the unprojectable notice", () => {
    const result = projectMcpCallToolResult({
      content: [{ type: "text", text: "recovery guidance" }],
      structuredContent: nestedStructuredContent(100_000),
    });

    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("too deeply nested") },
      { type: "text", text: "recovery guidance" },
    ]);
  });

  it("keeps reporting a server-declared error for shallow content", () => {
    const result = projectMcpCallToolResult({
      content: [],
      structuredContent: { answer: 42 },
      isError: true,
    });

    expect(result.details).toMatchObject({ status: "error" });
    expect(result.details).toHaveProperty("structuredContent");
  });

  it("reports the unprojectable failure to Code Mode guest callers", () => {
    const result = projectMcpCallToolResult({
      content: [],
      structuredContent: nestedStructuredContent(100_000),
      isError: false,
    });

    // Guest code reads this snapshot instead of the model-facing result; an
    // apparent success with empty content would hide the projection failure.
    expect(consumeMcpCodeModeGuestResult(result)).toEqual({
      content: [{ type: "text", text: expect.stringContaining("too deeply nested") }],
      isError: true,
    });
  });
});
