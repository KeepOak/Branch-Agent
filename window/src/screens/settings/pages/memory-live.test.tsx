// @vitest-environment jsdom
// Settings › Memory & documents is a native R1 page (#1049, section D blockers 1 and 2): it never hands the window to
// Classic Settings or Classic Advanced, and it draws the approved preview's cards in the preview's order at each level
// (preview.html PG memory, rendered at Regular, Advanced and Technical: nothing at Regular but "These settings show at
// Advanced", then Memory, Recall and memory files, Documents it reads and Library), with the preview's row words. Regular
// and Advanced show only what works today (Private #1093 item 4), so the rows that wait for a later update show from
// Technical, after the working ones.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { forgetLookStore } from "../../../places/settings/set1/appearance-store";
import { CLASSIC_PAGE, r1SettingsPage, resolveRoute } from "../../frame/R1Window";
import { PAGES } from "../nav";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(config: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "config.get") return { hash: "h1", valid: true, config };
    if (method === "config.patch") return { ok: true };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "plugins.list") return { plugins: [] };
    if (method === "doctor.memory.status") return params.probe ? { provider: "local", embedding: { ok: true } } : { provider: "local", embedding: { checked: false } };
    if (method === "agents.list") return { agents: [{ id: "main" }], defaultId: "main" };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"] } as unknown as WindowEngine, request };
}
async function mount(engine: WindowEngine, level: "regular" | "advanced" | "technical", onPage?: (page: string) => void) {
  localStorage.setItem("branch.level", level);
  await act(async () => root.render(<SettingsFrame engine={engine} page="memory" pages={R1_PAGES} onPage={onPage} />));
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const remount = async () => { await act(async () => root.unmount()); root = createRoot(host); forgetLookStore(); };
const cards = () => [...host.querySelectorAll<HTMLElement>(".r1s-sec")].map((s) => s.querySelector(":scope > h2")?.textContent ?? "");
const labels = (card: string) => [...host.querySelectorAll<HTMLElement>(`.r1s-sec[aria-label="${card}"] .r1s-row > b`)].map((b) => b.textContent);
const ADVANCED_MEMORY = ["How much memory loads at the start", "All start files together", "Match by meaning", "Meaning search", "Meaning search uses",
  "Recall before replying", "Memory wiki", "Tidy by meaning each night"];
const LATER_MEMORY = ["Share memory between Trunks", "Ask before remembering", "Outside memory", "Keep a history in Git", "Project notes as files",
  "Follow-ups made whole", "Scratch space for pasted text", "Knowledge cards", "Notes it keeps for itself"];
const TECH_MEMORY = ["Search memory", "Also search past conversations", "Keep search results ready", "Index in batches", "Pictures and audio in extra folders",
  "Extra folders to search", "Show where a memory came from", "Every memory setting"];
const ADVANCED_RECALL = ["Save notes before tidying a conversation", "Learn from other coding agents’ history on this computer"];
const DOCS = ["Search documents by", "Re-order the best passages", "How documents reach a Trunk", "A file you attach", "Read text in scans and pictures",
  "Keep links from messages", "Read long documents by their contents page", "Index code folders", "Read files with", "Split documents at",
  "Describe each passage before indexing", "Follow links between passages", "Where the index lives", "Database server address"];

it("is an R1 Settings page, never Classic Advanced or the Library place", () => {
  expect(r1SettingsPage("memory", R1_PAGES)).toBe(true);
  expect(CLASSIC_PAGE.memory).toBeUndefined();
  expect(resolveRoute({ kind: "settings", page: "memory" })).toEqual({ kind: "settings", page: "memory" });
  expect(PAGES.memory.cards).toEqual(["Memory", "Recall and memory files", "Documents it reads", "Library"]);
});

it("draws the preview's cards: none at Regular, the working Memory rows at Advanced, every row at Technical", async () => {
  const { engine } = engineOf();
  await mount(engine, "regular");
  expect(cards()).toEqual([]);
  expect(host.querySelector(".r1s-empty")?.textContent).toContain("These settings show at Advanced.");
  await remount();
  await mount(engine, "advanced");
  expect(cards()).toEqual(["Memory", "Recall and memory files", "Library"]);
  expect(labels("Memory")).toEqual(ADVANCED_MEMORY);
  expect(labels("Recall and memory files")).toEqual(ADVANCED_RECALL);
  expect(labels("Library")).toEqual(["Rewrite short notes"]);
  await remount();
  await mount(engine, "technical");
  expect(cards()).toEqual(["Memory", "Recall and memory files", "Documents it reads", "Library"]);
  expect(labels("Memory")).toEqual([...ADVANCED_MEMORY.slice(0, 5), "Memory engine", ...ADVANCED_MEMORY.slice(5), ...TECH_MEMORY, ...LATER_MEMORY]);
  expect(labels("Recall and memory files")).toEqual([...ADVANCED_RECALL, "Bring up what it remembers, mid-task", "Helpers and side conversations may",
    "Notes about this computer", "Keep notes about this computer", "Rings’ own instructions for this workspace",
    "Prefer recent notes", "Vary the results", "Pick up edits to memory files", "Score memories by whether they helped", "Also copy the history to"]);
  expect(labels("Documents it reads")).toEqual(DOCS);
  expect(labels("Library")).toEqual(["Rewrite short notes", "Search documents by meaning", "A local index of mail, calendar and messages", "Keep versions of what Trunks make"]);
});

it("keeps Classic's working memory controls: Test, past conversations and Last night", async () => {
  const onPage = vi.fn();
  const { engine, request } = engineOf({ memory: { search: { sources: ["memory"] } } });
  await mount(engine, "technical", onPage);
  const check = host.querySelector<HTMLElement>('[data-row="memory.memory.meaning-check"]')!;
  expect(check.textContent).toContain("Not checked yet");
  await act(async () => { [...check.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Test")!.click(); await new Promise((r) => setTimeout(r, 0)); });
  expect(request).toHaveBeenCalledWith("doctor.memory.status", { probe: true });
  expect(check.textContent).toContain("Working");
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-row="memory.memory.sessions"] [role=switch]')!.click(); await new Promise((r) => setTimeout(r, 0)); });
  const patch = request.mock.calls.find(([m]) => m === "config.patch")!;
  expect(JSON.parse(String((patch[1] as { raw: string }).raw))).toEqual({ memory: { search: { sources: ["memory", "sessions"] } } });
  await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('[data-row="memory.memory.tidy"] button')].find((b) => b.textContent === "Last night")!.click(); });
  expect(onPage).toHaveBeenCalledWith("history");
});
