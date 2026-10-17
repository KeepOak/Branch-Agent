// @vitest-environment jsdom
// The R1 Permissions page re-hosts Classic's This computer section (#1446). PE1: it shows what the system already
// allows, and Allow… asks the system itself, so the real microphone request reaches the R1 page.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const prevPlatform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => "MacIntel" });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  delete (window as unknown as { branchDesktop?: unknown }).branchDesktop;
  if (prevPlatform) Object.defineProperty(Navigator.prototype, "platform", prevPlatform);
});

const engine = () => ({ request: vi.fn(async () => ({})), onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: [], events: [] } }) as unknown as WindowEngine;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

it("shows This computer's real status at Regular and Allow… asks the system for the microphone", async () => {
  const calls: string[] = [];
  const state: Record<string, string> = { microphone: "not-asked", camera: "allowed", location: "unknown", notifications: "unknown" };
  (window as unknown as { branchDesktop?: unknown }).branchDesktop = {
    permissions: {
      get: async () => ({ ...state }),
      request: async (name: string) => { calls.push(`request:${name}`); state[name] = "allowed"; return { ...state }; },
      open: async (name: string) => { calls.push(`open:${name}`); },
    },
  };
  await act(async () => root.render(<SettingsFrame engine={engine()} page="permissions" pages={R1_PAGES} />));
  await settle();
  const page = host.querySelector<HTMLElement>('.r1s-custom[data-slot="permissions"]')!;
  const row = (name: string) => page.querySelector<HTMLElement>(`[data-row="${name}"]`)!;
  expect(row("Microphone").textContent).toContain("Not yet");
  expect(row("Camera").textContent).toContain("Granted");
  expect(row("Camera").querySelector("button")).toBeNull();
  const allow = [...row("Microphone").querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Allow…")!;
  expect(allow.disabled).toBe(false);
  await act(async () => allow.click());
  await settle();
  expect(calls).toEqual(["request:microphone"]);
  expect(row("Microphone").textContent).toContain("Granted");
});
