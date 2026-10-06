import { describe, expect, it, vi } from "vitest";
import { sendLongtailText, type LongtailAccount, type LongtailProvider } from "./send.js";

function account(provider: LongtailProvider): LongtailAccount {
  return {
    accountId: "default",
    enabled: true,
    provider,
    baseUrl: "https://chat.example.test/",
    token: "secret",
    userId: "bot-id",
    email: "bot@example.test",
    defaultTo: "",
    title: "Branch",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("long-tail send-first delivery", () => {
  it("sends Rocket.Chat messages with user and token headers", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ success: true, message: { _id: "msg-1" } }));
    const messageId = await sendLongtailText({
      account: account("rocket-chat"), to: "room-1", text: "hello", fetcher,
    });
    expect(messageId).toBe("msg-1");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://chat.example.test/api/v1/chat.postMessage");
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ "X-Auth-Token": "secret", "X-User-Id": "bot-id" });
    expect(JSON.parse(String(init.body))).toEqual({ roomId: "room-1", text: "hello" });
  });

  it("sends Zulip stream and DM messages with Basic authentication", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ result: "success", id: 42 }));
    await sendLongtailText({ account: account("zulip"), to: "stream/general/updates", text: "news", fetcher });
    let init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ authorization: `Basic ${Buffer.from("bot@example.test:secret").toString("base64")}` });
    expect(new URLSearchParams(String(init.body)).get("topic")).toBe("updates");
    expect(new URLSearchParams(String(init.body)).get("type")).toBe("stream");
    const id = await sendLongtailText({ account: account("zulip"), to: "dm/123", text: "hi", fetcher });
    init = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(new URLSearchParams(String(init.body)).get("to")).toBe("[123]");
    expect(id).toBe("42");
  });

  it("sends Webex room messages as markdown", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ id: "webex-1" }));
    const id = await sendLongtailText({ account: account("webex"), to: "room/abc", text: "**hi**", fetcher });
    expect(id).toBe("webex-1");
    expect(JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ roomId: "abc", markdown: "**hi**" });
  });

  it("sends Gotify application messages and retains the server ID", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ id: 9 }));
    const id = await sendLongtailText({ account: account("gotify"), to: "default", text: "hi", fetcher });
    expect(id).toBe("9");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://chat.example.test/message");
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ "X-Gotify-Key": "secret" });
  });

  it("sends Pushover user notifications without fabricating a message ID", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ status: 1, request: "request-only" }));
    const id = await sendLongtailText({ account: account("pushover"), to: "user-key", text: "hi", fetcher });
    expect(id).toBe("");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.pushover.net/1/messages.json");
    const form = new URLSearchParams(String((fetcher.mock.calls[0]?.[1] as RequestInit).body));
    expect(form.get("user")).toBe("user-key");
  });

  it("publishes to an ntfy topic without a token when configured public", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ id: "ntfy-1" }));
    const publicAccount = { ...account("ntfy"), token: "" };
    const id = await sendLongtailText({ account: publicAccount, to: "alerts", text: "hi", fetcher });
    expect(id).toBe("ntfy-1");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://chat.example.test/alerts");
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).headers).not.toHaveProperty("authorization");
  });

  it("rejects provider-level failures and malformed targets before dispatch", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ result: "error" }));
    await expect(sendLongtailText({ account: account("zulip"), to: "stream/general/updates", text: "hi", fetcher })).rejects.toThrow("did not acknowledge");
    await expect(sendLongtailText({ account: account("zulip"), to: "stream/general", text: "hi", fetcher })).rejects.toThrow("requires a topic");
    await expect(sendLongtailText({ account: account("ntfy"), to: "one/two", text: "hi", fetcher })).rejects.toThrow("single topic");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("marks platform dispatch before making the HTTP request", async () => {
    const calls: string[] = [];
    await sendLongtailText({
      account: account("gotify"), to: "default", text: "hi",
      onPlatformSendDispatch: () => { calls.push("dispatch"); },
      fetcher: async () => { calls.push("fetch"); return jsonResponse({ id: 1 }); },
    });
    expect(calls).toEqual(["dispatch", "fetch"]);
  });
});
