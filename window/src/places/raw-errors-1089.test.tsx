// @vitest-environment jsdom
// Private #1089 (Linux pass, Regular): with the engine failing, Overview showed "Couldn't load gateway health.
// unknown method: logbook.status", Canopy "Upcoming schedules: connect ECONNREFUSED 127.0.0.1:18789", Automations the raw
// error beside Retry, and Library › Memory health the raw error in red. Each now reads plain at Regular.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { ScheduledTab } from "./automations/Scheduled";
import { CanopyPlace } from "./canopy/index";
import { MemoryHealth } from "./library/memory-more";
import { OverviewPlace } from "./overview/index";

vi.mock("../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /unknown method|logbook\.status|ECONNREFUSED|127\.0\.0\.1|TypeError|\/app\/|:\d+:\d+/;
const FAILURES = [
  "unknown method: logbook.status",
  "connect ECONNREFUSED 127.0.0.1:18789",
  "TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)",
];
const failing = (message: string): WindowEngine => ({
  connected: true, reconnect: vi.fn(), sessionKey: null, scopes: ["operator.admin"], onEvent: () => () => {},
  request: vi.fn(async () => { throw new Error(message); }) as WindowEngine["request"],
});

let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); });
const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const alerts = () => [...host.querySelectorAll('[role="alert"]')].map((el) => el.textContent ?? "");

describe("places never show a raw engine error at Regular (Private #1089)", () => {
  it.each(FAILURES)("Automations › Scheduled: %j", async (raw) => {
    await act(async () => root.render(<ScheduledTab engine={failing(raw)} level="regular" openConversation={() => {}} />));
    await settle();
    expect(alerts().length).toBeGreaterThan(0);
    for (const line of alerts()) expect(line).not.toMatch(RAW);
  });

  it.each(FAILURES)("Canopy: %j", async (raw) => {
    await act(async () => root.render(<CanopyPlace engine={failing(raw)} facts={{ running: 0, waiting: 0 }} openConversation={vi.fn()} openPlace={vi.fn()} level="regular" />));
    await settle();
    expect(alerts().length).toBeGreaterThan(0);
    for (const line of alerts()) expect(line).not.toMatch(RAW);
  });

  it.each(FAILURES)("Overview tiles: %j", async (raw) => {
    await act(async () => root.render(<OverviewPlace engine={failing(raw)} facts={{ running: 0, waiting: 0 }} openConversation={vi.fn()} openPlace={vi.fn()} openSettings={vi.fn()} level="regular" />));
    await settle();
    const lines = alerts().filter((line) => line.startsWith("Couldn't load"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toMatch(RAW);
  });

  it.each(FAILURES)("Library › Memory health: %j", async (raw) => {
    await act(async () => root.render(<MemoryHealth engine={failing(raw)} agentId="a" status={{ data: null, loading: false, error: raw }} check={() => {}} />));
    expect(alerts().join(" ")).not.toMatch(RAW);
  });

  it("Advanced keeps the engine's exact words", async () => {
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(<MemoryHealth engine={failing(FAILURES[0])} agentId="a" status={{ data: null, loading: false, error: FAILURES[0] }} check={() => {}} />));
    expect(alerts().join(" ")).toContain("unknown method: logbook.status");
  });
});
