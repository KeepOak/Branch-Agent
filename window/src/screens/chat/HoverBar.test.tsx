// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import { comingControls } from "../../glass/coming-registry";
import type { HoverActions } from "../../thread/HoverBar";
import { plainText } from "./chat-logic";
import { HoverBar } from "./HoverBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const actions = (): HoverActions => ({
  copy: { run: vi.fn(), disabled: null },
  retry: { run: vi.fn(), disabled: null },
  reply: { run: vi.fn(), disabled: null },
  react: vi.fn(),
  reactDisabled: null,
  inspect: { run: vi.fn(), disabled: null },
  branch: { run: vi.fn(), disabled: "Not while Scout is working.", waiting: true },
  context: { run: vi.fn(), disabled: null, excluded: false },
  read: { run: vi.fn(), disabled: null, reading: false },
  pin: { run: vi.fn(), disabled: null, pinned: false },
  remove: { run: vi.fn(), disabled: null },
});
const methods = ["session.reactions.set", "chat.send", "sessions.fork", "sessions.rewind", "session.context.set", "talk.speak", "sessions.messages.pin", "sessions.messages.delete"];
const engine = { features: { methods, events: [] } };
const menuRows = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')];

it("Share as a picture and Continue in a coding app stay greyed with the preview's reason, in its place, even when the engine offers their calls", async () => {
  const offered = { features: { methods: [...methods, "sessions.messages.share", "sessions.handoff"], events: [] } };
  await act(async () => root.render(<CapabilityProvider engine={offered}><HoverBar text="Hi" isReply actions={actions()} /></CapabilityProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  const row = (label: string) => menuRows().find((b) => b.textContent === label)!;
  expect(row("Share as a picture…").getAttribute("aria-disabled")).toBe("true");
  expect(row("Share as a picture…").title).toBe("Sharing a message as a picture comes in a later update.");
  expect(row("Continue in a coding app…").getAttribute("aria-disabled")).toBe("true");
  expect(row("Continue in a coding app…").title).toBe("Carrying a conversation into a coding app on this computer needs the Branch app.");
  const labels = menuRows().map((b) => b.textContent);
  expect(labels).not.toContain("Link");
  expect(labels.indexOf("Look inside")).toBe(labels.indexOf("Leave out of context") + 1);
  expect(labels.indexOf("Share as a picture…")).toBe(labels.indexOf("Look inside") + 1);
  expect(labels.indexOf("Continue in a coding app…")).toBe(labels.indexOf("Share as a picture…") + 1);
  expect(labels.indexOf("Delete")).toBe(labels.indexOf("Continue in a coding app…") + 1);
  expect(comingControls().some((c) => c.need.includes("sessions.handoff") && c.where === "Continue in a coding app…")).toBe(true);
});

it("#977: Pin, Unpin and Delete run their engine calls on an engine that has them", async () => {
  const a = actions();
  const all = { features: { methods, events: [] } };
  await act(async () => root.render(<CapabilityProvider engine={all}><HoverBar text="Hi" isReply actions={a} /></CapabilityProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  const row = (label: string) => menuRows().find((b) => b.textContent === label)!;
  for (const label of ["Pin", "Delete"]) {
    expect(row(label).getAttribute("aria-disabled"), label).toBeNull();
    expect(row(label).dataset.coming, label).toBeFalsy();
  }
  await act(async () => row("Pin").click());
  expect(a.pin!.run).toHaveBeenCalledOnce();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  await act(async () => row("Delete").click());
  expect(a.remove!.run).toHaveBeenCalledOnce();
  await act(async () => root.render(<CapabilityProvider engine={all}><HoverBar text="Hi" isReply actions={{ ...a, pin: { ...a.pin!, pinned: true } }} /></CapabilityProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  expect(menuRows().map((b) => b.textContent)).toContain("Unpin");
});

it("has exactly three buttons: React, Reply and •••", async () => {
  await act(async () => root.render(<CapabilityProvider engine={engine}><HoverBar text="Hi" isReply actions={actions()} /></CapabilityProvider>));
  const labels = [...host.querySelectorAll('[data-testid="hover-bar"] > button')].map((b) => b.getAttribute("aria-label"));
  expect(labels).toEqual(["React", "Reply", "More for this message"]);
});

it("••• opens the message menu with its time and model, and every row runs or says why not", async () => {
  const a = actions();
  await act(async () => root.render(<CapabilityProvider engine={engine}><HoverBar text="**Hi** there" isReply actions={a} meta={{ timestamp: Date.now(), model: "openai/gpt-6.1-sol" }} /></CapabilityProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  const labels = menuRows().map((b) => b.textContent);
  expect(labels).toEqual(["Copy›", "Reply", "Retry", "Pin", "Read aloud", "Branch from here", "Leave out of context", "Look inside", "Share as a picture…", "Continue in a coding app…", "Delete"]);
  expect(document.querySelector(".r1c-menu-meta")!.textContent).toMatch(/·/);
  const row = (label: string) => menuRows().find((b) => b.textContent === label)!;
  for (const wired of ["Pin", "Delete"]) expect(row(wired).getAttribute("aria-disabled"), wired).toBeNull();
  expect(row("Delete").dataset.danger).toBe("true");
  expect(row("Branch from here").title).toBe("Available when the agent finishes.");
  await act(async () => row("Branch from here").click());
  expect(a.branch!.run).not.toHaveBeenCalled();
  await act(async () => row("Retry").click());
  expect(a.retry!.run).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("every engine-calling row declares its method: with all of them each row runs and only Copy and Look inside are local", async () => {
  await act(async () => root.render(<CapabilityProvider engine={engine}><HoverBar text="Hi" isReply actions={actions()} /></CapabilityProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  const row = (label: string) => menuRows().find((b) => b.textContent === label)!;
  expect(row("Reply").dataset.need).toBe("chat.send");
  expect(row("Retry").dataset.need).toBe("sessions.rewind chat.send");
  expect(row("Read aloud").dataset.need).toBe("talk.speak");
  expect(row("Branch from here").dataset.need).toBe("sessions.fork");
  expect(row("Leave out of context").dataset.need).toBe("session.context.set");
  expect(row("Pin").dataset.need).toBe("sessions.messages.pin");
  expect(row("Delete").dataset.need).toBe("sessions.messages.delete");
  expect(menuRows().filter((b) => b.hasAttribute("data-local")).map((b) => b.textContent)).toEqual(["Copy›", "Look inside"]);
});

it("on an engine without those methods, Reply, Retry, Edit, Read aloud, Branch from here, Leave out of context, Pin and Delete turn Coming and run nothing", async () => {
  const none = { features: { methods: [], events: [] } };
  const a = actions();
  await act(async () => root.render(<CapabilityProvider engine={none}><HoverBar text="Hi" isReply actions={{ ...a, branch: { run: vi.fn(), disabled: null } }} /></CapabilityProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  const row = (label: string) => menuRows().find((b) => b.textContent === label)!;
  for (const label of ["Reply", "Retry", "Read aloud", "Branch from here", "Leave out of context", "Pin", "Delete"]) {
    expect(row(label).getAttribute("aria-disabled"), label).toBe("true");
    expect(row(label).dataset.coming, label).toBeTruthy();
    expect(row(label).title, label).toBe(row(label).dataset.coming);
    expect(row(label).hasAttribute("data-local"), label).toBe(false);
  }
  await act(async () => row("Retry").click());
  expect(a.retry!.run).not.toHaveBeenCalled();
  await act(async () => row("Leave out of context").click());
  expect(a.context!.run).not.toHaveBeenCalled();
  for (const label of ["Copy›", "Look inside"]) expect(row(label).getAttribute("aria-disabled"), label).toBeNull();
  const reply = host.querySelector<HTMLButtonElement>('[aria-label="Reply"]')!;
  expect(reply.getAttribute("aria-disabled")).toBe("true");
  expect(reply.title).not.toMatch(/later update/);
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<CapabilityProvider engine={none}><HoverBar text="Hi" isReply={false} actions={{ ...actions(), edit: { run: vi.fn(), disabled: null } }} /></CapabilityProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  expect(row("Edit").getAttribute("aria-disabled")).toBe("true");
  expect(row("Edit").dataset.coming).toBeTruthy();
});

it("Copy › swaps to Text and Markdown in the same turn, without scrolling or the clipboard", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const calls: unknown[] = [];
  const native = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    calls.push(options);
    return native.call(this, options);
  };
  try {
    await act(async () => root.render(<HoverBar text="**Hi** there" isReply={false} actions={actions()} />));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
    calls.length = 0;
    await act(async () => menuRows()[0].click());
    expect(menuRows().map((b) => b.textContent)).toEqual(["Copy", "Text", "Markdown"]);
    expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe("Copy");
    expect(writeText).not.toHaveBeenCalled();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((options) => Boolean(options && typeof options === "object" && (options as FocusOptions).preventScroll))).toBe(true);
  } finally {
    HTMLElement.prototype.focus = native;
  }
});

it("Copy › offers text and Markdown and no link row", async () => {
  await act(async () => root.render(<HoverBar text="Hi" isReply={false} actions={{ ...actions(), edit: { run: vi.fn(), disabled: null } }} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  expect(menuRows().map((b) => b.textContent)).toContain("Edit");
  await act(async () => menuRows()[0].click());
  expect(menuRows().map((b) => b.textContent)).toEqual(["Copy", "Text", "Markdown"]);
  expect(document.querySelectorAll('[role="menu"] [aria-disabled="true"]')).toHaveLength(0);
});

it("reactions turn to Coming when the engine has no reactions method", async () => {
  await act(async () => root.render(<CapabilityProvider engine={{ features: { methods: [], events: [] } }}><HoverBar text="Hi" isReply actions={actions()} /></CapabilityProvider>));
  const react = host.querySelector<HTMLButtonElement>('[aria-label="React"]')!;
  expect(react.getAttribute("aria-disabled")).toBe("true");
  await act(async () => react.click());
  expect(document.querySelector('[aria-label="Quick reactions"]')).toBeNull();
});

it("Technical shows Show what it did instead of Look inside", async () => {
  localStorage.setItem("branch.level", "technical");
  const a = actions();
  await act(async () => root.render(<CapabilityProvider engine={engine}><HoverBar text="Hi" isReply actions={a} /></CapabilityProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  const labels = menuRows().map((b) => b.textContent);
  expect(labels).toContain("Show what it did");
  expect(labels).not.toContain("Look inside");
  const work = menuRows().find((b) => b.textContent === "Show what it did")!;
  expect(work.hasAttribute("data-local")).toBe(true);
  await act(async () => work.click());
  expect(a.inspect!.run).toHaveBeenCalledOnce();
  localStorage.removeItem("branch.level");
});

it("copies plain words without Markdown marks", () => {
  expect(plainText("## Plan\n- **Find** [the invoice](https://x)\n`code`")).toBe("Plan\n• Find the invoice\ncode");
});
