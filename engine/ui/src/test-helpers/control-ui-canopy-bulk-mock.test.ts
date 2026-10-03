import { expect } from "vitest";
import { createControlUiMockGatewayInitScript } from "./control-ui-e2e.ts";
import { installCanopyBoardMock } from "./control-ui-canopy-mocks.ts";
import { flushMockTimers, mockGatewayTest as it } from "./mock-gateway-page.test-support.ts";

it.for(["move", "archive", "delete"] as const)(
  "rejects stale %s through the serialized Canopy mock without changing cards or emitting events",
  async (action, { gatewayPage }) => {
    const card = {
      id: "card",
      title: "Latest title",
      status: "todo",
      priority: "normal",
      labels: [],
      position: 1000,
      createdAt: 1,
      updatedAt: 10,
      metadata: { automation: { boardId: "default" } },
    };
    const seed = {
      boards: [{ id: "default" }],
      cards: [card],
      tasks: [],
      methodResponses: { "canopy.cards.list": { statuses: ["todo", "done"] } },
    };
    gatewayPage.execute(createControlUiMockGatewayInitScript());
    gatewayPage.execute(`(${installCanopyBoardMock.toString()})(${JSON.stringify(seed)})`);
    const socket = gatewayPage.connect();
    await flushMockTimers();
    const before = await socket.request("before", "canopy.cards.list", {});
    const events = socket.frames.filter((frame) => frame.type === "event");
    const params = { id: card.id, status: "done", position: 2000, archived: true };
    await socket.request("stale", `canopy.cards.${action}`, { ...params, expectedUpdatedAt: 9 });
    expect(socket.frames.find((frame) => frame.id === "stale")).toMatchObject({
      ok: false,
      error: { code: "canopy_conflict", details: { type: "canopy_card_conflict", card } },
    });
    expect(socket.frames.filter((frame) => frame.type === "event")).toEqual(events);
    expect(await socket.request("unchanged", "canopy.cards.list", {})).toEqual(before);
    const result = await socket.request("current", `canopy.cards.${action}`, {
      ...params,
      expectedUpdatedAt: card.updatedAt,
    });
    if (action === "delete") {
      expect(result).toEqual({ deleted: true });
      expect((await socket.request("deleted", "canopy.cards.list", {})).cards).toEqual([]);
    } else {
      expect(result).toMatchObject({ card: { updatedAt: expect.any(Number) } });
      expect(result).not.toMatchObject({ card: { updatedAt: card.updatedAt } });
      if (action === "move") {
        expect(result).toMatchObject({ card: { status: "done", position: 2000 } });
      } else {
        expect(result).toMatchObject({ card: { metadata: { archivedAt: expect.any(Number) } } });
      }
    }
    expect(socket.frames.filter((frame) => frame.type === "event")).toHaveLength(events.length + 1);
  },
);

it("returns link cleanup revisions so the next guarded mock delete can succeed", async ({
  gatewayPage,
}) => {
  const parent = {
    id: "parent",
    title: "Parent",
    status: "todo",
    priority: "normal",
    labels: [],
    position: 1000,
    createdAt: 1,
    updatedAt: 10,
    metadata: { automation: { boardId: "default" } },
  };
  const child = {
    ...parent,
    id: "child",
    metadata: {
      ...parent.metadata,
      links: [{ id: "link", type: "parent", targetCardId: parent.id, createdAt: 1 }],
    },
  };
  const seed = {
    boards: [{ id: "default" }],
    cards: [parent, child],
    tasks: [],
    methodResponses: { "canopy.cards.list": { statuses: ["todo", "done"] } },
  };
  gatewayPage.execute("Date.now = () => 10;");
  gatewayPage.execute(createControlUiMockGatewayInitScript());
  gatewayPage.execute(`(${installCanopyBoardMock.toString()})(${JSON.stringify(seed)})`);
  const socket = gatewayPage.connect();
  await flushMockTimers();
  expect(
    await socket.request("parent", "canopy.cards.delete", {
      id: parent.id,
      expectedUpdatedAt: 10,
    }),
  ).toEqual({
    deleted: true,
    referenceUpdates: [{ id: child.id, previousUpdatedAt: 10, updatedAt: 11 }],
  });
  expect((await socket.request("list", "canopy.cards.list", {})).cards).toEqual([
    { ...child, updatedAt: 11, metadata: parent.metadata },
  ]);
  expect(
    await socket.request("child", "canopy.cards.delete", {
      id: child.id,
      expectedUpdatedAt: 11,
    }),
  ).toEqual({ deleted: true });
  expect((await socket.request("empty", "canopy.cards.list", {})).cards).toEqual([]);
});
