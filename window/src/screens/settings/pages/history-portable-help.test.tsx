// @vitest-environment jsdom
// Settings › History & backups › Where your data lives, Technical help: it said "Portable mode (Developer) keeps them
// beside the program.", but nothing in Settings turns portable mode on. Developer › System draws Portable mode only as a
// greyed row, and neither the engine nor the Branch app has a portable data folder. The help now says only what the row
// offers. Regular and Advanced are unchanged.
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

describe("Settings › History & backups: Where your data lives names nothing Settings lacks", () => {
  it("at Technical the help says what Move… does and names no portable mode", async () => {
    await mount("Technical");
    const row = dataRow();
    expect(row).toBeTruthy();
    expect(helpOf(row)).toBe("Moves conversations, memory and settings together.");
    expect(row!.textContent ?? "").not.toMatch(/portable/i);
    expect(row!.querySelector("code")?.textContent).toBe(FOLDER);
  });

  it("at Advanced the help still says what the folder is", async () => {
    await mount("Advanced");
    const row = dataRow();
    expect(helpOf(row)).toBe("The folder on this computer that holds your conversations, memory and settings.");
    expect(host.textContent ?? "").not.toMatch(/portable/i);
  });

  it("at Regular the row still isn't shown", async () => {
    await mount("Regular");
    expect(dataRow()).toBeNull();
    expect(host.textContent ?? "").not.toMatch(/portable/i);
  });
});
