// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
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
});
const methods = ["session.reactions.set", "chat.send", "sessions.fork", "sessions.rewind", "session.context.set", "talk.speak"];
const engine = { features: { methods, events: [] } };
const menuRows = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')];

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
  expect(labels).toEqual(["Copy›", "Pin", "Try again", "Read aloud", "Branch from here", "Leave out of context", "Share as a picture", "Continue in a coding app", "Look inside", "Delete"]);
  expect(document.querySelector(".r1c-menu-meta")!.textContent).toMatch(/·/);
  const row = (label: string) => menuRows().find((b) => b.textContent === label)!;
  for (const soon of ["Pin", "Share as a picture", "Continue in a coding app", "Delete"]) {
    expect(row(soon).getAttribute("aria-disabled")).toBe("true");
    expect(row(soon).title).not.toBe("");
  }
  expect(row("Delete").dataset.danger).toBe("true");
  expect(row("Branch from here").title).toBe("Available when the agent finishes.");
  await act(async () => row("Branch from here").click());
  expect(a.branch!.run).not.toHaveBeenCalled();
  await act(async () => row("Try again").click());
  expect(a.retry!.run).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("every engine-calling row declares its method: with all of them each row runs and only Copy and Look inside are local", async () => {
  await act(async () => root.render(<CapabilityProvider engine={engine}><HoverBar text="Hi" isReply actions={actions()} /></CapabilityProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  const row = (label: string) => menuRows().find((b) => b.textContent === label)!;
  expect(row("Try again").dataset.need).toBe("sessions.rewind chat.send");
  expect(row("Read aloud").dataset.need).toBe("talk.speak");
  expect(row("Branch from here").dataset.need).toBe("sessions.fork");
  expect(row("Leave out of context").dataset.need).toBe("session.context.set");
  expect(menuRows().filter((b) => b.hasAttribute("data-local")).map((b) => b.textContent)).toEqual(["Copy›", "Look inside"]);
});

it("on an engine without those methods, Try again, Edit, Read aloud, Branch from here and Leave out of context turn Coming and run nothing", async () => {
  const none = { features: { methods: [], events: [] } };
  const a = actions();
  await act(async () => root.render(<CapabilityProvider engine={none}><HoverBar text="Hi" isReply actions={{ ...a, branch: { run: vi.fn(), disabled: null } }} /></CapabilityProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  const row = (label: string) => menuRows().find((b) => b.textContent === label)!;
  for (const label of ["Try again", "Read aloud", "Branch from here", "Leave out of context"]) {
    expect(row(label).getAttribute("aria-disabled"), label).toBe("true");
    expect(row(label).dataset.coming, label).toBeTruthy();
    expect(row(label).title, label).toBe(row(label).dataset.coming);
    expect(row(label).hasAttribute("data-local"), label).toBe(false);
  }
  await act(async () => row("Try again").click());
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

it("Copy › offers text, Markdown and a Coming link", async () => {
  await act(async () => root.render(<HoverBar text="Hi" isReply={false} actions={{ ...actions(), edit: { run: vi.fn(), disabled: null } }} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  expect(menuRows().map((b) => b.textContent)).toContain("Edit");
  await act(async () => menuRows()[0].click());
  expect(menuRows().map((b) => b.textContent)).toEqual(["Copy", "Text", "Markdown", "Link"]);
  expect(menuRows()[3].getAttribute("aria-disabled")).toBe("true");
});

it("reactions turn to Coming when the engine has no reactions method", async () => {
  await act(async () => root.render(<CapabilityProvider engine={{ features: { methods: [], events: [] } }}><HoverBar text="Hi" isReply actions={actions()} /></CapabilityProvider>));
  const react = host.querySelector<HTMLButtonElement>('[aria-label="React"]')!;
  expect(react.getAttribute("aria-disabled")).toBe("true");
  await act(async () => react.click());
  expect(document.querySelector('[aria-label="Quick reactions"]')).toBeNull();
});

it("copies plain words without Markdown marks", () => {
  expect(plainText("## Plan\n- **Find** [the invoice](https://x)\n`code`")).toBe("Plan\n• Find the invoice\ncode");
});
