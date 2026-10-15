// @vitest-environment jsdom
// Settings › Learning & self-updates in R1 (#1049 section D): a native R1 page in the R1 Settings frame, with the
// approved preview's cards in its order (preview.html PG learning), its rows and its Learn more sheet, not Classic About
// Branch and Seasons in a wrapper. Every working Classic control lands live on its row and sends the call Classic sends.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { undeclaredControls } from "../../../glass/coming-registry";
import { PAGES, pageFor } from "../nav";
import { SettingsFrame } from "../SettingsFrame";
import { LEARNING_ROWS } from "./learning";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

/** The approved preview's Learning & self-updates page (preview.html PG learning), card by card. */
const PREVIEW_CARDS = ["What Branch may change about itself", "Learning", "Working on its own code", "What it may fix by itself", "Gardener", "Budding", "Keeping a change",
  "Extras fetched when first used", "How the engine runs", "Settings you can talk to"];
/** The cards and rows the preview shows at Regular. */
const PREVIEW_REGULAR: Record<string, string[]> = {
  "What Branch may change about itself": ["Its own settings", "Loosening what it may do", "The gateway’s timings", "Restarting its own engine", "Updating itself",
    "Its own program and your saved work", "Work on its own code in a separate copy"],
  // the preview's switches, then its list of what it learned with Undo on each
  Learning: ["Look back after each task", "Model for looking back", "Wait until the computer is idle", "Tell me what it learned", "Fix a skill as soon as it’s found wrong",
    "Learn from your reactions and corrections", "Think again after a thumbs-down", "Remember what worked", "Turn repeated instructions into rules", "Make a rule from a mistake",
    "A Trunk may edit its own persona", "What it learned"],
  Gardener: ["Look after skills", "Look at skills now"],
  Budding: ["Learn what a Trunk can’t do yet", "Highest step it may take"],
  "Keeping a change": ["Keep a change only if it does better by", "Use paid models at night"],
};
/** Working Classic controls the preview's Learning page doesn't list, kept on their own rows (Advanced). */
const EXTRA: Record<string, string[]> = {
  "What Branch may change about itself": ["Let agents use this window"],
  "How the engine runs": ["Check and fix", "Restart the engine", "Set up the Gateway again"],
};

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "doctor.memory.status", "doctor.memory.resetGroundedShortTerm",
  "skills.proposals.list", "models.list", "system.info", "system-presence", "users.list", "health", "gateway.restart.request"];
function engineOf() {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: { skills: { workshop: { autonomous: { mode: "propose" } } }, agents: { defaults: { maxConcurrent: 4 } } } };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "doctor.memory.status") return { rings: { shortTermEntries: [{ snippet: "Dana wants reports by the 5th", path: "memory/notes.md", startLine: 3 }], promotedEntries: [{ snippet: "Dana wants expense reports by the 5th", promotedAt: "2026-10-13T09:00:00Z" }] } };
    if (method === "doctor.memory.resetGroundedShortTerm") return { removedShortTermEntries: 2 };
    if (method === "skills.proposals.list") return { proposals: [{ id: "p1", title: "Skip receipts already filed", status: "applied", updatedAt: "2026-10-14T09:00:00Z" }] };
    if (method === "models.list") return { models: [{ provider: "openai", id: "gpt", name: "GPT" }] };
    if (method === "system.info") return { pid: 4242 };
    if (method === "system-presence") return [{ host: "This window" }, { mode: "cli" }];
    if (method === "users.list") return { profiles: [{ displayName: "Taofik" }] };
    if (method === "health") return { ok: true };
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
async function mount(page = "learning") {
  const env = engineOf();
  await act(async () => root.render(<SettingsFrame engine={env.engine} page={page} pages={R1_PAGES} />));
  await settle();
  return env;
}
const sections = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")];
const labels = (sec: HTMLElement) => [...sec.querySelectorAll<HTMLElement>(".r1s-row > b")].map((b) => b.textContent ?? "");
const card = (title: string) => sections().find((s) => s.getAttribute("aria-label") === title)!;

describe("R1 Settings › Learning & self-updates is a native R1 page with the preview's cards", () => {
  it("draws the preview's Regular cards in order, with their rows, under the frame's title, lede and Learn more", async () => {
    expect(PAGES.learning.cards).toEqual(PREVIEW_CARDS);
    expect(R1_PAGES.learning?.component).toBeUndefined();
    await mount();
    expect(host.querySelector(".r1s-custom, .r1s-classic, [data-classic]")).toBeNull();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Learning & self-updates");
    expect(host.querySelector(".r1s-lede")?.textContent).toContain(PAGES.learning.lede);
    // Regular shows only what works today: the preview's rows that wait for a later update show from Advanced, and a
    // card with nothing else at Regular (Gardener, Keeping a change) is left out.
    const coming = new Set(LEARNING_ROWS.filter((r) => r.source.kind === "coming").map((r) => r.label));
    const regular = Object.entries(PREVIEW_REGULAR).map(([title, rows]) => [title, rows.filter((l) => !coming.has(l))] as const).filter(([, rows]) => rows.length);
    expect(regular.map(([title]) => title)).toEqual(["What Branch may change about itself", "Learning", "Budding"]);
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(regular.map(([title]) => title));
    for (const [title, rows] of regular) expect(labels(card(title)), title).toEqual(rows);
    expect(host.textContent).not.toContain("later update");
    await click(button(host, "Learn more"));
    expect([...host.querySelectorAll(".r1s-help li")].map((li) => li.textContent)).toEqual(regular.map(([title]) => title));
  });

  it("shows all ten preview cards at Advanced, in order, with Classic's extra working rows listed", async () => {
    await mount();
    await setLevel("Advanced");
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(PREVIEW_CARDS);
    for (const [title, extra] of Object.entries(EXTRA)) for (const label of extra) expect(labels(card(title)), title).toContain(label);
    expect(labels(card("Gardener"))).toEqual(["Look after skills", "Look at skills now", "Rest a skill after", "Set it aside after", "What each night costs", "Clear replayed notes",
      "What Rings is weighing", "Time zone for the night window", "Model that writes the diary", "Where Rings writes what it keeps", "Keep reports out of memory"]);
  });

  it("says why each Coming row waits in one plain sentence, never naming how Branch works inside", async () => {
    await mount();
    await setLevel("Technical");
    // The row's own label is the preview's words (Restarting its own engine), so only the rest of the sentence is checked.
    const reasons = [...host.querySelectorAll<HTMLElement>("[data-coming]")].map((r) => (r.querySelector(".r1s-note")?.textContent ?? "").replace(r.querySelector(":scope > b")?.textContent ?? "\u0000", ""));
    expect(reasons.length).toBeGreaterThan(10);
    for (const r of reasons) expect(r, r).not.toMatch(/engine|gateway call|method|config|\b[a-z]+\.[a-z]+\b/i);
  });

  it("keeps every working Classic control live, declared, and on Classic's engine calls", async () => {
    const { request } = await mount();
    await setLevel("Technical");
    for (const id of Object.keys(R1_PAGES.learning?.controls ?? {})) expect(row(id), id).not.toBeNull();
    expect(undeclaredControls(host)).toEqual([]);
    expect(row("learning.learning.learned")?.textContent).toContain("Learned “Skip receipts already filed”, as a skill");
    await click(button(row("learning.gardener.clear"), "Clear"));
    expect(row("learning.gardener.clear")?.textContent).toContain("Cleared 2 notes.");
    await click(button(row("learning.runs.restart-now"), "Restart the engine"));
    expect(request.mock.calls.some(([m]) => m === "gateway.restart.request")).toBe(true);
    expect(row("learning.runs.tasks")?.textContent).toContain("Up to 4");
    // The preview's Undo on each thing it learned, Coming until Branch can undo one; no row of its own.
    expect(button(row("learning.learning.learned"), "Undo")?.closest("[data-coming]")).not.toBeNull();
    expect(row("learning.runs.people")?.textContent).toContain("Taofik");
    expect(row("learning.budding.learn")?.querySelector("[role=switch]")?.getAttribute("aria-checked")).toBe("true");
  });

  it("opens old Seasons links on Learning & self-updates", async () => {
    expect(pageFor("seasons")).toBe("learning");
    await mount(pageFor("seasons"));
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Learning & self-updates");
  });
});
