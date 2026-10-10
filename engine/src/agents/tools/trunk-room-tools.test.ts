import { describe, expect, it, vi } from "vitest";
import { createRoomListTool, createRoomPostTool, createRoomReadTool } from "./trunk-room-tools.js";

function recorder() {
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const callGateway = vi.fn(
    async (request: { method: string; params: Record<string, unknown> }) => {
      requests.push(request);
      return { ok: true };
    },
  );
  return { requests, callGateway: callGateway as never };
}

describe("Trunk room tools", () => {
  it("room_list asks for the caller's rooms with no params", async () => {
    const { requests, callGateway } = recorder();
    await createRoomListTool({ callGateway }).execute("c1", {}, undefined);
    expect(requests).toEqual([{ method: "rooms.trunk.list", params: {} }]);
  });

  it("room_read passes roomId, cursor and limit through", async () => {
    const { requests, callGateway } = recorder();
    await createRoomReadTool({ callGateway }).execute(
      "c2",
      { roomId: "room-1", cursor: 4, limit: 20 },
      undefined,
    );
    expect(requests[0]).toEqual({
      method: "rooms.trunk.read",
      params: { roomId: "room-1", cursor: 4, limit: 20 },
    });
  });

  it("room_post maps text to the gateway's message field and never sends a sender", async () => {
    const { requests, callGateway } = recorder();
    await createRoomPostTool({ callGateway }).execute(
      "c3",
      { roomId: "room-1", text: "PR 900 ready" },
      undefined,
    );
    expect(requests).toEqual([
      { method: "rooms.trunk.post", params: { roomId: "room-1", message: "PR 900 ready" } },
    ]);
    expect(JSON.stringify(requests[0])).not.toMatch(/actor|agentId|sender/);
  });

  it("room_post rejects a blank text before calling the gateway", async () => {
    const { callGateway } = recorder();
    await expect(
      createRoomPostTool({ callGateway }).execute("c4", { roomId: "room-1", text: "" }, undefined),
    ).rejects.toThrow();
    expect(callGateway).not.toHaveBeenCalled();
  });
});
