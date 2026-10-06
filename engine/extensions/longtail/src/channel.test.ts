import { afterEach, describe, expect, it, vi } from "vitest";
import { longtailPlugin } from "./channel.js";

afterEach(() => vi.unstubAllGlobals());

describe("long-tail channel integration", () => {
  it("lists named accounts and reports missing provider credentials", () => {
    const cfg = {
      channels: {
        longtail: {
          accounts: {
            alerts: { provider: "ntfy", defaultTo: "branch-alerts" },
            team: { provider: "rocket-chat", baseUrl: "https://chat.example.test", token: "secret" },
          },
        },
      },
    };
    expect(longtailPlugin.config.listAccountIds(cfg)).toEqual(["alerts", "team"]);
    expect(longtailPlugin.config.isConfigured?.(longtailPlugin.config.resolveAccount(cfg, "alerts"), cfg)).toBe(true);
    expect(longtailPlugin.config.isConfigured?.(longtailPlugin.config.resolveAccount(cfg, "team"), cfg)).toBe(false);
  });

  it("delivers from a named account through the channel outbound adapter", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: "notification-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const sendText = longtailPlugin.outbound?.sendText;
    expect(sendText).toBeTypeOf("function");
    const result = await sendText!({
      cfg: { channels: { longtail: { accounts: { alerts: { provider: "ntfy", defaultTo: "branch-alerts" } } } } },
      accountId: "alerts",
      to: "",
      text: "integration message",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://ntfy.sh/branch-alerts");
    expect(result).toMatchObject({ channel: "longtail", messageId: "notification-1" });
  });
});
