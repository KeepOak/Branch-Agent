// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsPage } from "../index";

type Answers = Record<string, unknown | ((params: Record<string, unknown>) => unknown)>;
function engineWith(answers: Answers) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const a = answers[method];
    if (a === undefined) return {};
    if (a instanceof Error) throw a;
    return typeof a === "function" ? (a as (p: Record<string, unknown>) => unknown)(params) : a;
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); host.className = "set-col"; document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
async function show(engine: WindowEngine, level: "regular" | "advanced" | "technical" = "regular") {
  await act(async () => root.render(<SettingsPage page="computer" title="Computer & browser" level={level} engine={engine} />));
  await flush();
}
const row = (title: string) => document.querySelector(`[data-row="${title}"]`) as HTMLElement | null;
const computers = () => document.querySelector('[data-sec="Computers they may use"]') as HTMLElement | null;

const EMPTY_NODES = { "node.list": { nodes: [] }, "computer.status": new Error("computer status unavailable") };

describe("Settings › Computer & browser › computers they may use", () => {
  it("lists This computer as Ready when screen control is on, even if computer.status fails", async () => {
    const { engine } = engineWith({
      ...EMPTY_NODES,
      "config.get": { hash: "h", valid: true, config: { plugins: { entries: { "cua-computer": { enabled: true } } } } },
    });
    await show(engine);
    const card = row("This computer");
    expect(card?.textContent).toContain("This computer");
    expect(card?.textContent).toContain("Ready");
    expect(computers()?.textContent).not.toContain("No computers are paired yet.");
  });

  it("says no computers are paired only when screen control is off and none are listed", async () => {
    const { engine } = engineWith({
      ...EMPTY_NODES,
      "config.get": { hash: "h", valid: true, config: {} },
    });
    await show(engine);
    expect(row("This computer")).toBeNull();
    expect(computers()?.textContent).toContain("No computers are paired yet.");
  });
});

describe("Settings › Computer & browser › show the browser window", () => {
  it("says Auto works without a window, matching the headless default", async () => {
    const { engine } = engineWith({ "config.get": { hash: "h", valid: true, config: {} } });
    await show(engine, "technical");
    const r = row("Show the browser window");
    expect(r?.textContent).toContain("Auto works without a window");
    expect(r?.textContent).toContain("Always opens one on this computer");
    expect(r?.textContent).not.toContain("Auto shows a window when this computer has a screen");
  });
});
