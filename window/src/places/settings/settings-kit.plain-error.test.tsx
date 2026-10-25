// @vitest-environment jsdom
// Settings kit, desktop rows and diagnostics: a raw engine dump reads as one plain sentence at Regular.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { DesktopCtl } from "./desktop-ctl";
import { ComputerSettings, GatewaySettings, UsageSettings } from "./diagnostics";
import { KitProvider, useSaveRunner, type SaveReport } from "./kit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|19031|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:19031";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  delete (window as { branchDesktop?: unknown }).branchDesktop;
});

const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };

function FailSave() {
  const run = useSaveRunner();
  return <button type="button" onClick={() => void run(() => Promise.reject(new Error(ENGINE)))}>Save</button>;
}

describe("Settings kit and diagnostics never show a raw engine error at Regular", () => {
  it("reports a failed save in a plain sentence", async () => {
    const failed = vi.fn();
    const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed };
    await act(async () => root.render(
      <KitProvider level={0} report={report} scope={null}><FailSave /></KitProvider>,
    ));
    await act(async () => host.querySelector("button")!.click());
    await settle();
    expect(failed).toHaveBeenCalledWith(REACH);
    expect(String(failed.mock.calls[0]?.[0])).not.toMatch(RAW);
  });

  it("names a failed desktop change in a plain sentence", async () => {
    (window as { branchDesktop?: unknown }).branchDesktop = {
      controls: {
        get: async () => ({ keepWorking: false, keepAwake: false, trayUsage: false, startWithWindows: false, branchOnPath: false }),
        set: async () => { throw new Error(ENGINE); },
      },
    };
    const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
    await act(async () => root.render(
      <KitProvider level={0} report={report} scope={null}>
        <DesktopCtl title="Keep this computer awake" sub="Stays awake." name="keepAwake" />
      </KitProvider>,
    ));
    await settle();
    await act(async () => host.querySelector("input")!.click());
    await settle();
    const line = host.querySelector("[role='alert']")?.textContent ?? "";
    expect(line).toBe(REACH);
    expect(line).not.toMatch(RAW);
  });

  it("names a failed usage read in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "usage.cost") throw new Error(ENGINE);
      return { providers: [] };
    });
    const engine = { request, onEvent: () => () => undefined, sessionKey: null, agentId: "main", scopes: [] } as unknown as WindowEngine;
    await act(async () => root.render(<UsageSettings page="usage" title="Data & usage" level="regular" engine={engine} />));
    await settle();
    const alert = host.querySelector("[role='alert']")?.textContent ?? "";
    expect(alert).toBe(REACH);
    expect(alert).not.toMatch(RAW);
    expect(host.textContent).not.toMatch(RAW);
  });

  it("names a failed computer and gateway read in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "computer.status" || method === "node.list" || method === "health" || method === "status") throw new Error(ENGINE);
      return {};
    });
    const engine = { request, onEvent: () => () => undefined, sessionKey: null, agentId: "main", scopes: [] } as unknown as WindowEngine;
    await act(async () => root.render(<ComputerSettings page="computer" title="Computer" level="regular" engine={engine} />));
    await settle();
    expect(host.textContent).toContain(REACH);
    expect(host.textContent).not.toMatch(RAW);
    await act(async () => root.render(<GatewaySettings page="gateway" title="Gateway" level="regular" engine={engine} />));
    await settle();
    expect(host.textContent).toContain(REACH);
    expect(host.textContent).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const failed = vi.fn();
    await act(async () => root.render(
      <KitProvider level={1} report={{ saving: vi.fn(), saved: vi.fn(), failed }} scope={null}><FailSave /></KitProvider>,
    ));
    await act(async () => host.querySelector("button")!.click());
    await settle();
    expect(failed).toHaveBeenCalledWith(ENGINE);
  });
});
