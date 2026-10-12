// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { ComputerSettings, GatewaySettings, remainingPercent, UsageSettings } from "./diagnostics";
const props = (request: ReturnType<typeof vi.fn>) => ({ page: "usage", title: "Data & usage", level: "regular" as const, engine: { request: request as WindowEngine["request"], sessionKey: null, agentId:"sapling", scopes: [], onEvent: () => () => {} } });
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("does not invent unknown allowance percentages", () => {
  expect(remainingPercent(12)).toBe(88); expect(remainingPercent(100)).toBe(0); expect(remainingPercent(0)).toBe(100);
  for (const missing of [undefined, null, "10", -1, 101, NaN, Infinity]) expect(remainingPercent(missing)).toBeUndefined();
});
it("renders service allowance bars and real costs, with engine-backed period changes", async () => {
  const request = vi.fn(async (method:string) => method === "usage.status" ? { providers: [{ provider:"service", displayName:"Service", windows:[{label:"This week",usedPercent:12}] }] } : { totals: {totalCost:3.25,totalTokens:1234}, daily:[] });
  await act(async () => root.render(<UsageSettings {...props(request)} />));
  expect(host.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("88"); expect(host.textContent).toContain("$3.25");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "7 days") as HTMLButtonElement).click());
  expect(request).toHaveBeenCalledWith("usage.cost", {days:7,agentId:"sapling"}); expect(host.textContent).toContain("Spend, last 7 days");
});
it("distinguishes provider refresh and unavailable cost from zero", async () => {
  const request = vi.fn(async (method:string) => { if (method === "usage.status") return {refreshing:true,providers:[]}; throw new Error("Cost service unavailable"); });
  await act(async () => root.render(<UsageSettings {...props(request)} />));
  expect(host.textContent).toContain("The engine is refreshing account allowances."); expect(host.textContent).toContain("Cost service unavailable"); expect(host.textContent).not.toContain("$0.00");
});
it("renders available computer actions and node presence without claiming pending approval is online", async () => {
  const request = vi.fn(async (method:string) => method === "computer.status" ? { configured:true,available:true,computerUse:{provider:{label:"Knothole"},actions:["browser_navigate"]}} : { nodes:[{nodeId:"pending",displayName:"Studio",approvalState:"pending-approval"},{nodeId:"paired",displayName:"Laptop",connected:true,paired:true}] });
  await act(async () => root.render(<ComputerSettings {...props(request)} />));
  expect(host.textContent).toContain("Waiting for your yes"); expect(host.textContent).toContain("Waiting for approval"); expect(host.textContent).toContain("Laptop"); expect(host.textContent).toContain("Online"); expect(host.textContent).toContain("Browser actions are available");
});
it("reports actual gateway health fields and hides technical process data at Regular", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "0.4.4-build-a300a48dba2f" })));
  const request = vi.fn(async (method:string) => method === "health" ? {ok:true,ts:1,durationMs:4,channels:{}} : {pid:4321,runtimeVersion:"2026.9.8",processMemory:{rssBytes:10485760}});
  const settings = props(request);
  await act(async () => root.render(<GatewaySettings {...settings} />));
  expect(host.textContent).toContain("Health check answered in 4 ms"); expect(host.textContent).toContain("0.4.4 · build a300a48d"); expect(host.textContent).not.toContain("2026.9.8"); expect(host.textContent).not.toContain("4321");
  await act(async () => root.render(<GatewaySettings {...settings} level="technical" />));
  expect(host.textContent).toContain("4321"); expect(host.textContent).toContain("10.0 MB");
});
