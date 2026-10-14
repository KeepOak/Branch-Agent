// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsPage } from "../index";

function engineWith(answers: Record<string, unknown>) {
  const request = vi.fn(async (method: string) => {
    const a = answers[method];
    if (a instanceof Error) throw a;
    return a ?? {};
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.read"] };
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
async function show(engine: WindowEngine) {
  await act(async () => root.render(<SettingsPage page="computer" title="Computer & browser" level="regular" engine={engine} />));
  await flush();
}
const line = () => document.querySelector('[data-row="Build folder cleanup"]') as HTMLElement | null;

describe("Settings › Computer & browser › Build folders", () => {
  it("shows the last cleanup's one line", async () => {
    const { engine, request } = engineWith({
      "node.list": { nodes: [] },
      "buildWorktrees.status": { enabled: true, last: { at: Date.now(), line: "freed 6.2 GB, removed 5 worktrees", removed: 5, freedBytes: 1, retrying: 0, kept: {} } },
    });
    await show(engine);
    expect(request).toHaveBeenCalledWith("buildWorktrees.status", {});
    expect(line()?.textContent).toMatch(/^Freed 6\.2 GB, removed 5 worktrees · today /);
  });

  it("says nothing ran yet before the first cleanup", async () => {
    const { engine } = engineWith({ "node.list": { nodes: [] }, "buildWorktrees.status": { enabled: true, last: null } });
    await show(engine);
    expect(line()?.textContent).toBe("Nothing to clean up yet. Branch checks every 30 minutes and after each merge.");
  });

  it("stays hidden on an engine without the cleanup or with it turned off", async () => {
    const { engine } = engineWith({ "node.list": { nodes: [] }, "buildWorktrees.status": new Error("unknown method: buildWorktrees.status") });
    await show(engine);
    expect(line()).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);
    const off = engineWith({ "node.list": { nodes: [] }, "buildWorktrees.status": { enabled: false, last: null } });
    await show(off.engine);
    expect(line()).toBeNull();
  });
});
