// @vitest-environment jsdom
// Settings set2: a raw engine dump on Computer, a button call, and Logs reads as one plain sentence at Regular.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type Lv, type SaveReport } from "../kit";
import { CallLine, useCall } from "./common";
import { LogsDialog, SectionDialog } from "./advanced-tech";
import type { Ctx } from "./advanced-more";
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
    const waiting = host.querySelector("#s2-waiting")?.textContent ?? "";
    expect(waiting).toContain(REACH);
    expect(waiting).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(<CallFail />));
    await act(async () => host.querySelector("button")!.click());
    await settle();
    expect(host.querySelector("[role='alert']")?.textContent).toBe(ENGINE);
  });
});

// SectionDialog (Technical Edit rows, and the Customize editor at Technical): malformed JSON on Save keeps the parser's
// reason and position. Edit rows don't exist at Regular, so there is no Regular wording to test.
const BAD_JSON = '{ "mode": "auto",, }';
const parserWords = (() => { try { JSON.parse(BAD_JSON); return ""; } catch (error) { return (error as Error).message; } })();

function sectionCtx(request: (method: string) => Promise<unknown>, set: (path: string, value: unknown) => Promise<void>) {
  const config = { get: () => ({ mode: "auto" }), set, loading: false } as unknown as Ctx["config"];
  return { engine: engineOf(request), config, lv: 2, agent: "", plugins: [] } as unknown as Ctx;
}

async function saveBadJson(level: Lv) {
  const request = vi.fn(async () => ({}));
  const set = vi.fn(async () => undefined);
  const onClose = vi.fn();
  await act(async () => root.render(
    <KitProvider level={level} report={report} scope={null}>
      <SectionDialog c={sectionCtx(request, set)} path="talk" title="Talk" onClose={onClose} />
    </KitProvider>,
  ));
  await settle();
  const area = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Talk settings"]');
  expect(area).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { setValue.call(area, BAD_JSON); area!.dispatchEvent(new Event("input", { bubbles: true })); });
  const saveBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save");
  expect(saveBtn).toBeDefined();
  await act(async () => saveBtn!.click());
  await settle();
  expect(set).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  return document.querySelector("[role='alert']")?.textContent ?? "";
}

describe("Settings section editor: malformed JSON on Save", () => {
  it("shows the exact parser reason and position at Technical", async () => {
    localStorage.setItem("branch.level", "technical");
    expect(parserWords).toMatch(/position|line|column/i);
    const alert = await saveBadJson(2);
    expect(alert).toBe("That isn’t valid JSON: " + parserWords);
  });

  it("shows the exact parser reason and position at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const alert = await saveBadJson(1);
    expect(alert).toBe("That isn’t valid JSON: " + parserWords);
  });
});
