// @vitest-environment jsdom
// Settings › General draws the approved preview's cards and rows (#1049, section D General majors): preview.html PG
// general rendered at Regular, Advanced and Technical. Pinned shows only once a row is pinned; every other card is drawn,
// live or Coming, never hidden; the rows follow the preview's order and words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { forgetLookStore } from "../../../places/settings/set1/appearance-store";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(look: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string, _params: Record<string, unknown> = {}) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.patch") return { ok: true };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: { "ui.window.look": look } };
    if (method === "users.prefs.set") return { status: "ok" };
    if (method === "projects.list") return { projects: [{ id: "p1", displayName: "Hartwell" }] };
    if (method === "sessions.list") return { totalCount: 3, sessions: [] };
    if (method === "models.list") return { models: [{ provider: "openai", id: "gpt-mini", name: "GPT Mini" }] };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"] } as unknown as WindowEngine, request };
}
async function mount(engine: WindowEngine, level: "regular" | "advanced" | "technical", onPage?: (page: string) => void) {
  localStorage.setItem("branch.level", level);
  await act(async () => root.render(<SettingsFrame engine={engine} page="general" pages={R1_PAGES} onPage={onPage} />));
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const remount = async () => { await act(async () => root.unmount()); root = createRoot(host); forgetLookStore(); };
const cards = () => [...host.querySelectorAll<HTMLElement>(".r1s-sec")].map((s) => s.querySelector(":scope > h2")?.textContent ?? "");
const labels = (card: string) => [...host.querySelectorAll<HTMLElement>(`.r1s-sec[aria-label="${card}"] .r1s-row > b`)].map((b) => b.textContent);

it("draws the preview's General cards at each level, and Pinned only once a row is pinned", async () => {
  const { engine } = engineOf();
  await mount(engine, "regular");
  expect(cards()).toEqual(["Show agents’ work", "Starting up", "Projects", "Keyboard", "Writing", "Cover the screen"]);
  await remount();
  await mount(engine, "advanced");
  expect(cards()).toEqual(["Show agents’ work", "Starting up", "Projects", "Keyboard", "Writing", "The conversation", "Summaries of older turns", "Clipboard history", "Quick ask", "Controllers", "Cover the screen"]);
  await remount();
  await mount(engine, "technical");
  expect(cards()).toEqual(["Show agents’ work", "Starting up", "Projects", "Keyboard", "Writing", "The conversation", "Summaries of older turns", "History repair", "Waiting line", "Clipboard history", "Quick ask", "Controllers", "Cover the screen"]);
  await remount();
  await mount(engineOf({ pins: [["appearance", "Theme", 0]] }).engine, "regular");
  expect(cards()[0]).toBe("Pinned");
  expect(host.querySelector('.r1s-sec[aria-label="Pinned"]')!.textContent).toContain("Theme");
});

it("uses the preview's rows and words in Writing, The conversation, Summaries, History repair and Waiting line", async () => {
  await mount(engineOf().engine, "regular");
  // Regular shows only what works today; Writing's other Regular rows wait for a later update and show from Advanced.
  expect(labels("Writing")).toEqual(["Show “Finish setting up”"]);
  await remount();
  await mount(engineOf().engine, "advanced");
  // The live row comes first; the later-update rows fold under their own line after it, in the table order.
  expect(labels("Writing").slice(0, 8)).toEqual(["Show “Finish setting up”", "Message box grows with the text", "Check spelling in the message box", "Suggest the rest as I type", "Add my location to messages", "Replies in", "After a plan", "Open Branch on"]);
  await remount();
  await mount(engineOf().engine, "regular");
  expect(labels("Show agents’ work")).toEqual(["Show agents’ work as"]);
  await remount();
  await mount(engineOf().engine, "technical");
  expect(labels("The conversation")).toEqual(["Vim keys in the message box", "Message times", "When you send while it works", "Send with", "Ask before deleting a conversation", "All conversations", "Open past sessions in"]);
  expect(labels("Summaries of older turns")).toEqual(["Summarise older turns by themselves", "Always keep the latest", "Model for summaries", "How it summarises",
    "Summary time limit", "Keep names and numbers exact", "Trim old tool results", "Trim after", "Summarise when the room left is under", "Room to plan for", "How to write the summary", "If a summary can’t be made", "Keep the originals of what it summarises", "A receipt for each thing left out"]);
  expect(labels("History repair")).toEqual(["Check the history now", "Repair the history before each call"]);
  expect(labels("Waiting line")).toEqual(["Wait before sending what’s in line", "Most messages in line", "When the line is full"]);
  expect(labels("Quick ask")).toEqual(["Quick ask shortcut", "Quick ask from anywhere"]);
  expect(labels("Cover the screen")).toEqual(["Cover now"]);
});

it("keeps Classic General's working controls: projects, Keyboard shortcuts and the model for summaries", async () => {
  const { engine, request } = engineOf();
  await mount(engine, "advanced");
  const projects = host.querySelector<HTMLElement>('.r1s-sec[aria-label="Projects"]')!;
  expect(projects.textContent).toContain("Hartwell");
  expect(projects.textContent).toContain("3 conversations");
  expect(host.querySelector('[data-row="general.keyboard.shortcuts"] button')!.textContent).toBe("Show all");
  const model = host.querySelector<HTMLSelectElement>('[data-row="general.summaries.model"] select')!;
  expect([...model.options].map((o) => o.textContent)).toEqual(["The conversation’s model", "GPT Mini"]);
  await act(async () => { model.value = "openai/gpt-mini"; model.dispatchEvent(new Event("change", { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
  const patch = request.mock.calls.find(([m]) => m === "config.patch")!;
  expect(JSON.parse(String((patch[1] as { raw: string }).raw))).toEqual({ agents: { defaults: { compaction: { model: "openai/gpt-mini" } } } });
});

it("opens a pinned row's page and unpins it", async () => {
  const onPage = vi.fn();
  const { engine } = engineOf({ pins: [["appearance", "Theme", 0]] });
  await mount(engine, "regular", onPage);
  const pinned = host.querySelector<HTMLElement>('.r1s-sec[aria-label="Pinned"]')!;
  await act(async () => { [...pinned.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Go to it")!.click(); });
  expect(onPage).toHaveBeenCalledWith("appearance");
  await act(async () => { [...pinned.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Unpin")!.click(); await new Promise((r) => setTimeout(r, 0)); });
  expect(cards()).not.toContain("Pinned");
});
