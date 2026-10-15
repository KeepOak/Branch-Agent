// @vitest-environment jsdom
// Parity row 16: the Classic "What Branch can do" list (shell/CanDo.tsx) as a "What it can do" section on each Trunk's page.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { loadDraft, safeStorage } from "../../composer/drafts";
import type { WindowEngine } from "../../connect/engine";
import { TrunkHost } from "../../places-nav/TrunkHost";
import { CAN_DO } from "../../shell/CanDo";
import { TrunkProfile } from "./TrunkProfile";

vi.mock("../../face/Face", () => ({ Face: ({ label, size }: { label?: string; size: number }) => <span role="img" aria-label={label} data-face-size={size} /> }));
vi.mock("../../face/CharacterFace", () => ({ CharacterFace: ({ label, size }: { label?: string; size: number }) => <span role="img" aria-label={label} data-character-size={size} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; localStorage.clear(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function mount(node: React.ReactNode) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(node); });
  await flush();
}
const ROSTER = { defaultId: "oak", mainKey: "main", agents: [{ id: "oak", identity: { name: "Oak" } }, { id: "birch", identity: { name: "Birch", theme: "Reads" } }] };
const request = vi.fn((method: string) => Promise.resolve(method === "agents.list" ? ROSTER : method === "config.get" ? { hash: "h", valid: true, config: {} } : method === "sessions.list" ? { sessions: [] } : {}));
const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as unknown as WindowEngine;
const section = () => document.querySelector<HTMLElement>('[aria-label="What it can do"]')!;
const pick = (title: string) => [...section().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.querySelector("b")?.textContent === title)!;
async function click(el: HTMLElement) { await act(async () => { el.click(); }); await flush(); }

it("draws the Classic list as a What it can do section on the Trunk's page, with no separate dialog", async () => {
  await mount(<TrunkProfile engine={engine} agentId="birch" level="regular" onClose={() => {}} openPlace={vi.fn()} openSettings={vi.fn()} openConversation={vi.fn()} />);
  expect(section().querySelector("h3")?.textContent).toBe("What it can do");
  expect([...section().querySelectorAll("button b")].map((b) => b.textContent)).toEqual(CAN_DO.map(([title]) => title));
  expect(pick("Sort a messy folder").textContent).toContain("Tidy Downloads without deleting anything");
  expect(document.querySelector('[data-testid="can-do"]')).toBeNull();
});

it("an ask opens this Trunk's own conversation with the words waiting in its message box, unsent", async () => {
  const openConversation = vi.fn();
  await mount(<TrunkHost engine={engine} level="regular" openPlace={vi.fn()} openSettings={vi.fn()} openConversation={openConversation} />);
  await act(async () => { window.dispatchEvent(new CustomEvent("branch:open-trunk", { detail: { agentId: "birch", view: "profile" } })); });
  await flush();
  await click(pick("Sort a messy folder"));
  expect(openConversation).toHaveBeenCalledWith("agent:birch:main");
  expect(loadDraft(safeStorage(), "agent:birch:main")).toBe("Tidy my Downloads folder. Don't delete anything.");
  expect(request.mock.calls.map(([method]) => method)).not.toContain("chat.send");
  expect(document.querySelector('[data-testid="trunk-profile"]')).toBeNull();
});

it("place and Settings rows open where they happen, and Work from your phone opens pairing over the page", async () => {
  const openPlace = vi.fn(), openSettings = vi.fn(), onClose = vi.fn();
  await mount(<TrunkProfile engine={engine} agentId="birch" level="regular" onClose={onClose} openPlace={openPlace} openSettings={openSettings} openConversation={vi.fn()} />);
  await click(pick("Run on a schedule"));
  expect(openPlace).toHaveBeenCalledWith("automations");
  await click(pick("Talk"));
  expect(openSettings).toHaveBeenCalledWith("voice");
  expect(onClose).toHaveBeenCalledTimes(2);
  await click(pick("Work from your phone"));
  expect(document.querySelector('[data-testid="pair"]')).toBeTruthy();
});

it("a row whose destination this window can't open is disabled, not a dead button", async () => {
  await mount(<TrunkProfile engine={engine} agentId="birch" level="regular" onClose={() => {}} />);
  expect(pick("Read and answer mail").disabled).toBe(true);
  expect(pick("Remember").disabled).toBe(true);
  expect(pick("Work from your phone").disabled).toBe(false);
});
