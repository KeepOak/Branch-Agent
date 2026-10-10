// @vitest-environment jsdom
// UI audit DA-45: Library's tabs read Memory, Documents, Meetings and Activity; Activity holds what Trunks made and your day.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { LibraryPlace } from "./index";
vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const engine = { request: (async (method: string) => method === "agents.list" ? { defaultId: "a", agents: [{ id: "a" }] } : method === "agents.files.get" ? { file: { missing: true } } : {}) as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: [] } as WindowEngine;
async function mount() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<LibraryPlace engine={engine} level="regular" facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} openSettings={() => {}} />); });
  await settle();
}
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>("[role=tab]")];
async function press(el: HTMLElement | undefined) { expect(el).toBeTruthy(); await act(async () => { el!.click(); }); await settle(); }

describe("Library tabs (DA-45)", () => {
  it("names the tabs Memory, Documents, Meetings and Activity, with no Made for you or Logbook tab", async () => {
    await mount();
    expect(tabs().map(t => t.textContent)).toEqual(["Memory", "Documents", "Meetings", "Activity"]);
  });
  it("opens Activity on what Trunks made, and switches to your day", async () => {
    await mount();
    await press(tabs().find(t => t.textContent === "Activity"));
    const parts = [...host.querySelectorAll<HTMLButtonElement>("[role=radiogroup][aria-label=Activity] [role=radio]")];
    expect(parts.map(p => [p.textContent, p.getAttribute("aria-checked")])).toEqual([["Made by Trunks", "true"], ["Your day", "false"]]);
    expect(host.textContent).not.toContain("Your day, built from pictures of your screen.");
    await press(parts[1]);
    expect(parts[1].getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toContain("Your day, built from pictures of your screen.");
    expect(host.textContent).toContain("Logbook is off");
  });
});
