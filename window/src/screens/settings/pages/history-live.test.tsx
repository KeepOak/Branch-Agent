// @vitest-environment jsdom
// Settings › History & backups in R1 (#1049 section D): a native R1 page in the R1 Settings frame, with the approved
// preview's cards in its order (preview.html PG history), its rows and its Learn more sheet, not the Classic Backups
// page in a wrapper. Every working Classic control lands live on its row and sends the call Classic sends.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { undeclaredControls } from "../../../glass/coming-registry";
import { PAGES } from "../nav";
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

/** The approved preview's History & backups page (preview.html PG history), card by card, with its Regular rows. */
const PREVIEW_CARDS = ["Backups", "Snapshots", "Roll back, see the change, undo", "A copy of your setup"];
/** Rows the page adds to a card beyond the preview's own: Classic's working Back up now and its last result, and Restore,
 *  which stands for the preview's list of copies with Restore… until the engine can restore one. */
const EXTRA_REGULAR: Record<string, string[]> = { Backups: ["Back up now", "Last backup", "Restore a copy"] };
const PREVIEW_REGULAR: Record<string, string[]> = {
  Backups: ["Back up on a schedule", "How often", "Where"],
  Snapshots: ["Tidy memory overnight", "Night window", "Rings diary"],
  // Never dies, then Every change with its Roll back (preview: self Never dies and Every change).
  "Roll back, see the change, undo": ["If the engine stops", "If it keeps crashing", "Interrupted work", "Last good settings", "Every change", "Roll back a change"],
  "A copy of your setup": ["Export a copy without secrets"],
};

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "backup.status", "backup.schedule.set",
  "backup.schedule.clear", "backup.run", "doctor.memory.status", "doctor.memory.dreamDiary", "doctor.memory.backfillDreamDiary", "doctor.memory.resetDreamDiary",
  "doctor.memory.dedupeDreamDiary", "doctor.memory.repairRingsArtifacts", "memory.sessionBackfill.preview", "memory.sessionBackfill.apply", "memory.sessionBackfill.rollback",
  "branch.changes.list", "system.info"];
const SCHEDULE = { mode: "git", push: true, remote: "https://github.com/me/backups.git", target: "https://github.com/me/backups.git", enabled: true, everyMs: 86_400_000 };
function engineOf() {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: { plugins: { entries: { "memory-core": { config: { rings: { enabled: true, frequency: "0 3 * * *" } } } } } } };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "backup.status") return { schedules: [SCHEDULE], targets: [{ kind: "git", target: SCHEDULE.target, latest: { status: "ok", target: "abcdef0123456789", createdAt: Date.now() } }] };
    if (method === "backup.run") return { started: true };
    if (method === "doctor.memory.status") return { rings: { shortTermCount: 2, promotedToday: 1, promotedTotal: 9 } };
    if (method === "doctor.memory.dedupeDreamDiary") return { removedEntries: 3 };
    if (method === "branch.changes.list") return { entries: [{ id: "c1", source: "config-rpc", summary: "Changed the night window", at: Date.now(), kind: "config-write" }] };
    if (method === "system.info") return { diskPath: "/data/branch" };
    return { ok: true };
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const button = (scope: ParentNode | null, text: string) => [...(scope ?? document).querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
const row = (id: string) => host.querySelector<HTMLElement>(`[data-row="${id}"]`);
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));
async function mount() {
  const env = engineOf();
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="history" pages={R1_PAGES} />));
  await settle();
  return env;
}
const sections = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")];
const labels = (sec: HTMLElement) => [...sec.querySelectorAll<HTMLElement>(".r1s-row > b")].map((b) => b.textContent);

describe("R1 Settings › History & backups is a native R1 page with the preview's cards", () => {
  it("draws the preview's four cards in order, each with its Regular rows, under the frame's title, lede and Learn more", async () => {
    expect(PAGES.history.cards).toEqual(PREVIEW_CARDS);
    expect(R1_PAGES.history?.component).toBeUndefined();
    await mount();
    expect(host.querySelector(".r1s-custom, .r1s-classic, [data-classic]")).toBeNull();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("History & backups");
    expect(host.querySelector(".r1s-lede")?.textContent).toContain(PAGES.history.lede);
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(PREVIEW_CARDS);
    for (const sec of sections()) {
      const card = sec.getAttribute("aria-label") ?? "";
      expect(labels(sec).filter((l) => !(EXTRA_REGULAR[card] ?? []).includes(l ?? "")), card).toEqual(PREVIEW_REGULAR[card]);
      expect(labels(sec).filter((l) => (EXTRA_REGULAR[card] ?? []).includes(l ?? "")), card).toEqual(EXTRA_REGULAR[card] ?? []);
    }
    expect(host.textContent).not.toContain("comes to this page in a later update");
    await click(button(host, "Learn more"));
    expect([...host.querySelectorAll(".r1s-help li")].map((li) => li.textContent)).toEqual(PREVIEW_CARDS);
  });

  it("adds the preview's Advanced and Technical rows inside the same cards", async () => {
    await mount();
    await setLevel("Advanced");
    const copy = sections().find((s) => s.getAttribute("aria-label") === "A copy of your setup")!;
    expect(labels(copy)).toEqual(["Export a copy without secrets", "Export", "Import", "From a preset address", "Where conversations are stored", "Where files are kept", "Where your data lives", "Put Branch on a USB stick"]);
    const snaps = sections().find((s) => s.getAttribute("aria-label") === "Snapshots")!;
    expect(labels(snaps)).toEqual(["Tidy memory overnight", "Night window", "Rings diary", "Keep notes for good now", "Try a night without keeping anything", "Fill in from past conversations"]);
    await setLevel("Technical");
    expect(labels(sections().find((s) => s.getAttribute("aria-label") === "Snapshots")!)).toContain("Repair Rings’ files");
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(PREVIEW_CARDS);
  });

  it("keeps every working Classic control live, declared, and on Classic's engine calls", async () => {
    const { request } = await mount();
    await setLevel("Technical");
    for (const id of Object.keys(R1_PAGES.history?.controls ?? {})) expect(row(id), id).not.toBeNull();
    expect(undeclaredControls(host)).toEqual([]);
    await click(button(row("history.backups.now"), "Back up now"));
    expect(request.mock.calls.some(([m]) => m === "backup.run")).toBe(true);
    expect(row("history.backups.now")?.textContent).toContain("Backing up…");
    expect(row("history.backups.last")?.textContent).toContain("Succeeded");
    await click(button(row("history.backups.often"), "Every week"));
    expect(request.mock.calls.filter(([m]) => m === "backup.schedule.set").at(-1)?.[1]).toMatchObject({ everyMs: 7 * 86_400_000, enabled: true, destination: { kind: "git", url: SCHEDULE.remote } });
    await click(button(row("history.snapshots.dedupe"), "Remove repeats"));
    expect(row("history.snapshots.dedupe")?.textContent).toContain("Removed 3 repeats.");
    expect(row("history.undo.changes")?.textContent).toContain("Settings: Changed the night window");
    expect(row("history.copy.data")?.textContent).toContain("/data/branch");
  });
});
