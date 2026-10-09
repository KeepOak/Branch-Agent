// @vitest-environment jsdom
// A Trunk stuck getting ready says so in its conversation, with a Retry that reaches the engine
// (agents.retryStartup), and the conversation opens again by itself once the engine lets it through.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { preparationTimeoutLabel } from "../connect/preparation-status";
import { readStartupPreparation } from "../connect/startup-preparation";
import { Thread } from "./Thread";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });

const PENDING = "Agent juniper has not completed startup inspection and preparation; run branch doctor --fix";
const refusal = (preparation?: Record<string, unknown>) => ({
  agentId: "juniper", paths: ["db"], code: "agent-database-inspection-pending", reason: "pending", repairHint: "wait",
  ...(preparation ? { preparation } : {}),
});

function fakeEngine(initial: unknown) {
  const state = { refusal: initial as unknown, calls: [] as Array<{ method: string; params: unknown }> };
  const engine: WindowEngine = {
    sessionKey: "agent:juniper:main",
    scopes: [],
    onEvent: () => () => {},
    request: (async (method: string, params?: unknown) => {
      state.calls.push({ method, params });
      if (method === "agents.list") return { agents: [{ id: "juniper", name: "Juniper", ...(state.refusal ? { status: "degraded", admissionRefusal: state.refusal } : {}) }] };
      if (method === "agents.retryStartup") return { agentId: "juniper", retrying: true };
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

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

it("reads a Trunk's startup state from agents.list", () => {
  const list = (r: unknown) => ({ agents: [{ id: "juniper", ...(r ? { admissionRefusal: r } : {}) }] });
  expect(readStartupPreparation(list(refusal()), "juniper")).toBe("preparing");
  expect(readStartupPreparation(list(refusal({ state: "retrying", failures: 2, restarts: 0 })), "juniper")).toBe("retrying");
  expect(readStartupPreparation(list(refusal({ state: "needs-restart", failures: 12, restarts: 1 })), "juniper")).toBe("needs-restart");
  expect(readStartupPreparation(list(null), "juniper")).toBeNull();
  expect(readStartupPreparation(list({ ...refusal(), code: "agent-database-inspection-failed" }), "juniper")).toBeNull();
});

it("says a Trunk needs a restart, restarts its preparation from Restart, and opens the conversation once it is ready", async () => {
  const { engine, state } = fakeEngine(refusal({ state: "needs-restart", failures: 12, restarts: 1 }));
  const onStartupReady = vi.fn();
  const view = await render(engine, { preparationError: preparationTimeoutLabel("Juniper"), onStartupReady });
  await vi.waitFor(() => expect(view.querySelector('[data-testid="preparation-status"]')?.textContent).toContain("Juniper needs a restart."));
  const restart = [...view.querySelectorAll("button")].find((button) => button.textContent === "Restart");
  expect(restart).toBeDefined();

  state.refusal = refusal({ state: "retrying", failures: 12, restarts: 2 });
  await act(async () => restart!.click());
  expect(state.calls).toContainEqual({ method: "agents.retryStartup", params: { agentId: "juniper" } });
  await vi.waitFor(() => expect(view.querySelector('[data-testid="preparation-status"]')?.textContent).toContain("Getting Juniper ready failed, retrying…"));
  expect([...view.querySelectorAll("button")].some((button) => button.textContent === "Retry now")).toBe(true);
  expect(onStartupReady).not.toHaveBeenCalled();

  state.refusal = null;
  await act(async () => [...view.querySelectorAll("button")].find((button) => button.textContent === "Retry now")!.click());
  await vi.waitFor(() => expect(onStartupReady).toHaveBeenCalled());
});

it("keeps the plain getting-ready line, without a button, while the first preparation is still running", async () => {
  const { engine } = fakeEngine(refusal());
  const view = await render(engine, { preparationError: PENDING });
  await vi.waitFor(() => expect(view.querySelector('[data-testid="preparation-status"]')?.textContent).toContain("Getting Juniper ready…"));
  expect(view.querySelector('[data-testid="preparation-status"] button')).toBeNull();
});
