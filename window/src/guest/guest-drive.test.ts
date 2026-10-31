import { describe, expect, it, vi, type Mock } from "vitest";
import {
  ADDRESS_REFUSAL,
  CONSENT_REFUSAL,
  GuestRefusal,
  OWNER_REFUSAL,
  READ_LIMIT,
  guestAddress,
  runGuestRequest,
  type GuestAccess,
  type GuestDriveContext,
  type GuestImage,
  type GuestWebview,
} from "./guest-drive";

function fakePage(overrides: Partial<GuestWebview> = {}) {
  const page = {
    loadURL: vi.fn(async () => undefined),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    getURL: vi.fn(() => "https://example.com/"),
    getTitle: vi.fn(() => "Example"),
    executeJavaScript: vi.fn(async () => "page text"),
    sendInputEvent: vi.fn<(event: Record<string, unknown>) => void>(),
    insertText: vi.fn(async () => undefined),
    capturePage: vi.fn(async (): Promise<GuestImage> => ({ toDataURL: () => "data:image/png;base64,AAAA" })),
    ...overrides,
  };
  return page as typeof page & GuestWebview;
}

function context(page: GuestWebview | null, access: GuestAccess = "allowed") {
  const ctx: GuestDriveContext = {
    access: () => access,
    tabs: () => ({ tabs: [{ targetId: "tab-1", title: "Example", url: "https://example.com/" }], activeTargetId: "tab-1" }),
    page: () => page,
    openTab: vi.fn(),
  };
  return ctx;
}

/** The events a fake page was sent, in order. */
const sentEvents = (page: GuestWebview): unknown[][] => (page.sendInputEvent as unknown as Mock).mock.calls;

const run = (ctx: GuestDriveContext, op: string, args: unknown = {}) => runGuestRequest(ctx, op, args);

describe("guest address rules", () => {
  it("allows web pages and about:blank only", () => {
    expect(guestAddress("https://example.com/a")).toBe("https://example.com/a");
    expect(guestAddress("http://localhost:3000")).toBe("http://localhost:3000/");
    expect(guestAddress("about:blank")).toBe("about:blank");
    expect(guestAddress("file:///etc/passwd")).toBeNull();
    expect(guestAddress("javascript:alert(1)")).toBeNull();
    expect(guestAddress("chrome://settings")).toBeNull();
    expect(guestAddress("not a url")).toBeNull();
  });
});

describe("guest drive access", () => {
  it("refuses every request until the owner allows it", async () => {
    const page = fakePage();
    await expect(run(context(page, "needs-consent"), "tabs")).rejects.toThrow(CONSENT_REFUSAL);
    await expect(run(context(page, "needs-consent"), "read")).rejects.toThrow(new GuestRefusal(CONSENT_REFUSAL).message);
    expect(page.executeJavaScript).not.toHaveBeenCalled();
  });

  it("refuses every request while the owner has the page", async () => {
    const page = fakePage();
    await expect(run(context(page, "owner-control"), "navigate", { url: "https://example.com" })).rejects.toThrow(OWNER_REFUSAL);
    expect(page.loadURL).not.toHaveBeenCalled();
  });
});

describe("guest drive navigate", () => {
  it("refuses file: and other non-web addresses before loading anything", async () => {
    const page = fakePage();
    await expect(run(context(page), "navigate", { url: "file:///secret.txt" })).rejects.toThrow(ADDRESS_REFUSAL);
    expect(page.loadURL).not.toHaveBeenCalled();
  });

  it("loads a web address and reports where the page ended up", async () => {
    const page = fakePage({ getURL: vi.fn(() => "https://example.org/landed") });
    await expect(run(context(page), "navigate", { url: "https://example.org" })).resolves.toEqual({ url: "https://example.org/landed" });
    expect(page.loadURL).toHaveBeenCalledWith("https://example.org/");
  });

  it("still reports the address when the page fails to load", async () => {
    const page = fakePage({ loadURL: vi.fn(async () => { throw new Error("ERR_ABORTED"); }) });
    await expect(run(context(page), "navigate", { url: "https://example.com" })).resolves.toEqual({ url: "https://example.com/" });
  });

  it("opens a tab when no tab is open", async () => {
    const ctx = context(null);
    await expect(run(ctx, "navigate", { url: "https://example.com" })).resolves.toEqual({ url: "https://example.com/" });
    expect(ctx.openTab).toHaveBeenCalledWith("https://example.com/");
  });
});

describe("guest drive read and tabs", () => {
  it("lists the tabs and the showing one", async () => {
    await expect(run(context(fakePage()), "tabs")).resolves.toEqual({
      tabs: [{ targetId: "tab-1", title: "Example", url: "https://example.com/" }],
      activeTargetId: "tab-1",
    });
  });

  it("caps the text a read returns", async () => {
    const page = fakePage({ executeJavaScript: vi.fn(async () => "x".repeat(READ_LIMIT + 500)) });
    const result = (await run(context(page), "read")) as { text: string; url: string; title: string };
    expect(result.text).toHaveLength(READ_LIMIT);
    expect(result).toMatchObject({ url: "https://example.com/", title: "Example" });
  });

  it("says a page must be open before it can be read", async () => {
    await expect(run(context(null), "read")).rejects.toThrow("Open a page first.");
  });
});

describe("guest drive act", () => {
  it("clicks with a left mouse down and up at the given point", async () => {
    const page = fakePage();
    await run(context(page), "act", { kind: "click", x: 40, y: 75 });
    expect(sentEvents(page)).toEqual([
      [{ x: 40, y: 75, button: "left", clickCount: 1, type: "mouseDown" }],
      [{ x: 40, y: 75, button: "left", clickCount: 1, type: "mouseUp" }],
    ]);
  });

  it("refuses a click without a point", async () => {
    await expect(run(context(fakePage()), "act", { kind: "click", x: 4 })).rejects.toThrow("Say where on the page to click.");
  });

  it("types text through insertText", async () => {
    const page = fakePage();
    await run(context(page), "act", { kind: "type", text: "hello" });
    expect(page.insertText).toHaveBeenCalledWith("hello");
  });

  it("presses a key down and up", async () => {
    const page = fakePage();
    await run(context(page), "act", { kind: "press", key: "Enter" });
    expect(sentEvents(page)).toEqual([[{ type: "keyDown", keyCode: "Enter" }], [{ type: "keyUp", keyCode: "Enter" }]]);
  });

  it("scrolls with a wheel event carrying deltaY", async () => {
    const page = fakePage();
    await run(context(page), "act", { kind: "scroll", dy: 300 });
    expect(page.sendInputEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "mouseWheel", deltaY: 300 }));
  });

  it("refuses an unknown act kind", async () => {
    await expect(run(context(fakePage()), "act", { kind: "drag" })).rejects.toThrow("The browser can't do that to the page.");
  });
});

describe("guest drive screenshot", () => {
  it("returns the picture as a data URL", async () => {
    await expect(run(context(fakePage()), "screenshot")).resolves.toEqual({ dataUrl: "data:image/png;base64,AAAA" });
  });

  it("shrinks a picture wider than the cap", async () => {
    const resized: GuestImage = { toDataURL: () => "data:image/png;base64,SMALL" };
    const big: GuestImage = { toDataURL: () => "data:image/png;base64,BIG", getSize: () => ({ width: 2560, height: 1600 }), resize: vi.fn(() => resized) };
    const page = fakePage({ capturePage: vi.fn(async () => big) });
    await expect(run(context(page), "screenshot")).resolves.toEqual({ dataUrl: "data:image/png;base64,SMALL" });
    expect(big.resize).toHaveBeenCalledWith({ width: 1280 });
  });
});
