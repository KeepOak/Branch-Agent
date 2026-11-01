// @vitest-environment jsdom
// Settings › History & backups: Every change and Where your data lives are working rows (the list of changes, the
// folder Branch keeps its data in), but each drew a greyed Coming control and its "comes in a later update" line at
// every level (Roll back on each change, Move… beside the folder). Like every Coming control, those show at Technical
// only (rows.ts COMING_FROM); below it the rows keep only what works.
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
    if (method === "branch.changes.list") return { entries: [
      { id: "c1", source: "config-rpc", summary: "Changed the night window", at: Date.now(), kind: "config-write" },
      { id: "c2", source: "config-rpc", summary: "Changed the theme", at: Date.now(), kind: "config-write" },
    ] };
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
const rowOf = (id: string) => host.querySelector<HTMLElement>('[data-row="' + id + '"]');
const buttons = (scope: Element | null, text: string) => [...(scope?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((b) => b.textContent?.trim() === text);
const LATER = /in a later update/i;

describe("Settings › History & backups: Roll back and Move… are Coming, shown at Technical only", () => {
  it.each(["Regular", "Advanced"])("Every change lists the changes with no Roll back stub at %s", async (level) => {
    await mount(level);
    const row = rowOf("history.undo.changes");
    expect(row).toBeTruthy();
    expect(row!.textContent ?? "").toContain("Changed the night window");
    expect(buttons(row, "Roll back")).toHaveLength(0);
    expect(row!.querySelector("[data-coming]")).toBeNull();
    expect(row!.textContent ?? "").not.toMatch(LATER);
  });

  it("Where your data lives shows the folder with no Move… stub at Advanced", async () => {
    await mount("Advanced");
    const row = rowOf("history.copy.data");
    expect(row).toBeTruthy();
    expect(row!.querySelector("code")?.textContent).toBe(FOLDER);
    expect(buttons(row, "Move…")).toHaveLength(0);
    expect(row!.querySelector("[data-coming]")).toBeNull();
    expect(row!.textContent ?? "").not.toMatch(LATER);
  });

  it("no later-update line anywhere on the page at Regular comes from these two rows", async () => {
    await mount("Regular");
    expect(host.textContent ?? "").not.toContain("Rolling back a change comes in a later update.");
    expect(host.textContent ?? "").not.toContain("Moving your data folder comes in a later update.");
  });

  it("at Technical both stubs show greyed with their reason, as every Coming control", async () => {
    await mount("Technical");
    const changes = rowOf("history.undo.changes");
    const rollBacks = buttons(changes, "Roll back");
    expect(rollBacks).toHaveLength(2);
    for (const b of rollBacks) {
      expect(b.disabled).toBe(true);
      expect(b.getAttribute("data-coming")).toBe("Rolling back a change comes in a later update.");
    }
    expect(changes!.textContent ?? "").toContain("Rolling back a change comes in a later update. Until then, Import a saved settings file to go back.");
    const data = rowOf("history.copy.data");
    const [move] = buttons(data, "Move…");
    expect(move?.disabled).toBe(true);
    expect(move?.getAttribute("data-coming")).toBe("Moving your data folder comes in a later update.");
    expect(data!.textContent ?? "").toContain("Moving your data folder comes in a later update.");
  });
});
