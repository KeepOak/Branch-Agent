// @vitest-environment jsdom
// Private #1089: Customize › Start from a job put the new Trunk's id and the engine's raw error in its line
// ("Researcher was created (research), but … <raw> …"), and showed agents.list's raw error as it was.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Jobs } from "./jobs";

const createJob = vi.hoisted(() => vi.fn());
vi.mock("./jobs-data", async (load) => ({ ...(await load<typeof import("./jobs-data")>()), createJob }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const Observer = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  vi.stubGlobal("IntersectionObserver", Observer); vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });

it("says agents.list failed in plain words", async () => {
  const request = vi.fn(async () => { throw new Error("unknown method: agents.list at dispatch (gateway.ts:12:3)"); });
  const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes: [] } as unknown as WindowEngine;
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Jobs engine={engine} reload={() => {}} />));
  await flush();
  await act(async () => (host.querySelector('[aria-label="Use this job: Researcher"]') as HTMLButtonElement).click());
  await flush();
  const alert = host.querySelector("[role=alert]")?.textContent ?? "";
  expect(alert).toBe("Couldn’t read your Trunks. Try again.");
  expect(host.textContent).not.toMatch(/unknown method|agents\.list|:\d+:\d+/);
});

it("says the job wasn't saved without the new Trunk's id or the engine's words", async () => {
  createJob.mockRejectedValueOnce(new Error("Researcher was created (research-7f3a), but its job instructions were not saved. Error: EACCES at write (C:\\work\\SOUL.md:1:1) Open Edit to finish setting it up."));
  const request = vi.fn(async () => ({ agents: [{ id: "main", name: "Sapling" }], defaultId: "main" }));
  const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes: [] } as unknown as WindowEngine;
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Jobs engine={engine} reload={() => {}} />));
  await flush();
  await act(async () => (host.querySelector('[aria-label="Use this job: Researcher"]') as HTMLButtonElement).click());
  await flush();
  const create = [...document.querySelectorAll("button")].find((b) => b.textContent === "Create Trunk")!;
  await act(async () => create.click());
  await flush();
  expect(document.querySelector("[role=alert]")?.textContent).toBe("Researcher was created, but its job instructions weren’t saved. Open Edit to finish setting it up.");
  expect(document.body.textContent).not.toMatch(/research-7f3a|EACCES|Error:|SOUL\.md|:\d+:\d+/);
});
