// @vitest-environment jsdom
// Private #1093 item 5: buttons that looked dead now answer where you clicked, in plain words.
// B-029 Check what works (a blank dialog), B-047 Show where (nothing visible), B-052 Check now (silent while a newer copy
// waits), B-058 Send test ("Sent." when nothing showed), B-069 Copy (no toast).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { getToasts, dismiss } from "../../../shell/notify";
import { SettingsPage } from "../index";
import { DesktopNotices, TEST_SENDING } from "../set1/notifications-browser";
import { CodeRow } from "./common";
import { UpdatesPage } from "./updates";
import { SettingsFrame } from "../../../screens/settings/SettingsFrame";
import { R1_PAGES } from "../../../screens/settings/pages/plugged";
import { forgetLookStore } from "../set1/appearance-store";

type Answers = Record<string, unknown>;
function engineWith(answers: Answers, gatewayUrl?: string) {
  const request = vi.fn(async (method: string) => {
    const a = answers[method];
    if (a instanceof Error) throw a;
    return a === undefined ? {} : a;
  });
  const engine = { gatewayUrl, request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as WindowEngine;
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
const desktopWindow = window as unknown as { branchDesktop?: unknown };
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); host.className = "set-col"; document.body.append(host); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); document.body.innerHTML = "";
  for (const t of getToasts()) dismiss(t.id);
  delete desktopWindow.branchDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
const click = async (el: HTMLElement | undefined) => { if (!el) throw new Error("no such button"); await act(async () => el.click()); await flush(); };

describe("Check what works (B-029)", () => {
  it("says in one plain line what the check found, never a blank dialog, and Check again ends with its time", async () => {
    const { engine, request } = engineWith({ "config.get": { hash: "h", valid: true, config: {} }, "computer.status": {} });
    await act(async () => root.render(<SettingsPage page="computer" title="Computer & browser" level="regular" engine={engine} />));
    await flush();
    const row = document.querySelector<HTMLElement>('[data-row="Check what works"]')!;
    await click([...row.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Check"));
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog().textContent).toContain("Using the screen, mouse and keyboard isn’t set up on this computer yet.");
    expect(dialog().textContent).toMatch(/Checked at /);
    await click(button("Check again"));
    expect(request.mock.calls.filter(([m]) => m === "computer.status").length).toBeGreaterThanOrEqual(2);
    expect(dialog().textContent).toContain("isn’t set up on this computer yet.");
    expect(dialog().textContent).toMatch(/Checked at /);
  });

  it("a failed check says so plainly, with Try again, and no raw error", async () => {
    const { engine } = engineWith({ "config.get": { hash: "h", valid: true, config: {} }, "computer.status": new Error("SessionStoreAgentIdRequiredError: path") });
    await act(async () => root.render(<SettingsPage page="computer" title="Computer & browser" level="regular" engine={engine} />));
    await flush();
    const row = document.querySelector<HTMLElement>('[data-row="Check what works"]')!;
    await click([...row.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Check"));
    const text = document.querySelector<HTMLElement>('[role="dialog"]')!.textContent ?? "";
    expect(text).toContain("Branch couldn’t check this computer. Try again in a moment.");
    expect(text).not.toContain("SessionStoreAgentIdRequiredError");
    expect(button("Try again")).toBeTruthy();
  });
});

describe("Show where (B-047)", () => {
  it("scrolls to the keys, marks them for a moment and says where they are; says where to look when they aren't on the page", async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) { scrolled.push(this); };
    const { engine } = engineWith({ "config.get": { hash: "h", valid: true, config: {} }, "secrets.store.list": { entries: [] } });
    await act(async () => root.render(<SettingsPage page="secrets" title="Sign-ins & keys" level="advanced" engine={engine} />));
    await flush();
    const target = document.createElement("section"); target.id = "sec-signins-Keys Branch holds"; document.body.append(target);
    document.getElementById("s2-keys")?.removeAttribute("id");
    await click(button("Show where"));
    expect(scrolled).toContain(target);
    expect(target.hasAttribute("data-flash")).toBe(true);
    expect(document.body.textContent).toContain("Your keys are listed below, under “Keys Branch holds”.");
    target.remove();
    await click(button("Show where"));
    expect(document.body.textContent).toContain("Your keys are listed under “Keys Branch holds” on Sign-ins & keys, at Advanced.");
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});

describe("Send test on this computer (B-058)", () => {
  class FakeNotice {
    static permission: NotificationPermission = "granted";
    static made: FakeNotice[] = [];
    static requestPermission = async () => "granted" as NotificationPermission;
    onshow: (() => void) | null = null;
    onerror: (() => void) | null = null;
    title: string;
    opts: NotificationOptions;
    constructor(title: string, opts: NotificationOptions) { this.title = title; this.opts = opts; FakeNotice.made.push(this); }
  }
  beforeEach(() => { FakeNotice.made = []; vi.stubGlobal("Notification", FakeNotice); desktopWindow.branchDesktop = {}; });
  const line = () => document.querySelector<HTMLElement>('[data-row="Send a test notification"]')?.textContent ?? document.body.textContent ?? "";

  it("says Sent only once this computer showed it", async () => {
    await act(async () => root.render(<DesktopNotices />));
    await click(button("Send test"));
    expect(FakeNotice.made).toHaveLength(1);
    expect(document.body.textContent).toContain(TEST_SENDING);
    expect(document.body.textContent).not.toMatch(/Sent\./);
    await act(async () => FakeNotice.made[0].onshow?.());
    await flush();
    expect(line()).toContain("Sent. It shows in the corner of your screen, or in your notification list.");
  });

  it("says plainly why when this computer refuses it, and what to do when it says nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => root.render(<DesktopNotices />));
    await act(async () => button("Send test")!.click());
    await act(async () => FakeNotice.made[0].onerror?.());
    await act(async () => { await Promise.resolve(); });
    expect(document.body.textContent).toContain("This computer didn’t show it. Open your system settings and allow notifications for Branch.");
    await act(async () => button("Send test")!.click());
    await act(async () => { vi.advanceTimersByTime(4000); await Promise.resolve(); });
    expect(document.body.textContent).toContain("Sent, but this computer didn’t say it showed it.");
  });
});

describe("Check now while a newer Branch waits (B-052)", () => {
  it("the row says the check finished and what it found; a failed check says so", async () => {
    const staged = { phase: "staged", currentVersion: "0.4.4", latestVersion: "0.4.5", pendingVersion: "0.4.5", checkedAt: Date.now() - 3600_000, error: null };
    let fail = false;
    const check = vi.fn(async () => { if (fail) throw new Error("ECONNRESET"); return { ...staged, checkedAt: Date.now() }; });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    desktopWindow.branchDesktop = { gatewayUrl: "ws://127.0.0.1:1", componentUpdates: { status: async () => staged, check, stage: async () => staged } };
    const { engine } = engineWith({}, "ws://127.0.0.1:1");
    await act(async () => root.render(<UpdatesPage page="updates" title="Updates" level="regular" engine={engine} />));
    await flush();
    await click(button("Check now"));
    expect(check).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toMatch(/Checked at [^.]+\. A new Branch is ready and applies by itself\./);
    fail = true;
    await click(button("Check now"));
    expect(document.body.textContent).toContain("Branch couldn’t check for updates. Try again in a minute.");
  });
});

describe("Copy (B-069)", () => {
  it("says Copied in a toast and on the button", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await act(async () => root.render(<CodeRow title="Claude Code" code="claude mcp add --scope user branch -- branch graft" />));
    await click(button("Copy"));
    expect(writeText).toHaveBeenCalledWith("claude mcp add --scope user branch -- branch graft");
    expect(getToasts().map((t) => t.text)).toContain("Copied.");
    expect(button("Copied")).toBeTruthy();
  });

  it("uses the Branch app's clipboard when the window's is refused, and says plainly when neither works", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error("NotAllowedError"); }) } });
    const bridge = vi.fn(async () => undefined);
    desktopWindow.branchDesktop = { clipboard: { writeText: bridge } };
    await act(async () => root.render(<CodeRow title="Codex" code="codex mcp add branch -- branch graft" />));
    await click(button("Copy"));
    expect(bridge).toHaveBeenCalledWith("codex mcp add branch -- branch graft");
    expect(getToasts().map((t) => t.text)).toContain("Copied.");
    for (const t of getToasts()) dismiss(t.id);
    delete desktopWindow.branchDesktop;
    await act(async () => new Promise((r) => setTimeout(r, 1700)));
    await click(button("Copy"));
    const toast = getToasts().at(-1)!;
    expect(toast.text).toBe("Couldn’t copy. Select the text and copy it yourself.");
    expect(toast.tone).toBe("bad");
    expect(toast.text).not.toContain("NotAllowedError");
  });
});

describe("Copy on R1 Settings › Customize › Connect an agent (B-069)", () => {
  const frameEngine = () => engineWith({ "config.get": { hash: "h1", valid: true, config: {} }, "config.schema": { schema: {}, uiHints: {} }, "users.prefs.get": { status: "ok", entries: {} }, "themes.list": { current: {} } }).engine;
  it("says Copied when the Branch app's clipboard takes it, and says why not when nothing can", async () => {
    localStorage.clear(); forgetLookStore();
    localStorage.setItem("branch.level", "advanced");
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const bridge = vi.fn(async () => undefined);
    desktopWindow.branchDesktop = { clipboard: { writeText: bridge } };
    await act(async () => root.render(<SettingsFrame engine={frameEngine()} page="customize" pages={R1_PAGES} />));
    await flush();
    const copyButtons = () => [...document.querySelectorAll<HTMLButtonElement>(".r1s-codeline button")].filter((b) => b.textContent === "Copy");
    expect(copyButtons().length, document.querySelector('[aria-label="Connect an agent"]')?.outerHTML.slice(0, 600)).toBeGreaterThan(0);
    await click(copyButtons()[0]);
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(getToasts().map((t) => t.text)).toContain("Copied.");
    for (const t of getToasts()) dismiss(t.id);
    delete desktopWindow.branchDesktop;
    await click(copyButtons()[0]);
    expect(getToasts().at(-1)?.text).toBe("Couldn’t copy. Select the text and copy it yourself.");
    localStorage.clear();
  });
});
