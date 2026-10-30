// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { AutomationsPlace, tabFromEvent } from "./index";
vi.mock("../../face/Face", () => ({ Face: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
const engine = () => ({ request: vi.fn(async () => ({})) as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] }) as WindowEngine;
async function mount() {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<AutomationsPlace engine={engine()} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} level="regular" />); });
  return host;
}
const tabs = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="Automations"] [role="tab"]')];
const selected = (host: HTMLElement) => host.querySelector("[role=tab][aria-selected=true]")?.textContent ?? null;
const moreButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".au-more-tab")!;
const send = async (place: string, tab: string) => act(async () => { window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place, tab } })); });

describe("Automations tabs (DA-39)", () => {
  it("shows three plain tabs first, and keeps Saved prompts and Board out of the first view", async () => {
    const host = await mount();
    expect(tabs(host).map(tab => tab.textContent)).toEqual(["Repeats", "When something happens", "Reminders"]);
    expect(selected(host)).toBe("Repeats");
    const words = host.querySelector(".au-tabs")!.textContent ?? "";
    for (const jargon of ["Scheduled", "Procedures", "Triggers", "Check-ins", "Board"]) expect(words).not.toContain(jargon);
    expect(host.textContent).not.toContain("Reminders, alarms and to-dos");
  });
  it("puts reminders and check-ins under Reminders", async () => {
    const host = await mount();
    await act(async () => tabs(host)[2].click());
    expect(selected(host)).toBe("Reminders");
    expect(host.textContent).toContain("Reminders, alarms and to-dos");
    expect(host.textContent).toContain("Check in on its own");
  });
  it("opens Saved prompts and Board from More, with no developer note showing", async () => {
    const host = await mount();
    await act(async () => moreButton(host).click());
    const items = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="au-more-menu"] button')];
    expect(items.map(item => item.textContent?.trim())).toEqual(["Saved prompts", "Board"]);
    await act(async () => items[0].click());
    expect(moreButton(host).textContent?.trim()).toBe("Saved prompts");
    expect(selected(host)).toBeNull();
    expect(host.textContent).toContain("Your saved prompts");
    expect(visibleDevNotes(host)).toEqual([]);
    await act(async () => moreButton(host).click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="au-more-menu"] button')][1].click());
    expect(moreButton(host).textContent?.trim()).toBe("Board");
    expect(visibleDevNotes(host)).toEqual([]);
    expect(tabs(host).map(tab => tab.tabIndex)).toEqual([0, -1, -1]);
  });
});

describe("branch:place-tab", () => {
  it("maps visible names, ids and earlier names, and ignores other places", () => {
    expect(tabFromEvent({ place: "automations", tab: "When something happens" })).toBe("triggers");
    expect(tabFromEvent({ place: "automations", tab: "Check-ins" })).toBe("reminders");
    expect(tabFromEvent({ place: "automations", tab: "scheduled" })).toBe("repeats");
    expect(tabFromEvent({ place: "automations", tab: "Procedures" })).toBe("procedures");
    expect(tabFromEvent({ place: "automations", tab: "board" })).toBe("board");
    expect(tabFromEvent({ place: "inbox", tab: "Board" })).toBeNull();
    expect(tabFromEvent({ place: "automations", tab: "Nope" })).toBeNull();
  });
  it("switches the open view when the event names Automations", async () => {
    const host = await mount();
    await send("automations", "Triggers");
    expect(selected(host)).toBe("When something happens");
    await send("automations", "Board");
    expect(moreButton(host).textContent?.trim()).toBe("Board");
    await send("inbox", "Reminders");
    expect(moreButton(host).textContent?.trim()).toBe("Board");
  });
  it("moves between the three tabs with arrows, Home and End using one tab stop", async () => {
    const host = await mount();
    const all = tabs(host);
    expect(all.map(tab => tab.tabIndex)).toEqual([0, -1, -1]);
    const key = async (tab: HTMLButtonElement, name: string) => act(async () => { tab.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });
    all[0].focus();
    await key(all[0], "ArrowLeft");
    expect(document.activeElement).toBe(all[2]);
    expect(all[2].getAttribute("aria-selected")).toBe("true");
    await key(all[2], "Home");
    await key(all[0], "ArrowRight");
    expect(document.activeElement).toBe(all[1]);
    await key(all[1], "End");
    expect(document.activeElement).toBe(all[2]);
    expect(all.map(tab => tab.tabIndex)).toEqual([-1, -1, 0]);
    await act(async () => { all[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true, bubbles: true })); });
    expect(document.activeElement).toBe(all[2]);
  });
});
