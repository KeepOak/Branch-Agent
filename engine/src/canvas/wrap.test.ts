// From openclaw/openclaw@8177060846209e40a506e442785a7736f31db674:src/canvas/wrap.test.ts (atlas UI-MOBILE-WEB-0110). Changed for Branch: exact document length and SHA-256 after the repository rename map (DECISIONS.md item 127).
// Widget document wrapper: byte stability and the host-bridge contract it emits.
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { buildWidgetDocument } from "./wrap.js";

describe("buildWidgetDocument", () => {
  it("reports bounded runtime errors before widget code, deduplicating and limiting reports", () => {
    const html = buildWidgetDocument("Failure", '<script>throw new Error("Broken")</script>');
    const bridge = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find((match) =>
      match[1]?.includes("branch:widget-runtime-error"),
    );
    if (!bridge?.[1]) {
      throw new Error("Runtime error bridge missing");
    }
    expect(bridge.index).toBeLessThan(html.indexOf('throw new Error("Broken")'));
    const handlers = new Map<string, (event: unknown) => void>();
    const postMessage = vi.fn();
    runInNewContext(bridge[1], {
      window: {
        parent: { postMessage },
        addEventListener: (type: string, handler: (event: unknown) => void, capture: boolean) => {
          expect(capture).toBe(true);
          handlers.set(type, handler);
        },
      },
    });
    const error = handlers.get("error")!;
    const rejection = handlers.get("unhandledrejection")!;
    error({ type: "error" }); // Resource-load Events have no script message or error.
    expect(() =>
      rejection({
        reason: {
          get message() {
            throw new Error("getter");
          },
        },
      }),
    ).not.toThrow();
    error({
      error: { message: "x".repeat(600) },
      message: "fallback",
      filename: `https://example.test/path/${"s".repeat(220)}.js?private=1`,
      lineno: 12,
      colno: 7,
    });
    error({ message: "x".repeat(600) });
    rejection({ reason: new Error("Rejected"), lineno: Infinity, colno: 1.5 });
    rejection({ reason: "Plain rejection" });
    error({ message: "Over budget" });
    expect(postMessage.mock.calls).toEqual([
      [
        {
          type: "branch:widget-runtime-error",
          message: "x".repeat(500),
          source: "s".repeat(200),
          line: 12,
          column: 7,
        },
        "*",
      ],
      [{ type: "branch:widget-runtime-error", message: "Rejected" }, "*"],
      [{ type: "branch:widget-runtime-error", message: "Plain rejection" }, "*"],
    ]);
  });
  it("keeps the wrapped document bytes stable", () => {
    const html = buildWidgetDocument(
      "Status <live>",
      '<SvG viewBox="0 0 10 10"><circle r="4" /></SvG>',
    );

    expect(Buffer.byteLength(html)).toBe(17454);
    expect(createHash("sha256").update(html).digest("hex")).toBe(
      "701e5adfdb2a6f563e3c36ef9bf13165fbb9c9c57af01bea7febdebacfa0a401",
    );
  });
});
