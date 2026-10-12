// @vitest-environment jsdom
// DA-89: Settings › Seasons never shows the internal name "Rings" or the diary's file name.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsPage } from "../index";
import { ROWS } from "./seasons";

function engineWith(answers: Record<string, unknown>) {
  const request = vi.fn(async (method: string) => answers[method] ?? {});
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia; host = document.createElement("div"); host.className = "set-col"; document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
async function show(level: "regular" | "advanced" | "technical") {
  await act(async () => root.render(<SettingsPage page="seasons" title="Seasons" level={level} engine={engine} />));
  await flush();
}
const KEPT = { key: "k1", snippet: "Prefers short replies", path: "memory/2026-10-01.md", startLine: 3, promotedAt: "2026-10-09T03:00:00Z" };
const STATUS = { agentId: "main", rings: { enabled: true, shortTermCount: 1, promotedToday: 1, promotedTotal: 1, lastPromotedAt: "2026-10-09T03:00:00Z", shortTermEntries: [], promotedEntries: [KEPT], phases: { light: { enabled: true }, deep: { enabled: true }, rem: { enabled: true } } } };
let engine: WindowEngine;
const visibleText = () => document.body.textContent ?? "";

describe("Settings › Seasons copy (DA-89)", () => {
  for (const level of ["regular", "advanced", "technical"] as const) {
    it(`never says Rings or shows a file name at the ${level} level`, async () => {
      engine = engineWith({ "doctor.memory.status": STATUS, "skills.proposals.list": { proposals: [] } }).engine;
      await show(level);
      expect(visibleText()).not.toMatch(/\bRings\b/);
      expect(visibleText()).not.toContain("memory/2026-10-01.md");
      expect(visibleText()).toContain("Clean up memory overnight");
    });
  }
  it("opens what the cleanup changed without the diary's file name", async () => {
    engine = engineWith({ "doctor.memory.status": STATUS, "doctor.memory.dreamDiary": { agentId: "main", found: false, path: "/home/me/workspace/DREAMS.md" } }).engine;
    await show("regular");
    const open = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "See what it changed");
    expect(open, "the diary row's button").toBeTruthy();
    await act(async () => open?.click());
    await flush();
    const dialog = document.querySelector('[role="dialog"]')?.textContent ?? visibleText();
    expect(dialog).toContain("What overnight cleanup changed");
    expect(dialog).toContain("Nothing yet. It writes down what it changed after its first night.");
    expect(dialog).not.toMatch(/\bRings\b/);
    expect(dialog).not.toContain("DREAMS.md");
  });
  it("keeps Rings out of the settings search rows", () => {
    for (const row of ROWS) expect(`${row.title} | ${row.sec} | ${row.group}`).not.toMatch(/\bRings\b/);
  });
});
