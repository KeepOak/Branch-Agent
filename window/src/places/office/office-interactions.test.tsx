// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { OfficePlace } from "./index";
import { handleOfficeNavigation } from "./navigation";
import { claimOfficeModalEscape, notePointerInside, setOfficeKeyRoot } from "./pixel/webview-ui/src/branch/keyScope";
import { useEditorKeyboard } from "./pixel/webview-ui/src/hooks/useEditorKeyboard";
import { EditorState } from "./pixel/webview-ui/src/office/editor/editorState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("./pixel/webview-ui/src/branch/mount", () => ({
  Storage: class { constructor(_initial: unknown, _save: unknown) {} },
  mountPixelOffice: (host: HTMLElement, options: { onOpen: (id: string) => void }) => {
    const button = document.createElement("button");
    button.textContent = "Oak character";
    button.onclick = () => options.onOpen("oak");
    host.appendChild(button);
    return { update: () => undefined, setReducedMotion: () => undefined, destroy: () => host.replaceChildren() };
  },
}));

afterEach(() => { setOfficeKeyRoot(null); document.body.replaceChildren(); vi.restoreAllMocks(); });

it("opens the real Trunk chat when its office character is clicked", async () => {
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  const openConversation = vi.fn();
  const engine = {
    request: vi.fn(async (method: string) => method === "agents.list" ? { agents: [{ id: "oak", identity: { name: "Oak" } }] }
      : method === "sessions.list" ? { sessions: [] }
      : method === "contacts.list" ? { contacts: [{ id: "trunk:oak", kind: "trunk", name: "Oak", threadKey: "agent:oak:main" }] }
      : method === "users.prefs.get" ? { status: "ok", entries: {} } : {}),
    onEvent: () => () => undefined,
  } as unknown as WindowEngine;
  await act(async () => { root.render(<OfficePlace engine={engine} facts={{ running: 0, waiting: 0 }} level="regular" openConversation={openConversation} openPlace={() => undefined} />); });
  await act(async () => { await vi.waitFor(() => expect(host.querySelector("button")?.textContent).toBe("Oak character")); });
  await act(async () => host.querySelector("button")!.click());
  expect(openConversation).toHaveBeenCalledWith("agent:oak:main");
  await act(async () => root.unmount());
});

it("uses browser back/forward and leaves the office with Esc after an office click", () => {
  const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
  const forward = vi.spyOn(history, "forward").mockImplementation(() => undefined);
  const goOverview = vi.fn();
  const host = document.createElement("section"); host.dataset.testid = "pixel-office";
  const button = document.createElement("button"); host.appendChild(button); document.body.appendChild(host); button.focus();
  history.replaceState({ branchIndex: 1 }, "");
  expect(handleOfficeNavigation(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }), true, goOverview)).toBe(true);
  expect(back).toHaveBeenCalledTimes(1);
  expect(handleOfficeNavigation(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, cancelable: true }), true, goOverview)).toBe(true);
  expect(back).toHaveBeenCalledTimes(2);
  expect(handleOfficeNavigation(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, cancelable: true }), true, goOverview)).toBe(true);
  expect(forward).toHaveBeenCalledTimes(1);
  history.replaceState({ branchIndex: 0 }, "");
  expect(handleOfficeNavigation(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }), true, goOverview)).toBe(true);
  expect(goOverview).toHaveBeenCalledTimes(1);
});

it("keeps Option-arrow word navigation inside text fields", () => {
  const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
  const forward = vi.spyOn(history, "forward").mockImplementation(() => undefined);
  const route = (event: KeyboardEvent) => handleOfficeNavigation(event, false, vi.fn());
  window.addEventListener("keydown", route);
  try {
    for (const element of [document.createElement("input"), document.createElement("textarea"), document.createElement("div")]) {
      if (element.tagName === "DIV") element.setAttribute("contenteditable", "true");
      document.body.appendChild(element);
      const left = new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true });
      const right = new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true });
      element.dispatchEvent(left);
      element.dispatchEvent(right);
      expect(left.defaultPrevented, element.tagName).toBe(false);
      expect(right.defaultPrevented, element.tagName).toBe(false);
    }
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  } finally { window.removeEventListener("keydown", route); }
});

it("claims Escape in capture phase while editing with focus inside the office shadow root", async () => {
  const host = document.createElement("section"); host.dataset.testid = "pixel-office";
  const shadow = host.attachShadow({ mode: "open" });
  const office = document.createElement("div"); shadow.appendChild(office); document.body.appendChild(host);
  setOfficeKeyRoot(office);
  const root = createRoot(office);
  const state = new EditorState();
  const close = vi.fn();
  const shell = vi.fn((event: KeyboardEvent) => handleOfficeNavigation(event, true, vi.fn()));
  window.addEventListener("keydown", shell);
  function EditorHarness() {
    useEditorKeyboard(true, state, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), close);
    return <button type="button">Office control</button>;
  }
  try {
    await act(async () => root.render(<EditorHarness />));
    const button = office.querySelector("button")!;
    button.focus();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true, cancelable: true });
    await act(async () => button.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(shell).toHaveReturnedWith(false);
    const composer = document.createElement("textarea"); document.body.appendChild(composer);
    notePointerInside(true);
    const outside = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true, cancelable: true });
    composer.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener("keydown", shell);
    await act(async () => root.unmount());
  }
});

it("claims Escape from a Settings input inside the office shadow root", () => {
  const host = document.createElement("section"); host.dataset.testid = "pixel-office";
  const shadow = host.attachShadow({ mode: "open" });
  const office = document.createElement("div");
  const input = document.createElement("input"); office.appendChild(input); shadow.appendChild(office); document.body.appendChild(host);
  setOfficeKeyRoot(office);
  const close = vi.fn();
  const capture = (event: KeyboardEvent) => claimOfficeModalEscape(event, close);
  const shell = vi.fn((event: KeyboardEvent) => handleOfficeNavigation(event, true, vi.fn()));
  window.addEventListener("keydown", capture, true);
  window.addEventListener("keydown", shell);
  try {
    input.focus();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(shell).toHaveReturnedWith(false);
  } finally {
    window.removeEventListener("keydown", capture, true);
    window.removeEventListener("keydown", shell);
  }
});
