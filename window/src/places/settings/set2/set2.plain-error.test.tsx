// @vitest-environment jsdom
// Settings set2: a raw engine dump on Computer, a button call, and Logs reads as one plain sentence at Regular.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { CallLine, useCall } from "./common";
import { LogsDialog } from "./advanced-tech";
import { ComputerPage } from "./computer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|19031|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:19031";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  host.className = "set-col";
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  localStorage.clear();
});

const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };

function engineOf(request: (method: string) => Promise<unknown>) {
  return { request, onEvent: () => () => undefined, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
}

function CallFail() {
  const call = useCall();
  return (
    <>
      <button type="button" onClick={() => void call.run(() => Promise.reject(new Error(ENGINE)))}>Go</button>
      <CallLine call={call} />
    </>
  );
}

describe("Settings set2 never shows a raw engine error at Regular", () => {
  it("names a failed button call in a plain sentence", async () => {
    await act(async () => root.render(<CallFail />));
    await act(async () => host.querySelector("button")!.click());
    await settle();
    const alert = host.querySelector("[role='alert']")?.textContent ?? "";
    expect(alert).toBe(REACH);
    expect(alert).not.toMatch(RAW);
  });

  it("names a failed logs tail in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "logs.tail") throw new Error(ENGINE);
      return {};
    });
    await act(async () => root.render(<LogsDialog engine={engineOf(request)} onClose={() => undefined} />));
    await settle();
    const alert = host.querySelector("[role='alert']")?.textContent ?? "";
    expect(alert).toBe(REACH);
    expect(alert).not.toMatch(RAW);
  });

  it("names a failed computer list in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list" || method === "device.pair.list" || method === "node.pair.list") throw new Error(ENGINE);
      if (method === "config.get") return { hash: "h", valid: true, config: {} };
      if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Birch" }] };
      return {};
    });
    await act(async () => root.render(
      <KitProvider level={0} report={report} scope={null}>
        <ComputerPage page="computer" title="Computer & browser" level="regular" engine={engineOf(request)} />
      </KitProvider>,
    ));
    await settle();
    const alerts = [...host.querySelectorAll("[role='alert']")].map((n) => n.textContent ?? "");
    expect(alerts.join(" ")).toContain(REACH);
    expect(host.textContent).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(<CallFail />));
    await act(async () => host.querySelector("button")!.click());
    await settle();
    expect(host.querySelector("[role='alert']")?.textContent).toBe(ENGINE);
  });
});
