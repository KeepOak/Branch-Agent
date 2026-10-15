import { afterEach, describe, expect, it, vi } from "vitest";
import { assertBrowserNavigationAllowed } from "../browser/navigation-guard.js";
import { GUEST_ADDRESS_REFUSAL, toGuestOp } from "./guest-args.js";
import {
  GUEST_DROPPED_NOTICE,
  GUEST_NOT_OPEN_NOTICE,
  GUEST_TIMEOUT_NOTICE,
  isGuestEligible,
  routeBrowserActionToGuest,
  withFallbackNotice,
  type GuestRouteInput,
} from "./guest-route.js";
import { createGuestRegistry, GUEST_REQUEST_EVENT, type GuestAnswer, type GuestRegistry } from "./guest-registry.js";

const PUBLIC_IP = "93.184.216.34";
const lookupFn = async () => [{ address: PUBLIC_IP, family: 4 }];
const SESSION = "agent:main:main";

type Sent = { event: string; payload: { requestId: string; op: string; args: Record<string, unknown> } };

/** A fake window connection that records each request and answers it with `answer`. */
function fakePane(options: { answer?: GuestAnswer | (() => GuestAnswer | undefined) } = {}) {
  const sent: Sent[] = [];
  let registry: GuestRegistry | undefined;
  const host = {
    connId: "conn-window",
    send: (event: string, payload: unknown) => {
      const request = payload as Sent["payload"];
      sent.push({ event, payload: request });
      const answer = typeof options.answer === "function" ? options.answer() : options.answer;
      if (answer && registry) {
        registry.respond({ requestId: request.requestId, connId: host.connId, answer });
      }
    },
  };
  return {
    sent,
    host,
    attach(next: GuestRegistry) {
      registry = next;
    },
  };
}

function setup(options: { answer?: GuestAnswer | (() => GuestAnswer | undefined); ready?: boolean; timeoutMs?: number } = {}) {
  const pane = fakePane({ answer: options.answer });
  const registry = createGuestRegistry({ timeoutMs: options.timeoutMs, createRequestId: () => "req-1" });
  pane.attach(registry);
  if (options.ready !== false) {
    registry.setReady(SESSION, true, pane.host);
  }
  const route = (input: Partial<GuestRouteInput> & Pick<GuestRouteInput, "action">) =>
    routeBrowserActionToGuest({
      sessionKey: SESSION,
      eligible: true,
      navigationPolicy: {},
      lookupFn,
      registry,
      ...input,
    });
  return { pane, route, registry };
}

describe("guest route: ready pane", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a navigate to the session's pane after the guard passes", async () => {
    const { pane, route } = setup({
      answer: { ok: true, result: { url: "https://example.com/" } },
    });
    const decision = await route({ action: "navigate", url: "https://example.com/" });

    expect(pane.sent).toEqual([
      {
        event: GUEST_REQUEST_EVENT,
        payload: { requestId: "req-1", op: "navigate", args: { url: "https://example.com/" }, sessionKey: SESSION },
      },
    ]);
    expect(decision).toMatchObject({ kind: "guest", result: { content: [{ type: "text", text: "Navigated to https://example.com/." }] } });
  });

  it("maps tabs, read and act onto guest operations", async () => {
    const { pane, route } = setup({
      answer: () => ({ ok: true, result: { url: "https://example.com/", tabs: [], text: "", title: "" } }),
    });
    await route({ action: "snapshot" });
    await route({ action: "act", act: { kind: "click", x: 10, y: 20 } });
    await route({ action: "act", act: { kind: "scroll", dy: 300 } });
    await route({ action: "tabs" });

    expect(pane.sent.map((entry) => [entry.payload.op, entry.payload.args])).toEqual([
      ["read", {}],
      ["act", { kind: "click", x: 10, y: 20 }],
      ["act", { kind: "scroll", dy: 300 }],
      ["tabs", {}],
    ]);
  });

  it("formats a read answer with its title, url and text", async () => {
    const { route } = setup({
      answer: { ok: true, result: { url: "https://example.com/", title: "Example", text: "Hello page" } },
    });
    const decision = await route({ action: "text" });
    expect(decision.kind).toBe("guest");
    if (decision.kind !== "guest") {
      throw new Error("expected a guest result");
    }
    expect(decision.result.content).toEqual([
      { type: "text", text: "Page: Example\nURL: https://example.com/\n\nHello page" },
    ]);
  });

  it("returns a window refusal as a plain error without falling back", async () => {
    const { pane, route } = setup({
      answer: { ok: false, error: "The owner has control of this page." },
    });
    await expect(route({ action: "act", act: { kind: "click", x: 1, y: 2 } })).rejects.toThrow(
      "The owner has control of this page.",
    );
    expect(pane.sent).toHaveLength(1);
  });

  it("returns the screenshot as an image block", async () => {
    const { route } = setup({
      answer: { ok: true, result: { dataUrl: "data:image/png;base64,iVBORw0KGgo=" } },
    });
    const decision = await route({ action: "screenshot" });
    expect(decision).toMatchObject({
      kind: "guest",
      result: { content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] },
    });
  });

  it("rejects a screenshot the pane sent in an unreadable form", async () => {
    const { route } = setup({ answer: { ok: true, result: { dataUrl: "not-a-data-url" } } });
    await expect(route({ action: "screenshot" })).rejects.toThrow("can't read");
  });
});

describe("guest route: fallback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses Playwright with the plain sentence when no pane is open", async () => {
    const { pane, route } = setup({ ready: false });
    const decision = await route({ action: "tabs" });

    expect(pane.sent).toEqual([]);
    expect(decision).toEqual({ kind: "playwright", notice: GUEST_NOT_OPEN_NOTICE });
    expect(GUEST_NOT_OPEN_NOTICE).toBe("Your browser pane isn't open, so I used Branch's own browser.");
  });

  it("uses Playwright with the timeout sentence when the pane does not answer", async () => {
    vi.useFakeTimers();
    const { pane, route } = setup({ answer: undefined });
    const pending = route({ action: "navigate", url: "https://example.com/" });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toEqual({ kind: "playwright", notice: GUEST_TIMEOUT_NOTICE });
    expect(GUEST_TIMEOUT_NOTICE).toBe("The browser pane didn't answer, so I used Branch's own browser.");
    expect(pane.sent).toHaveLength(1);
  });

  it("says the not-open sentence once per conversation, then stays silent", async () => {
    const { route } = setup({ ready: false });
    const first = await route({ action: "tabs" });
    const second = await route({ action: "tabs" });
    const otherConversation = await route({ action: "tabs", sessionKey: "agent:other:one" });

    expect(first.notice).toBe(GUEST_NOT_OPEN_NOTICE);
    expect(second.notice).toBeUndefined();
    expect(otherConversation.notice).toBe(GUEST_NOT_OPEN_NOTICE);
  });

  it("says nothing when the pane answers", async () => {
    const { route } = setup({ answer: { ok: true, result: { tabs: [], activeTargetId: null } } });
    const decision = await route({ action: "tabs" });
    expect(decision.kind).toBe("guest");
  });

  it("says the timeout sentence once, then stays silent when the pane does not answer again", async () => {
    vi.useFakeTimers();
    const { route } = setup({ answer: undefined });
    const first = route({ action: "navigate", url: "https://example.com/" });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(first).resolves.toEqual({ kind: "playwright", notice: GUEST_TIMEOUT_NOTICE });

    const second = route({ action: "navigate", url: "https://example.com/" });
    await vi.advanceTimersByTimeAsync(30_000);
    const again = await second;
    expect(again.kind).toBe("playwright");
    expect(again.notice).toBeUndefined();
  });

  it("says the dropped sentence when the pane closes during a request", async () => {
    const { pane, route, registry } = setup({ answer: undefined });
    const pending = route({ action: "navigate", url: "https://example.com/" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(pane.sent).toHaveLength(1);

    registry!.clearConnection(pane.host.connId);
    await expect(pending).resolves.toEqual({ kind: "playwright", notice: GUEST_DROPPED_NOTICE });
  });

  it("uses Playwright without a notice when the call is not eligible", async () => {
    const { pane, route } = setup({ answer: { ok: true, result: {} } });
    const decision = await route({ action: "navigate", url: "https://example.com/", eligible: false });
    expect(decision).toEqual({ kind: "playwright" });
    expect(pane.sent).toEqual([]);
  });

  it("does not send a click by ref when the pane is not open", async () => {
    const { pane, route } = setup({ ready: false });
    const decision = await route({ action: "act", act: { kind: "click", ref: "e5" } });
    expect(decision).toEqual({ kind: "playwright", notice: GUEST_NOT_OPEN_NOTICE });
    expect(pane.sent).toEqual([]);
  });
});

describe("guest route: refusals and guards", () => {
  it("refuses a non-web address before anything is sent", async () => {
    const { pane, route } = setup({ answer: { ok: true, result: {} } });
    await expect(route({ action: "navigate", url: "file:///etc/hosts" })).rejects.toThrow(
      GUEST_ADDRESS_REFUSAL,
    );
    expect(GUEST_ADDRESS_REFUSAL).toBe("That address isn't allowed in the browser.");
    expect(pane.sent).toEqual([]);
  });

  it("refuses a non-web address even when no pane is open", async () => {
    const { pane, route } = setup({ ready: false });
    await expect(route({ action: "navigate", url: "javascript:alert(1)" })).rejects.toThrow(
      GUEST_ADDRESS_REFUSAL,
    );
    expect(pane.sent).toEqual([]);
  });

  it("returns the navigation guard's own message and sends nothing when it blocks", async () => {
    const navigationPolicy = { ssrfPolicy: { dangerouslyAllowPrivateNetwork: false } };
    const expected = await assertBrowserNavigationAllowed({
      url: "https://10.0.0.5/",
      ssrfPolicy: navigationPolicy.ssrfPolicy,
    }).then(
      () => "",
      (error: Error) => error.message,
    );
    expect(expected).not.toBe("");

    const { pane, route } = setup({ answer: { ok: true, result: {} } });
    await expect(route({ action: "navigate", url: "https://10.0.0.5/", navigationPolicy })).rejects.toThrow(
      expected,
    );
    expect(pane.sent).toEqual([]);
  });

  it("blocks a pane answer that lands on a blocked address", async () => {
    const navigationPolicy = { ssrfPolicy: { dangerouslyAllowPrivateNetwork: false } };
    const { route } = setup({ answer: { ok: true, result: { url: "https://10.0.0.5/" } } });
    await expect(
      route({ action: "navigate", url: `https://${PUBLIC_IP}/`, navigationPolicy }),
    ).rejects.toThrow();
  });

  it("allows about:blank without a network lookup", async () => {
    const { pane, route } = setup({ answer: { ok: true, result: { url: "about:blank" } } });
    await route({ action: "navigate", url: "about:blank" });
    expect(pane.sent[0]?.payload.args).toEqual({ url: "about:blank" });
  });
});

describe("guest route: eligibility and helpers", () => {
  const base = {
    sessionKey: SESSION,
    requestedProfile: undefined,
    defaultProfile: "branch",
    usesUserBrowser: false,
    routed: false,
    bound: false,
    actAllowed: true,
  };

  it("is eligible for the default managed host browser of a conversation", () => {
    expect(isGuestEligible(base)).toBe(true);
    expect(isGuestEligible({ ...base, requestedProfile: "branch" })).toBe(true);
  });

  it("is not eligible for an explicit different profile", () => {
    expect(isGuestEligible({ ...base, requestedProfile: "user" })).toBe(false);
  });

  it("is not eligible without a conversation, for routed, bound, user-browser or unsupported act calls", () => {
    expect(isGuestEligible({ ...base, sessionKey: undefined })).toBe(false);
    expect(isGuestEligible({ ...base, usesUserBrowser: true })).toBe(false);
    expect(isGuestEligible({ ...base, routed: true })).toBe(false);
    expect(isGuestEligible({ ...base, bound: true })).toBe(false);
    expect(isGuestEligible({ ...base, actAllowed: false })).toBe(false);
  });

  it("maps only the supported tool actions", () => {
    expect(toGuestOp("tabs")).toBe("tabs");
    expect(toGuestOp("navigate")).toBe("navigate");
    expect(toGuestOp("text")).toBe("read");
    expect(toGuestOp("snapshot")).toBe("read");
    expect(toGuestOp("act")).toBe("act");
    expect(toGuestOp("screenshot")).toBe("screenshot");
    expect(toGuestOp("pdf")).toBeUndefined();
  });

  it("prefixes a Playwright result with the notice as a text block", () => {
    const result = { content: [{ type: "text" as const, text: "page" }], details: {} };
    expect(withFallbackNotice(result, GUEST_NOT_OPEN_NOTICE).content).toEqual([
      { type: "text", text: GUEST_NOT_OPEN_NOTICE },
      { type: "text", text: "page" },
    ]);
    expect(withFallbackNotice(result, undefined)).toBe(result);
  });
});
