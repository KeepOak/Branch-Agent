// Written by Branch for AUTOMATION-0074 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/hooks/bundled/compaction-notifier/handler.ts and HOOK.md.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInternalHookEvent } from "../../internal-hooks.js";
import handler from "./handler.js";

describe("compaction notice hook", () => {
  afterEach(() => vi.restoreAllMocks());

  it("announces compaction start with the message count and preserves earlier messages", async () => {
    const event = createInternalHookEvent("session", "compact:before", "agent:main:main", {
      messageCount: 12,
    });
    event.messages.push("Earlier notice");
    await handler(event);
    expect(event.messages).toEqual([
      "Earlier notice",
      "🧹 Compacting context (12 messages) so I can continue without losing history…",
    ]);
  });

  it.each([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, "invalid", "0"])(
    "omits invalid message count %s from the start notice",
    async (messageCount) => {
      const event = createInternalHookEvent("session", "compact:before", "agent:main:main", {
        messageCount,
      });
      await handler(event);
      expect(event.messages).toEqual([
        "🧹 Compacting context so I can continue without losing history…",
      ]);
    },
  );

  it.each([0])("includes a valid zero message count %s", async (messageCount) => {
    const event = createInternalHookEvent("session", "compact:before", "agent:main:main", {
      messageCount,
    });
    await handler(event);
    expect(event.messages).toEqual([
      "🧹 Compacting context (0 messages) so I can continue without losing history…",
    ]);
  });

  it("announces completion with the localized before and after token counts", async () => {
    const event = createInternalHookEvent("session", "compact:after", "agent:main:main", {
      tokensBefore: 12000,
      tokensAfter: 3000,
    });
    await handler(event);
    expect(event.messages).toEqual([
      `✅ Context compacted (${(12000).toLocaleString()} → ${(3000).toLocaleString()} tokens). Continuing from where I left off.`,
    ]);
  });

  it.each([
    {},
    { tokensBefore: 12000 },
    { tokensAfter: 3000 },
    { tokensBefore: Number.NaN, tokensAfter: 3000 },
    { tokensBefore: 12000, tokensAfter: Number.POSITIVE_INFINITY },
  ])("omits incomplete or invalid token counts: %j", async (context) => {
    const event = createInternalHookEvent("session", "compact:after", "agent:main:main", context);
    await handler(event);
    expect(event.messages).toEqual(["✅ Context compacted. Continuing from where I left off."]);
  });

  it.each([
    ["command", "compact:before"],
    ["session", "start"],
  ] as const)("ignores unrelated %s:%s events", async (type, action) => {
    const event = createInternalHookEvent(type, action, "agent:main:main", {});
    await handler(event);
    expect(event.messages).toEqual([]);
  });

  it("reports unexpected context errors without interrupting the session", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = {
      get messageCount(): number {
        throw new Error("broken context");
      },
    };
    const event = createInternalHookEvent("session", "compact:before", "agent:main:main", context);
    await expect(handler(event)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[compaction-notifier] failed: broken context");
    expect(event.messages).toEqual([]);
  });
});
