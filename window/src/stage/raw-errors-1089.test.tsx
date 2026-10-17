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

  it("Advanced keeps the exact words", async () => {
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(<FilesTab engine={failing(FAILURES[2])} />));
    await settle();
    expect(host.textContent).toContain("ENOENT");
  });
});
