// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsPage } from "../index";
import { sameWhyRuns } from "../../../shell/shown-why";
import { APP, type OffRow } from "./developer-more";

function engineWith() {
  const request = vi.fn(async (method: string) => (method === "config.get" ? { hash: "h1", valid: true, path: "branch.json", raw: "{}", config: {} } : {}));
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return engine;
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); host.className = "set-col"; document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; localStorage.clear(); vi.restoreAllMocks(); });

async function show() {
  await act(async () => root.render(<SettingsPage page="developer" title="Developer" level="technical" engine={engineWith()} />));
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
}
const row = (title: string) => document.querySelector(`[data-row="${title}"]`) as HTMLElement;
/** Every visible line that says only the shared reason. */
const notes = () => [...document.querySelectorAll("small, p")].filter((el) => el.textContent?.trim() === APP);

// Rows set in the Branch app, each group next to each other in one section.
const TROUBLE = ["Ports", "App process", "Program file", "Engine folder", "Conversation store"];
const TROUBLE_MORE = ["Show frame rate", "Developer tools"];
const ASSISTANTS = ["Your Trunk reacts to coding assistant events", "Remote control for the terminal"];

describe("Settings › Developer: the Branch app note is said once per group", () => {
  it("shows the note once above each group, not under every row", async () => {
    await show();
    // One note for each of the three groups, plus Status line, which is alone in System and keeps its own line.
    expect(notes()).toHaveLength(4);
    for (const t of [...TROUBLE, ...TROUBLE_MORE, ...ASSISTANTS]) {
      expect(row(t), t).not.toBeNull();
      expect(row(t).textContent, t).not.toContain(APP);
    }
    expect(row("Status line").textContent).toContain(APP);
  });

  it("keeps every row greyed with its own sub-line, and its controls still name the note", async () => {
    await show();
    for (const t of [...TROUBLE, ...TROUBLE_MORE, ...ASSISTANTS]) expect(row(t).getAttribute("aria-disabled"), t).toBe("true");
    expect(row("Ports").textContent).toContain("tunnel ports.");
    expect(row("Developer tools").textContent).toContain("Network, console and the window’s state.");
    for (const [t, name] of [["Ports", "Check ports"], ["Developer tools", "Open"], ["Remote control for the terminal", "Remote control for the terminal"]]) {
      const ctl = [...row(t).querySelectorAll<HTMLElement>("button, [role=switch]")].find((el) => el.textContent?.trim() === name || el.getAttribute("aria-label") === name);
      const id = ctl?.getAttribute("aria-describedby");
      expect(id, t).toBeTruthy();
      expect(document.getElementById(id ?? "")?.textContent, t).toBe(APP);
    }
  });

  it("groups only rows next to each other that share the same reason", () => {
    const rows: OffRow[] = [["A", "", APP], ["B", "", APP], ["C", "", "Other."], ["D", "", APP], ["E", "", ""], ["F", "", ""]];
    expect(sameWhyRuns(rows, (r) => r[2]).map((run) => run.map((r) => r[0]).join(""))).toEqual(["AB", "C", "D", "E", "F"]);
  });
});
