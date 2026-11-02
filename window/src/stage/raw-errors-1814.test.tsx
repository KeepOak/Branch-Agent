// @vitest-environment jsdom
// #1814 (stage slice): the Browser pane and the Computer stage still put the engine's raw error on screen at Regular
// ("connect ECONNREFUSED 127.0.0.1:18789", "unknown method: …", a file path). At Regular each reads as a plain
// sentence; Advanced keeps the exact words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import type { Block } from "../thread/model";
import { BrowserView } from "./BrowserView";
import { ComputerStage } from "./ComputerStage";

vi.mock("./browser-screencast-client", () => ({ BrowserScreencastClient: class { close = vi.fn(); } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const RAW = /unknown method|ECONNREFUSED|127\.0\.0\.1|ENOENT|\/home\/|TypeError|:\d+:\d+/;
const FAILURES = [
  "connect ECONNREFUSED 127.0.0.1:18789",
  "unknown method: browser.request",
  "ENOENT: no such file or directory, open '/home/alex/.branch/browser/state.json'",
  "TypeError: Cannot read properties of undefined (reading 'tabs')\n    at readTabs (/app/window/dist/stage.js:41:12)",
];
const recorded: Block[] = [
  { kind: "step", key: "call-one", tool: "browser", title: "Open", detail: "", status: "ok", browser: { tab: { target: "host", profile: "branch", targetId: "tab-one" }, revision: "call-one" } } as Block,
];

let root: Root; let host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const engineOf = (request: (method: string, params: any) => Promise<unknown>) =>
  ({ sessionKey: "agent:scout:one", agentId: "scout", scopes: ["operator.admin"], onEvent: () => () => {}, request: vi.fn(request) }) as unknown as WindowEngine;
const onState = () => {};
const alerts = () => [...host.querySelectorAll(".stage-error-st")].map((p) => p.textContent ?? "").join(" | ");

describe("Browser pane errors read plain at Regular (#1814)", () => {
  // The browser's status can't be read: the page area says it couldn't connect, then the reason.
  const unreachable = (raw: string) => engineOf(async () => { throw new Error(raw); });
  // The browser isn't running and starting it fails: the line above the page carries the reason.
  const wontStart = (raw: string) => engineOf(async (_m, params) => {
    if (params.path === "/") return { running: false };
    if (params.path === "/start") throw new Error(raw);
    return {};
  });

  it.each(FAILURES)("can't connect: %j", async (raw) => {
    await act(async () => root.render(<BrowserView engine={unreachable(raw)} gatewayUrl="ws://gateway.invalid" blocks={recorded} name="Scout" onState={onState} />));
    await settle();
    expect(host.textContent).toContain("Couldn't connect to the browser");
    expect(host.textContent).not.toMatch(RAW);
  });

  it.each(FAILURES)("can't start: %j", async (raw) => {
    await act(async () => root.render(<BrowserView engine={wontStart(raw)} gatewayUrl="ws://gateway.invalid" blocks={[]} name="Scout" onState={onState} />));
    await settle();
    expect(host.querySelector(".note-br")?.textContent).toBeTruthy();
    expect(host.textContent).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(<BrowserView engine={unreachable(FAILURES[0])} gatewayUrl="ws://gateway.invalid" blocks={recorded} name="Scout" onState={onState} />));
    await settle();
    expect(host.textContent).toContain("ECONNREFUSED 127.0.0.1:18789");
    await act(async () => root.render(<BrowserView engine={wontStart(FAILURES[1])} gatewayUrl="ws://gateway.invalid" blocks={[]} name="Scout" onState={onState} />));
    await settle();
    expect(host.querySelector(".note-br")?.textContent).toContain("unknown method: browser.request");
  });
});

describe("Stop on the Computer stage reads plain at Regular (#1814)", () => {
  const stopFails = (raw: string) => engineOf(async (method) => {
    if (method === "sessions.abort") throw new Error(raw);
    if (method === "environments.list") return { environments: [] };
    if (method === "sessions.describe") return { session: { key: "agent:scout:one", agentId: "scout" } };
    return {};
  });
  const pressStop = async (engine: WindowEngine) => {
    await act(async () => root.render(<ComputerStage engine={engine} gatewayUrl="ws://gateway.invalid" name="Scout" mode="Computer" running onMode={() => {}} onClose={() => {}} onChooseComputer={() => {}} />));
    await settle();
    const stop = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Stop");
    expect(stop).toBeDefined();
    await act(async () => stop!.click());
    await settle();
  };

  it.each(FAILURES)("%j", async (raw) => {
    await pressStop(stopFails(raw));
    expect(alerts()).toContain("Couldn't stop Scout.");
    expect(alerts()).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    await pressStop(stopFails(FAILURES[0]));
    expect(alerts()).toContain("Couldn't stop Scout: connect ECONNREFUSED 127.0.0.1:18789");
  });
});
