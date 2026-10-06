// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { OfficePlace } from "./index";
import { handleOfficeNavigation } from "./navigation";

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

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

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
