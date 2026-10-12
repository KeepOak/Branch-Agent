// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { NewTrunkPreview } from "./NewTrunkPreview";
import { TrunkEditor } from "./TrunkEditor";
import { createTrunk } from "./api";
import { readRoster } from "./model";

vi.mock("../../face/Face", () => ({ Face: () => <span role="img" /> }));
vi.mock("../../face/CharacterFace", () => ({ CharacterFace: ({ label, size }: { label: string; size: number }) => <span role="img" aria-label={label} data-size={size} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; localStorage.clear(); });
async function mount(node: React.ReactNode) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root!.render(node)); await act(async () => new Promise((resolve) => setTimeout(resolve, 0))); }
async function click(el: Element | null) { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()); await act(async () => new Promise((resolve) => setTimeout(resolve, 0))); }
const button = (text: string) => [...document.querySelectorAll("button")].find((el) => el.textContent === text) ?? null;
const roster = readRoster({ defaultId: "tk", agents: [{ id: "tk", identity: { name: "TK" } }, { id: "ash", identity: { name: "Ash", avatar: "branch:bolt" } }] });

it("previews an unused character and nature name, then Random name changes both before create", async () => {
  const confirm = vi.fn();
  await mount(<NewTrunkPreview roster={roster} onClose={() => {}} onConfirm={confirm} />);
  const before = { name: document.querySelector<HTMLInputElement>("input")!.value, face: document.querySelector("[data-testid='new-trunk-preview'] img")?.getAttribute("src") ?? "" };
  expect(before.name).not.toBe("Ash");
  expect(document.querySelector('[data-size="84"]')).not.toBeNull();
  await click(button("Random name"));
  const after = document.querySelector<HTMLInputElement>("input")!.value;
  expect(after).not.toBe(before.name);
  await click(button("Create Trunk"));
  const choice = confirm.mock.calls[0][0] as { name: string; avatar: string };
  expect(choice.name).toBe(after);
  expect(choice.avatar).toMatch(/^branch:/);
  expect(choice.avatar).not.toBe("branch:bolt");
  const request = vi.fn(async () => ({ ok: true, agentId: "elm" }));
  await createTrunk({ request } as unknown as WindowEngine, choice.name, choice.avatar);
  expect(request).toHaveBeenCalledWith("agents.create", choice);
});

it("labels the name randomizer and the create action plainly instead of Shuffle / Make Trunk (DA-58)", async () => {
  await mount(<NewTrunkPreview roster={roster} onClose={() => {}} onConfirm={() => {}} />);
  const dialog = document.querySelector("[data-testid='new-trunk-preview']")!;
  const labels = [...dialog.querySelectorAll("button")].map((el) => el.textContent);
  expect(labels).not.toContain("Shuffle");
  expect(labels).not.toContain("Make Trunk");
  const random = button("Random name")!;
  expect(random.querySelector("svg.icon")).not.toBeNull();
  expect(random.title).toBe("Pick a different name and look");
  expect(button("Create Trunk")!.classList.contains("pri")).toBe(true);
  await act(async () => root!.unmount()); root = null; document.body.innerHTML = "";
  await mount(<NewTrunkPreview roster={roster} fixedName="Inbox Manager" busy onClose={() => {}} onConfirm={() => {}} />);
  expect(button("Random look")?.querySelector("svg.icon")).not.toBeNull();
  expect(button("Creating…")?.disabled).toBe(true);
});

it("enables and saves Colour, Shape and Eyes; Shuffle changes a character and a pebble", async () => {
  const request = vi.fn(async (method: string, _params?: unknown) => method === "agents.list" ? { defaultId: "tk", agents: [
    { id: "tk", identity: { name: "TK" } }, { id: "ash", identity: { name: "Ash", avatar: "branch:bolt" } },
  ] } : method === "config.get" ? { hash: "h1", valid: true, config: { agents: { entries: { ash: {} } } } } : method === "models.list" ? { models: [] } : method === "node.list" ? { nodes: [] } : { ok: true });
  await mount(<TrunkEditor engine={{ request, scopes: ["operator.admin"] } as unknown as WindowEngine} agentId="ash" level="regular" onClose={() => {}} />);
  await click(button("Shuffle"));
  expect(document.querySelector('[aria-pressed="true"].tk-look')?.getAttribute("aria-label")).not.toBe("Bolt");
  await click(document.querySelector('[aria-label="Classic pebble"]'));
  await click(document.querySelector('[aria-label="Colour #1785AF"]'));
  await click(document.querySelector('[aria-label="Stone"]'));
  await click(button("Wide"));
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Stone"]')?.disabled).toBe(false);
  await click(button("Save"));
  expect(request.mock.calls.some(([method, params]) => { const look = params as Record<string, unknown> | undefined; return method === "agents.update" && Boolean(look?.colour && look.shape && look.eyes); })).toBe(true);
  const selected = () => [...document.querySelectorAll<HTMLButtonElement>(".tk-swatch[aria-pressed='true'],.tk-shape[aria-pressed='true'],.tk-seg button[aria-pressed='true']")].map((el) => el.getAttribute("aria-label") || el.textContent).join("|");
  const before = selected();
  await click(button("Shuffle"));
  expect(selected()).not.toBe(before);
});
