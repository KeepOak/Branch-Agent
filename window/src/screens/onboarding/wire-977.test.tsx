// @vitest-environment jsdom
// #977: Try it with examples reads trunks.template.starters and lets Continue go on; Set up by talking starts
// "Setting up Branch" with sessions.create and hands its key to the window. On an engine with no methods both are
// Coming, naming their calls, and nothing on the card is undeclared. Plan first stays Coming: the engine has no mode.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import { TALK_MESSAGE, TALK_TITLE } from "./finish";
import { readExamples } from "./model";
import { Onboarding } from "./Onboarding";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const ALL = ["branch.setup.detect", "branch.setup.verify", "branch.setup.activate", "models.authStatus", "config.get", "config.patch", "agents.list", "chat.send", "sessions.create", "trunks.template.starters"];
const STARTERS = { timezone: "UTC", offer: [{ id: "home-desk", name: "Home Desk", description: "Family admin.", pitch: "I keep family and home admin moving." }, { id: "spend-saver", name: "Spend Saver", description: "Finds savings.", pitch: "" }] };
function fakeEngine(methods = ALL) {
  const request = vi.fn(async (method: string): Promise<unknown> => {
    if (method === "branch.setup.detect") return { candidates: [] };
    if (method === "trunks.template.starters") return STARTERS;
    if (method === "agents.list") return { defaultId: "scout", mainKey: "main", agents: [{ id: "scout", name: "Scout" }] };
    if (method === "sessions.create") return { ok: true, key: "agent:scout:setup-1" };
    if (method === "config.get") return { hash: "h", valid: true, config: {} };
    return { ok: true };
  });
  return { engine: { request, onEvent: () => () => {}, sessionKey: null, agentId: "main", scopes: [], features: { methods, events: [] } } as unknown as WindowEngine, request };
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
async function show(engine: WindowEngine, props: Partial<Parameters<typeof Onboarding>[0]> = {}) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<CapabilityProvider engine={engine}><Onboarding engine={engine} onLater={() => {}} {...props} /></CapabilityProvider>));
  await flush();
  return host;
}

it("shows the example Trunks from trunks.template.starters and lets Continue go on without a model", async () => {
  const { engine, request } = fakeEngine();
  const host = await show(engine, { startAt: 1 });
  expect(button(host, "Continue").getAttribute("aria-disabled")).toBeNull();
  const tryIt = button(host, "Try it with examples");
  expect(tryIt.getAttribute("aria-disabled")).toBeNull();
  expect(tryIt.dataset.need).toBe("trunks.template.starters");
  await act(async () => tryIt.click()); await flush();
  expect(request).toHaveBeenCalledWith("trunks.template.starters", {});
  const list = host.querySelector('[aria-label="Example Trunks"]')!;
  expect([...list.querySelectorAll("b")].map((b) => b.textContent)).toEqual(["Home Desk", "Spend Saver"]);
  expect(list.textContent).toContain("I keep family and home admin moving.");
  expect(list.textContent).toContain("Finds savings.");
  expect(button(host, "Continue").getAttribute("aria-disabled")).toBeNull();
  await act(async () => button(host, "Continue").click());
  expect(host.querySelector("h1")?.textContent).toBe("How much may it do?");
});

it("starts Setting up Branch with the default Trunk and hands its key to the window", async () => {
  const { engine, request } = fakeEngine();
  const onTalk = vi.fn();
  const host = await show(engine, { onTalk });
  const talk = button(host, "Set up by talking");
  expect(talk.getAttribute("aria-disabled")).toBeNull();
  expect(talk.dataset.need).toBe("sessions.create");
  await act(async () => talk.click()); await flush();
  expect(request).toHaveBeenCalledWith("sessions.create", { agentId: "scout", displayName: TALK_TITLE, message: TALK_MESSAGE });
  expect(onTalk).toHaveBeenCalledWith("agent:scout:setup-1");
});

it("says so and stays on the card when the conversation can't start", async () => {
  const { engine, request } = fakeEngine();
  request.mockImplementation(async (method: string) => { if (method === "sessions.create") throw new Error("Error: NOT_FOUND: no default Trunk for agent:main:main at sessions.create (C:\\Users\\someone\\gateway.ts:4:2)"); return {}; });
  const onTalk = vi.fn();
  const host = await show(engine, { onTalk });
  await act(async () => button(host, "Set up by talking").click()); await flush();
  expect(onTalk).not.toHaveBeenCalled();
  expect(host.querySelector("[role=alert]")?.textContent).toBe("Couldn’t start that conversation. Try again.");
  // Private #1089: the engine's words, code, session key and path are not rendered, not even behind Details.
  expect(host.textContent).not.toMatch(/NOT_FOUND|no default Trunk|agent:main|sessions\.create|gateway\.ts|Error:/);
  expect(host.querySelector("details")).toBeNull();
});

it("keeps both Coming, naming their calls, on an engine with no methods", async () => {
  const { engine, request } = fakeEngine([]);
  const onTalk = vi.fn();
  let host = await show(engine, { onTalk });
  expect(button(host, "Set up by talking").getAttribute("aria-disabled")).toBe("true");
  await act(async () => button(host, "Set up by talking").click()); await flush();
  expect(undeclaredControls(host)).toEqual([]);
  await act(async () => root!.unmount()); root = undefined; host.remove();
  host = await show(engine, { startAt: 1 });
  expect(button(host, "Try it with examples").getAttribute("aria-disabled")).toBe("true");
  await act(async () => button(host, "Try it with examples").click()); await flush();
  expect(request.mock.calls.map(([m]) => m)).not.toContain("sessions.create");
  expect(request.mock.calls.map(([m]) => m)).not.toContain("trunks.template.starters");
  expect(onTalk).not.toHaveBeenCalled();
  expect(comingControls().find((c) => c.where === "Try it with examples")?.missing).toEqual(["trunks.template.starters"]);
  expect(undeclaredControls(host)).toEqual([]);
});

it("reads example Trunks from the starters answer", () => {
  expect(readExamples(STARTERS)).toEqual([{ id: "home-desk", name: "Home Desk", pitch: "I keep family and home admin moving." }, { id: "spend-saver", name: "Spend Saver", pitch: "Finds savings." }]);
  expect(readExamples({ offer: [{ id: "" }], reason: "x" })).toEqual([]);
  expect(readExamples(null)).toEqual([]);
});
