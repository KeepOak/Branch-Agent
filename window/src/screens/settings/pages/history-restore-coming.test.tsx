// @vitest-environment jsdom
// Settings › History & backups: Last backup is a working row (when the last copy was made and whether it worked), but
// it drew the preview's greyed Restore… at every level, a Coming control with no level gate. Like every Coming control,
// Restore… shows only at Technical (rows.ts COMING_FROM); below it the row keeps only the last-backup info.
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

const SCHEDULE = { mode: "git", push: true, remote: "https://github.com/you/branch-backups.git", target: "https://github.com/you/branch-backups.git", enabled: true, everyMs: 86_400_000 };
const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "branch.changes.list", "system.info",
  "backup.status", "backup.schedule.set", "backup.schedule.clear", "backup.run", "doctor.memory.status", "doctor.memory.dreamDiary", "agents.list"];
function engineStub() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "backup.status") return { schedules: [SCHEDULE], targets: [{ kind: "git", target: SCHEDULE.target, latest: { status: "ok", target: "abcdef0123456789", createdAt: Date.now() } }] };
    if (method === "branch.changes.list") return { entries: [] };
    if (method === "system.info") return { diskPath: "/srv/branch/data" };
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
const lastRow = () => host.querySelector<HTMLElement>('[data-row="history.backups.last"]');
const restores = (scope: Element | null) => [...(scope?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((b) => b.textContent?.trim() === "Restore…");
const REASON = "Restoring a copy comes in a later update.";

describe("Settings › History & backups: Last backup's Restore… is Coming, shown at Technical only", () => {
  it.each(["Regular", "Advanced"])("Last backup shows the last copy with no Restore… stub at %s", async (level) => {
    await mount(level);
    const row = lastRow();
    expect(row).toBeTruthy();
    expect(row!.textContent ?? "").toContain("Succeeded");
    expect(restores(row)).toHaveLength(0);
    expect(row!.querySelector("[data-coming]")).toBeNull();
    expect(host.textContent ?? "").not.toContain(REASON);
    expect(host.querySelector('[data-coming="' + REASON + '"]')).toBeNull();
  });

  it("at Technical Restore… shows greyed with its reason, as every Coming control", async () => {
    await mount("Technical");
    const row = lastRow();
    expect(row!.textContent ?? "").toContain("Succeeded");
    const [restore] = restores(row);
    expect(restore?.disabled).toBe(true);
    expect(restore?.getAttribute("data-coming")).toBe(REASON);
  });
});
