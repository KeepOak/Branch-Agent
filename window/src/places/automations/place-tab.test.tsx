// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { AutomationsPlace, tabFromEvent } from "./index";
vi.mock("../../face/Face", () => ({ Face: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
describe("branch:place-tab", () => {
  it("maps visible names and ids, and ignores other places", () => {
    expect(tabFromEvent({ place: "automations", tab: "Check-ins" })).toBe("checkins");
    expect(tabFromEvent({ place: "automations", tab: "board" })).toBe("board");
    expect(tabFromEvent({ place: "inbox", tab: "Board" })).toBeNull();
    expect(tabFromEvent({ place: "automations", tab: "Nope" })).toBeNull();
  });
  it("switches the open tab when the event names Automations", async () => {
    const engine = { request: vi.fn(async () => ({})) as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as WindowEngine;
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root!.render(<AutomationsPlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} level="regular" />); });
    await act(async () => { window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "automations", tab: "Board" } })); });
    expect(host.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Board");
    await act(async () => { window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "inbox", tab: "Triggers" } })); });
    expect(host.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Board");
  });
  it("moves between all five tabs with arrows, Home and End using one tab stop", async () => {
    const engine = { request: vi.fn(async () => ({})) as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as WindowEngine;
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root!.render(<AutomationsPlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} level="regular" />); });
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="Automations"] [role="tab"]')];
    expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    const key = async (tab: HTMLButtonElement, name: string) => act(async () => { tab.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });
    tabs[0].focus();
    await key(tabs[0], "ArrowLeft");
    expect(document.activeElement).toBe(tabs[4]);
    expect(tabs[4].getAttribute("aria-selected")).toBe("true");
    await key(tabs[4], "Home");
    await key(tabs[0], "ArrowRight");
    expect(document.activeElement).toBe(tabs[1]);
    await key(tabs[1], "End");
    expect(document.activeElement).toBe(tabs[4]);
    expect(tabs.map(tab => tab.tabIndex)).toEqual([-1, -1, -1, -1, 0]);
    await act(async () => { tabs[4].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true, bubbles: true })); });
    expect(document.activeElement).toBe(tabs[4]);
  });
});
