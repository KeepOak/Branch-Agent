// @vitest-environment jsdom
// Private #1089 (Linux pass, Regular): the side panes and the Browser tools put the engine's raw error on screen
// ("ENOENT: no such file or directory, open '/home/<user>/…'", "connect ECONNREFUSED 127.0.0.1:18789", "unknown method: …").
// At Regular each reads as a plain sentence with a next step; Advanced keeps the exact words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { FilesTab } from "./pane/FilesTab";
import { DashboardTab } from "./pane/DashboardTab";
import { ActivityTab } from "./pane/ActivityTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const RAW = /unknown method|ECONNREFUSED|127\.0\.0\.1|ENOENT|EACCES|\/home\/|\/opt\/|TypeError|:\d+:\d+/;
const FAILURES = [
  "unknown method: files.browse",
  "connect ECONNREFUSED 127.0.0.1:18789",
  "ENOENT: no such file or directory, scandir '/home/alex/.branch/workspace'",
  "EACCES: permission denied, open '/opt/branch/data'",
];
const failing = (message: string) => ({ sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], onEvent: () => () => {}, request: vi.fn(async () => { throw new Error(message); }) }) as unknown as WindowEngine;

let root: Root; let host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); });
// A helper whose last run failed: the engine's words arrive as the sessions.list row's lastRunError.
const helperFailed = (lastRunError: string) => ({
  sessionKey: "agent:scout:main", scopes: [], onEvent: () => () => {},
  request: vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "sessions.list") return { sessions: params.spawnedBy === "agent:scout:main" ? [{ key: "agent:scout:subagent:reader", spawnedBy: "agent:scout:main", status: "failed", label: "Reader", lastRunError }] : [] };
    if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
    if (method === "canopy.cards.list") return { cards: [] };
    if (method === "chat.history") return { messages: [] };
    return {};
  }),
}) as unknown as WindowEngine;
const helperLine = () => host.querySelector(".err-st")?.textContent ?? "";
const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

describe("the side panes never show a raw engine error at Regular (Private #1089)", () => {
  it.each(FAILURES)("Files: %j", async (raw) => {
    await act(async () => root.render(<FilesTab engine={failing(raw)} />));
    await settle();
    expect(host.textContent).not.toMatch(RAW);
  });

  it.each(FAILURES)("Dashboard: %j", async (raw) => {
    await act(async () => root.render(<DashboardTab engine={failing(raw)} name="Scout" level="regular" />));
    await settle();
    expect(host.textContent).not.toMatch(RAW);
  });

  it.each([...FAILURES, "TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)"])("Activity, a helper's failed run: %j", async (raw) => {
    await act(async () => root.render(<ActivityTab engine={helperFailed(raw)} name="Scout" blocks={[]} running={false} level="regular" onError={() => {}} />));
    await settle();
    expect(helperLine()).not.toBe("");
    expect(helperLine()).not.toMatch(RAW);
  });

  it("Activity keeps a helper's exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(<ActivityTab engine={helperFailed(FAILURES[1])} name="Scout" blocks={[]} running={false} level="advanced" onError={() => {}} />));
    await settle();
    expect(helperLine()).toContain("ECONNREFUSED");
  });

  it("Advanced keeps the exact words", async () => {
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(<FilesTab engine={failing(FAILURES[2])} />));
    await settle();
    expect(host.textContent).toContain("ENOENT");
  });
});
