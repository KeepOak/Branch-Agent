// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Block } from "../../thread/model";
import { ActivityTab } from "./ActivityTab";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
async function render(engine: WindowEngine, focusHelpers = 0, blocks: Block[] = []) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root!.render(<ActivityTab engine={engine} name="Owner" blocks={blocks} running={false} level="regular" focusHelpers={focusHelpers} onError={() => {}} />));
}

function backend(initialCost: unknown) {
  const listeners = new Set<Parameters<WindowEngine["onEvent"]>[0]>();
  const state = { status: "running", cost: initialCost };
  const request = vi.fn().mockImplementation(async (method: string, params: object = {}) => {
    if (method === "sessions.list") return { sessions: Reflect.get(params, "spawnedBy") === "agent:main:main"
      ? [{ key: "agent:main:subagent:helper", spawnedBy: "agent:main:main", status: state.status, label: "Reader", model: "connected", modelProvider: "openai" }] : [] };
    if (method === "sessions.usage") return { totals: { totalCost: state.cost } };
    if (method === "chat.history") return { messages: [{ role: "user", content: [{ type: "text", text: "Read the latest brief" }] }, { role: "assistant", content: [{ type: "thinking", thinking: "Checking the brief" }] }] };
    if (method === "canopy.cards.list") return { cards: [] };
    if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
    throw new Error(`Unexpected method ${method}`);
  });
  const engine: WindowEngine = { sessionKey: "agent:main:main", scopes: [], request,
    onEvent: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { engine, request, state, changed: () => listeners.forEach((listener) => listener({ event: "sessions.changed", payload: { session: { key: "agent:main:subagent:helper", spawnedBy: "agent:main:main" } } })) };
}

describe("actual Activity helper measured facts", () => {
  it("shows one helpers section with status marks instead of helper faces", async () => {
    await render(backend(0.1).engine);
    expect(container.querySelectorAll('section[aria-label="Helpers on this task"]')).toHaveLength(1);
    expect(container.querySelectorAll(".hp-card-pn")).toHaveLength(1);
    expect(container.querySelector(".hp-card-pn .hp-mark-pn svg")).not.toBeNull();
    expect(container.querySelector(".hp-card-pn .character-face, .hp-card-pn .pebble")).toBeNull();
  });
  it("uses plain step words and hides machine JSON from Activity", async () => {
    const fixture = backend(0.1);
    await render(fixture.engine, 0, [{ kind: "step", key: "raw", tool: "bash", title: "sleep 25; echo second", detail: '{"status":"completed","telemetry":{}}', status: "ok" }]);
    expect(container.querySelector(".tl-pn")?.textContent).toContain("Ran a command");
    expect(container.querySelector(".tl-pn")?.textContent).not.toContain("telemetry");
    expect(container.querySelector(".tl-pn")?.textContent).not.toContain("sleep 25");
  });
  it("scrolls to the helper section when its thread chip opens Activity", async () => {
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    const fixture = backend(0.1);
    await render(fixture.engine, 1);
    expect(container.querySelector(".hp-pn")).not.toBeNull();
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  });
  it("refreshes measured spend when the same helper key finishes", async () => {
    const fixture = backend(0.1);
    await render(fixture.engine);
    expect(container.querySelector(".hp-m-pn")?.textContent).toBe("$0.10");
    expect(fixture.request).toHaveBeenCalledWith("sessions.usage", { key: "agent:main:subagent:helper", range: "all" });
    expect(container.querySelector(".hp-job-pn")?.textContent).toContain("Read the latest brief");
    expect(container.querySelector(".hp-think-pn summary")?.textContent).toBe("What it's thinking");
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
