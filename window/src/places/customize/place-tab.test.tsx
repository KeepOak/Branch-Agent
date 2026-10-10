// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { CustomizePlace } from "./index";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });

async function mount(agents = [{ id: "main", name: "Main" }]) {
  const request = vi.fn((method: string) => Promise.resolve(method === "agents.list" ? { defaultId: "main", mainKey: "main", agents } : { plugins: [], skills: [], nodes: [] }));
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] };
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<CustomizePlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} level="regular" />); });
}
const selectedTab = () => host.querySelector('[aria-label="Customize"] [aria-selected="true"]')?.textContent;
const kind = () => host.querySelector('[data-kind][aria-current="true"]')?.getAttribute("data-kind");
const send = (place: string, tab: string) => act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place, tab } })); });

describe("branch:place-tab", () => {
  it("opens the named Customize tab, and Tools at a named kind", async () => {
    await mount();
    expect(selectedTab()).toBe("Trunks");
    await send("customize", "Chat apps");
    expect(selectedTab()).toBe("Chat apps");
    await send("customize", "Plugins");
    expect(selectedTab()).toBe("Tools");
    expect(kind()).toBe("Plugins");
    await send("customize", "Skills");
    expect(kind()).toBe("Skills");
  });
  it("ignores other places and unknown tabs", async () => {
    await mount();
    await send("library", "Channels");
    await send("customize", "Nowhere");
    expect(selectedTab()).toBe("Trunks");
  });
  it("hides the Trunks count at zero and shows it when Trunks exist", async () => {
    await mount([]);
    const tab = () => host.querySelector<HTMLButtonElement>('[aria-label="Customize"] [role="tab"]');
    expect(tab()?.hasAttribute("data-count")).toBe(false);
    expect(tab()?.getAttribute("aria-label")).toBeNull();
    await act(async () => root?.unmount()); root = null;
    await mount();
    expect(tab()?.getAttribute("data-count")).toBe("1");
    expect(tab()?.getAttribute("aria-label")).toBe("Trunks, 1");
  });
});
