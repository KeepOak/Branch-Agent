// @vitest-environment jsdom
// A Trunk stuck getting ready says so in its conversation, with a Retry that reaches the engine
// (agents.retryStartup), and the conversation opens again by itself once the engine lets it through.
// Only Thread is rendered, so on a base without this feature the assertions fail, not the imports.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { preparationTimeoutLabel } from "../connect/preparation-status";
import { Thread } from "./Thread";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });

const PENDING = "Agent juniper has not completed startup inspection and preparation; run branch doctor --fix";
const refusal = (preparation?: Record<string, unknown>) => ({
  agentId: "juniper", paths: ["db"], code: "agent-database-inspection-pending", reason: "pending", repairHint: "wait",
  ...(preparation ? { preparation } : {}),
});

function fakeEngine(initial: unknown) {
  const state = { refusal: initial as unknown, retrying: true, calls: [] as Array<{ method: string; params: unknown }> };
  const engine: WindowEngine = {
    sessionKey: "agent:juniper:main",
    scopes: [],
    onEvent: () => () => {},
    request: (async (method: string, params?: unknown) => {
      state.calls.push({ method, params });
      if (method === "agents.list") return { agents: [{ id: "juniper", name: "Juniper", ...(state.refusal ? { status: "degraded", admissionRefusal: state.refusal } : {}) }] };
      if (method === "agents.retryStartup") return { agentId: "juniper", retrying: state.retrying };
      if (method === "sessions.list") return { sessions: [] };
      if (method === "users.prefs.get") return { status: "ok", entries: {} };
      if (method === "session.reactions.list") return { reactions: {} };
      if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
      return {};
    }) as WindowEngine["request"],
  };
  return { engine, state };
}

let root: Root | undefined;
async function render(engine: WindowEngine, props: Partial<Parameters<typeof Thread>[0]>): Promise<HTMLElement> {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<Thread name="Juniper" history={[]} live={[]} pendingUser={null} running={false} engine={engine} onAnswer={() => {}} {...props} />));
  return container;
}

const statusText = (view: HTMLElement) => view.querySelector('[data-testid="preparation-status"]')?.textContent ?? "";
const retryButton = (view: HTMLElement) => [...view.querySelectorAll("button")].find((button) => button.textContent === "Retry now");

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

it("says a retrying Trunk failed and is retrying, with Retry now, after many failures too, and opens the conversation once it is ready", async () => {
  // Twelve failures and two restarts from scratch: the engine keeps retrying, so the line still offers Retry now.
  const { engine, state } = fakeEngine(refusal({ state: "retrying", failures: 12, restarts: 2 }));
  const onStartupReady = vi.fn();
  const view = await render(engine, { preparationError: preparationTimeoutLabel("Juniper"), onStartupReady });
  await vi.waitFor(() => expect(statusText(view)).toContain("Getting Juniper ready failed, retrying…"));
  expect(statusText(view)).not.toContain("needs a restart");
  expect(retryButton(view)).toBeDefined();

  state.refusal = null;
  await act(async () => retryButton(view)!.click());
  expect(state.calls).toContainEqual({ method: "agents.retryStartup", params: { agentId: "juniper" } });
  await vi.waitFor(() => expect(onStartupReady).toHaveBeenCalled());
});

it("says so when the engine answers that it had nothing to retry, and reads the Trunk again", async () => {
  const { engine, state } = fakeEngine(refusal({ state: "retrying", failures: 1, restarts: 0 }));
  const view = await render(engine, { preparationError: PENDING });
  await vi.waitFor(() => expect(retryButton(view)).toBeDefined());
  state.retrying = false;
  const listsBefore = state.calls.filter((call) => call.method === "agents.list").length;
  await act(async () => retryButton(view)!.click());
  await vi.waitFor(() => expect(view.querySelector('[role="alert"]')?.textContent).toBe("Couldn't retry: the engine isn't getting this Trunk ready any more"));
  await vi.waitFor(() => expect(state.calls.filter((call) => call.method === "agents.list").length).toBeGreaterThan(listsBefore));
});

it("says a Trunk whose startup stopped retrying needs attention, without a spinner, and its Retry starts it again", async () => {
  // Five failed starts in a row (thirty failures, four restarts): the engine stopped retrying on its own.
  const { engine, state } = fakeEngine(refusal({ state: "needs-attention", failures: 30, restarts: 4 }));
  const onStartupReady = vi.fn();
  const view = await render(engine, { preparationError: PENDING, onStartupReady });
  await vi.waitFor(() => expect(statusText(view)).toContain("Juniper needs attention: getting it ready kept failing."));
  expect(statusText(view)).not.toContain("retrying…");
  expect(view.querySelector('[data-testid="preparation-status"] .preparation-spinner')).toBeNull();
  const retry = [...view.querySelectorAll("button")].find((button) => button.textContent === "Retry");
  expect(retry).toBeDefined();

  state.refusal = null;
  await act(async () => retry!.click());
  expect(state.calls).toContainEqual({ method: "agents.retryStartup", params: { agentId: "juniper" } });
  await vi.waitFor(() => expect(onStartupReady).toHaveBeenCalled());
});

it("keeps the plain getting-ready line, without a button, while the first preparation is still running", async () => {
  const { engine } = fakeEngine(refusal());
  const view = await render(engine, { preparationError: PENDING });
  await vi.waitFor(() => expect(statusText(view)).toContain("Getting Juniper ready…"));
  expect(view.querySelector('[data-testid="preparation-status"] button')).toBeNull();
});
