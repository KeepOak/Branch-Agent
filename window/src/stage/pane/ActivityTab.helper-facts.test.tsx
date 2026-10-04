// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { ActivityTab } from "./ActivityTab";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
async function render(engine: WindowEngine) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root!.render(<ActivityTab engine={engine} name="Owner" blocks={[]} running={false} level="regular" onError={() => {}} />));
}

function backend(initialCost: unknown) {
  const listeners = new Set<Parameters<WindowEngine["onEvent"]>[0]>();
  const state = { status: "running", cost: initialCost };
  const request = vi.fn().mockImplementation(async (method: string, params: object = {}) => {
    if (method === "sessions.list") return { sessions: Reflect.get(params, "spawnedBy") === "agent:main:main"
      ? [{ key: "agent:main:subagent:helper", spawnedBy: "agent:main:main", status: state.status, label: "Reader", model: "connected", modelProvider: "openai" }] : [] };
    if (method === "sessions.usage") return { totals: { totalCost: state.cost } };
    if (method === "canopy.cards.list") return { cards: [] };
    if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
    throw new Error(`Unexpected method ${method}`);
  });
  const engine: WindowEngine = { sessionKey: "agent:main:main", scopes: [], request,
    onEvent: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { engine, state, changed: () => listeners.forEach((listener) => listener({ event: "sessions.changed", payload: { session: { key: "agent:main:subagent:helper", spawnedBy: "agent:main:main" } } })) };
}

describe("actual Activity helper measured facts", () => {
  it("refreshes measured spend when the same helper key finishes", async () => {
    const fixture = backend(0.1);
    await render(fixture.engine);
    expect(container.querySelector(".hp-m-pn")?.textContent).toBe("$0.10");
    fixture.state.status = "done";
    fixture.state.cost = 1.25;
    await act(async () => fixture.changed());
    expect(container.querySelector(".hp-card-pn")?.textContent).toContain("Done");
    expect(container.querySelector(".hp-m-pn")?.textContent).toBe("$1.25");
  });
  it.each([undefined, NaN, Infinity, -1])("does not invent a cost for %s", async (cost) => {
    await render(backend(cost).engine);
    expect(container.querySelector(".hp-m-pn")).toBeNull();
  });
  it("does not invent an activity observation time for an empty backend snapshot", async () => {
    await render(backend(0.1).engine);
    expect(container.querySelector(".hg-pn")?.textContent).not.toContain("as of");
  });
});
