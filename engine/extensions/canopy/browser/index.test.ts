import "./test/dom.setup.ts";
import type { ControlUiAccessory } from "branch/plugin-sdk/control-ui";
import { createDeferred } from "branch/plugin-sdk/extension-shared";
import { expect, it, vi } from "vitest";
import canopyPlugin from "./index.ts";
import { createGatewaySession, createCanopyCard } from "./lib/canopy/test/index-helpers.ts";
import { canopyTestHost } from "./test/host.setup.ts";
import { createViewContext } from "./test/host.ts";

it("keeps an existing reassigned session card available without registering a session action", async () => {
  const fixture = canopyTestHost();
  const { host, connection, registrations } = fixture;
  connection.connected = true;
  const session = createGatewaySession({ key: "agent:writer:dashboard:captured" });
  const card = createCanopyCard({
    title: "Previously captured conversation",
    sessionKey: session.key,
    agentId: "main",
    metadata: { automation: { boardId: "ops" } },
  });
  Object.assign(host.sessions, { rows: [session], selectedKey: session.key });
  Object.assign(host.agents, {
    rows: [{ id: "main" }, { id: "writer" }],
    selectedId: "writer",
    scopeId: "writer",
  });
  const boards = [{ id: "ops", total: 1, active: 1, archived: 0, byStatus: { todo: 1 } }];
  let currentCard = card;
  const request = vi.fn(async (method: string) => {
    if (method === "canopy.cards.list") {
      return { cards: [currentCard], boards };
    }
    if (method === "canopy.boards.list") {
      return { boards };
    }
    return { tasks: [] };
  });
  host.request = request as typeof host.request;
  const dispose = await canopyPlugin.activate(host);
  const container = document.createElement("div");
  let disposeAccessory = () => {};
  try {
    await vi.waitFor(() => expect(registrations.has("navigation/board-ops")).toBe(true));
    const context = { sessionKey: session.key, session };
    expect([...registrations.keys()].filter((key) => key.startsWith("action/"))).toEqual([]);

    const accessory = registrations.get("accessory/linked-card") as ControlUiAccessory;
    const mounted = accessory.mount(container, createViewContext(host, context));
    disposeAccessory = () => mounted?.dispose?.();
    await vi.waitFor(() => expect(container.textContent).toContain(card.title));
    expect(request.mock.calls).toEqual([["canopy.cards.list", {}]]);

    // The session accessory follows the catalog's refreshed card state.
    currentCard = {
      ...card,
      title: "Current captured conversation",
      updatedAt: card.updatedAt + 1,
    };
    request.mockClear();
    fixture.emit("plugin.canopy.changed", {});
    await vi.waitFor(() => expect(container.textContent).toContain(currentCard.title));
    expect(container.textContent).toContain(currentCard.title);
  } finally {
    disposeAccessory();
    dispose?.();
  }
});

it("keeps accessories on the same recovered snapshot and retires pending activation reads", async () => {
  const fixture = canopyTestHost();
  const { host, connection, registrations } = fixture;
  connection.connected = true;
  const session = createGatewaySession();
  const card = createCanopyCard({ title: "Linked card", sessionKey: session.key });
  const boards = [{ id: "default", total: 1, active: 1, archived: 0, byStatus: { todo: 1 } }];
  const request = vi.fn().mockResolvedValue({ cards: [card], boards });
  host.request = request as typeof host.request;
  const dispose = await canopyPlugin.activate(host);
  const container = document.createElement("div");
  const context = { sessionKey: session.key, session };
  const accessory = registrations.get("accessory/linked-card") as ControlUiAccessory;
  const mounted = accessory.mount(container, createViewContext(host, context));
  let disposed = false;
  try {
    await vi.waitFor(() => expect(container.textContent).toContain(card.title));
    expect([...registrations.keys()].filter((key) => key.startsWith("action/"))).toEqual([]);

    request.mockRejectedValueOnce(new Error("Temporary read failure"));
    fixture.emit("plugin.canopy.changed", {});
    await vi.waitFor(() => expect(request.mock.settledResults[1]?.type).toBe("rejected"));
    expect(container.textContent).toContain(card.title);

    request.mockResolvedValueOnce({ cards: [{ ...card, metadata: { archivedAt: 1 } }], boards });
    fixture.emit("plugin.canopy.changed", {});
    await vi.waitFor(() => expect(container.querySelector("a")).toBeNull());

    fixture.emit("plugin.canopy.changed", {});
    await vi.waitFor(() => expect(container.textContent).toContain(card.title));

    const pending = createDeferred<unknown>();
    request.mockReturnValueOnce(pending.promise);
    const count = request.mock.calls.length;
    fixture.emit("plugin.canopy.changed", {});
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(count + 1));
    mounted?.dispose?.();
    dispose?.();
    disposed = true;
    const invalidations = vi.mocked(host.ui.invalidate).mock.calls.length;
    pending.resolve({ cards: [{ ...card, title: "Retired response" }], boards });
    await pending.promise;
    fixture.emit("plugin.canopy.changed", {});
    fixture.notify();
    expect(request).toHaveBeenCalledTimes(count + 1);
    expect(vi.mocked(host.ui.invalidate).mock.calls.length).toBe(invalidations);
    expect(container.childElementCount).toBe(0);
    expect(fixture.events.get("plugin.canopy.changed")?.size).toBe(0);
    expect(fixture.listeners.size).toBe(0);
  } finally {
    if (!disposed) {
      mounted?.dispose?.();
      dispose?.();
    }
  }
});
