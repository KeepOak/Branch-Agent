import { describe, expect, it } from "vitest";
import {
  consumeMcpCodeModeGuestResult,
  projectMcpCallToolResult,
  projectMcpReadResourceResult,
} from "./mcp-content.js";

function nestedStructuredContent(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }
  return value;
}

describe("projectMcpReadResourceResult", () => {
  it("rejects malformed runtime resources at the SDK result boundary", () => {
    expect(() =>
      projectMcpReadResourceResult(
        { contents: [{ uri: "file://chart", blob: 42, mimeType: "image/png" }] },
        {},
      ),
    ).toThrow();
  });

  it("projects all read resources and preserves the protocol result for Code Mode", () => {
    const wireResult = {
      contents: [
        { uri: "file://notes", text: "Read these notes" },
        { uri: "file://chart", blob: "iVBORw0KGgo=", mimeType: "image/png" },
      ],
      _meta: { private: true },
    };
    const result = projectMcpReadResourceResult(wireResult, {
      serverName: "documents",
      operation: "resources_read",
    });

    expect(result.content).toEqual([
      { type: "text", text: "Read these notes" },
      { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
    ]);
    expect(result.details).toEqual({ serverName: "documents", operation: "resources_read" });
    expect(consumeMcpCodeModeGuestResult(result)).toEqual({ contents: wireResult.contents });
  });
});

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

  it.each([
    { label: "ordinary", deep: false, isError: undefined },
    { label: "server error", deep: false, isError: true },
    { label: "unprojectable", deep: true, isError: false },
  ])("projects $label structured content for model and guest callers", ({ deep, isError }) => {
    const result = projectMcpCallToolResult({
      content: deep ? [{ type: "text", text: "recovery guidance" }] : [],
      structuredContent: deep ? nestedStructuredContent(100_000) : { answer: 42 },
      isError,
    });
    if (deep) {
      const content = [
        {
          type: "text",
          text: "structuredContent was too deeply nested to project. Ask the MCP server for a flatter result or query a specific field.",
        },
        { type: "text", text: "recovery guidance" },
      ];
      expect(result.content).toEqual(content);
      expect(result.details).toEqual({ status: "error" });
      // Recursive downstream digests must not receive the unprojectable value.
      expect(result.details).not.toHaveProperty("structuredContent");
      expect(consumeMcpCodeModeGuestResult(result)).toEqual({ content, isError: true });
    } else {
      expect(result.content).toEqual([
        { type: "text", text: 'structuredContent:\n{\n  "answer": 42\n}' },
      ]);
      expect(result.details).toEqual({
        structuredContent: { answer: 42 },
        ...(isError ? { status: "error" } : {}),
      });
    }
  });
});
