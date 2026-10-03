import "./test/dom.setup.ts";
import { expect, it, vi } from "vitest";
import { createCanopyCapability } from "./lib/canopy/capability.ts";
import { createCanopyCard } from "./lib/canopy/test/index-helpers.ts";
import { createCanopyPage } from "./pages/canopy/canopy-page.ts";
import { createCanopySessionAccessory } from "./session-accessory.ts";
import { canopyTestHost } from "./test/host.setup.ts";
import { createViewContext } from "./test/host.ts";

it("reveals a reassigned linked card without changing the selected chat agent", async () => {
  const { host, connection } = canopyTestHost();
  connection.connected = true;
  Object.assign(host.agents, {
    rows: [{ id: "main" }, { id: "writer" }],
    defaultId: "main",
    selectedId: "writer",
    scopeId: "writer",
  });
  const sessionKey = "agent:writer:dashboard:1";
  const card = createCanopyCard({
    title: "Reassigned writer conversation",
    agentId: "main",
    sessionKey,
    metadata: { automation: { boardId: "ops" } },
  });
  const request = vi.fn(async (method: string) =>
    method === "canopy.cards.list"
      ? {
          cards: [card],
          boards: [{ id: "ops", total: 1, active: 1, archived: 0, byStatus: { todo: 1 } }],
        }
      : { tasks: [] },
  );
  host.request = request as typeof host.request;
  const canopy = createCanopyCapability();
  canopy.state.cards = [card];
  const container = document.createElement("div");
  const destination = document.createElement("div");
  document.body.append(container, destination);
  let disposeDestination = () => {};
  vi.mocked(host.navigation.openPage).mockImplementation(({ path }) => {
    disposeDestination();
    const mounted = createCanopyPage(canopy)(
      destination,
      createViewContext(host, { boardId: path?.[0] ?? "__all__" }),
    );
    disposeDestination = () => mounted?.dispose?.();
  });
  const mounted = createCanopySessionAccessory(canopy)(
    container,
    createViewContext(host, { sessionKey }),
  );
  try {
    await vi.waitFor(() => expect(container.textContent).toContain(card.title));
    container.querySelector("a")!.click();

    await vi.waitFor(() =>
      expect(destination.querySelector(".canopy-board")?.textContent).toContain(card.title),
    );
    expect(host.agents.scopeId).toBeNull();
    expect(host.agents.selectedId).toBe("writer");
  } finally {
    mounted?.dispose?.();
    disposeDestination();
    canopy.dispose();
    container.remove();
    destination.remove();
  }
});

it.each(["global", "unknown"])(
  "does not associate a bare %s card with an ambient pane owner",
  (sessionKey) => {
    const fixture = canopyTestHost();
    fixture.connection.connected = true;
    const canopy = createCanopyCapability();
    canopy.state.cards = [createCanopyCard({ sessionKey, agentId: "main" })];
    const container = document.createElement("div");
    const mounted = createCanopySessionAccessory(canopy)(
      container,
      createViewContext(fixture.host, { sessionKey, agentId: "writer" }),
    );
    try {
      expect(container.querySelector("a")).toBeNull();
      expect(fixture.host.navigation.openPage).not.toHaveBeenCalled();
    } finally {
      mounted?.dispose?.();
      canopy.dispose();
    }
  },
);

it("renders shared card updates and retires navigation while hidden or disposed", async () => {
  const fixture = canopyTestHost();
  fixture.connection.connected = true;
  const sessionKey = "agent:main:canopy-card";
  const card = createCanopyCard({
    title: "Ship dashboard stitch",
    status: "review",
    sessionKey,
    metadata: { automation: { boardId: "platform" } },
  });
  const canopy = createCanopyCapability();
  canopy.state.cards = [card];
  const container = document.createElement("div");
  const context = createViewContext(fixture.host, { sessionKey });
  const mounted = createCanopySessionAccessory(canopy)(container, context);
  try {
    await vi.waitFor(() => expect(container.textContent).toContain(card.title));
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/canopy/platform");
    expect(link.textContent).toContain("Review");
    link.click();
    expect(fixture.host.navigation.openPage).toHaveBeenCalledWith({
      id: "canopy",
      path: ["platform"],
    });
    mounted?.update?.({ ...context, presented: false, props: { sessionKey: "agent:main:next" } });
    expect(container.querySelector("a")).toBeNull();
    link.click();
    expect(fixture.host.navigation.openPage).toHaveBeenCalledOnce();
    canopy.state.cards = [
      createCanopyCard({ title: "Next card", sessionKey: "agent:main:next" }),
    ];
    canopy.notify();
    expect(container.querySelector("a")).toBeNull();
    mounted?.update?.({ ...context, props: { sessionKey: "agent:main:next" } });
    expect(container.textContent).toContain("Next card");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/canopy/default");
    expect(container.textContent).not.toContain(card.title);
    expect(fixture.host.request).not.toHaveBeenCalled();
  } finally {
    mounted?.dispose?.();
  }
  canopy.notify();
  expect(container.childElementCount).toBe(0);
  expect(fixture.listeners.size).toBe(0);
  canopy.dispose();
});
