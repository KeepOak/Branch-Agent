// @vitest-environment jsdom
// Settings › History & backups › Where your data lives: below Technical the row shows only the folder (Move… is Coming
// and shows from Technical up, rows.ts COMING_FROM), but its help still said "Moves conversations, memory and settings
// together.", describing a control the person can't see. Below Technical the help now says what the folder is; the
// help about moving shows with Move… at Technical, unchanged.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));

const FOLDER = "/srv/branch/data";
const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "branch.changes.list", "system.info",
  "backup.status", "backup.schedule.set", "backup.schedule.clear", "backup.run", "doctor.memory.status", "doctor.memory.dreamDiary", "agents.list"];
function engineStub() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "branch.changes.list") return { entries: [] };
    if (method === "system.info") return { diskPath: FOLDER };
    if (method === "agents.list") return { agents: [] };
    return { ok: true };
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
}
async function mount(level: string) {
  await act(async () => root.render(<SettingsFrame engine={engineStub()} page="history" pages={R1_PAGES} />));
  await settle();
  await setLevel(level);
}
const dataRow = () => host.querySelector<HTMLElement>('[data-row="history.copy.data"]');
const helpOf = (row: HTMLElement | null) => row?.querySelector(":scope > small")?.textContent ?? "";
const MOVING = /\bmov(e|es|ing)\b/i;
const MOVE_HELP = "Moves conversations, memory and settings together. Portable mode (Developer) keeps them beside the program.";

describe("Settings › History & backups: Where your data lives says what it shows", () => {
  it("at Advanced the row shows the folder and its help says what the folder is, never moving", async () => {
    await mount("Advanced");
    const row = dataRow();
    expect(row).toBeTruthy();
    expect(row!.querySelector("code")?.textContent).toBe(FOLDER);
    expect(helpOf(row)).toBe("The folder on this computer that holds your conversations, memory and settings.");
    expect(row!.textContent ?? "").not.toMatch(MOVING);
  });

  it("at Regular the row isn't shown, so nothing on the page talks about moving the data", async () => {
    await mount("Regular");
    expect(dataRow()).toBeNull();
    expect(host.textContent ?? "").not.toContain("Moves conversations, memory and settings together.");
  });

  it("at Technical the help about moving shows with Move…, unchanged", async () => {
    await mount("Technical");
    const row = dataRow();
    expect(helpOf(row)).toBe(MOVE_HELP);
    const move = [...(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent?.trim() === "Move…");
    expect(move?.disabled).toBe(true);
    expect(row!.querySelector("code")?.textContent).toBe(FOLDER);
  });
});
