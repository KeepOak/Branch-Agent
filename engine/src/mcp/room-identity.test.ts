import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { OutsidePresence } from "./outside-presence.js";
import { registerTrunkMcpTools } from "./trunk-tools.js";

describe("Graft room identity", () => {
  it("cached Disconnect refusals explain how the owner can allow the agent again", async () => {
    const presence = new OutsidePresence(async () => {
      throw new Error("Scout was disconnected in Settings › Grafts.");
    });
    presence.start({ id: "scout", name: "Scout" });
    try {
      await expect(presence.identity()).rejects.toThrow(
        /disconnected.*Ask the owner.*reconnect Graft/,
      );
      await expect(presence.assertAllowed()).rejects.toThrow(
        /Ask the owner.*Settings.*reconnect Graft/,
      );
    } finally {
      presence.stop();
    }
  });

  it("waits for an activity-triggered registration retry before returning the room identity", async () => {
    let calls = 0;
    let finish!: (result: { contact: { id: string } }) => void;
    const presence = new OutsidePresence(async () => {
      if (++calls === 1) {
        throw new Error("Gateway connection interrupted");
      }
      return new Promise<{ contact: { id: string } }>((resolve) => {
        finish = resolve;
      });
    });
    presence.start({ id: "scout", name: "Scout" });
    try {
      await presence.identity();
      presence.activity("Posting in a group chat");
      let returned = false;
      const identity = presence.identity().then((value) => {
        returned = true;
        return value;
      });
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(returned).toBe(false);
      expect(calls).toBe(2);
      finish({ contact: { id: "a2a:scout-2" } });
      expect(await identity).toMatchObject({ id: "scout-2", name: "Scout" });
    } finally {
      finish?.({ contact: { id: "a2a:scout-2" } });
      presence.stop();
    }
  });

  it("retries a failed hello so the next room join and post use the registered agent", async () => {
    let hellos = 0;
    const presence = new OutsidePresence(async () => {
      if (++hellos === 1) {
        throw new Error("Gateway connection interrupted");
      }
      return { contact: { id: "a2a:scout-2" } };
    });
    presence.start({ id: "scout", name: "Scout" });
    await presence.identity();
    const calls: Array<{ method: string; params: unknown }> = [];
    const server = new McpServer({ name: "branch", version: "test" });
    registerTrunkMcpTools(
      server,
      {
        request: async <T>(method: string, params: Record<string, unknown>) => {
          calls.push({ method, params });
          return {} as T;
        },
        onGatewayEvent: () => () => undefined,
      },
      { outsideAgent: () => presence.identity() },
    );
    const client = new Client({ name: "Scout", version: "test" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(a), client.connect(b)]);
      expect(
        (await client.callTool({ name: "room_join", arguments: { room_id: "builders" } })).isError,
      ).toBeFalsy();
      expect(
        (
          await client.callTool({
            name: "room_post",
            arguments: { room_id: "builders", text: "Status update" },
          })
        ).isError,
      ).toBeFalsy();
      expect(calls).toMatchObject([
        {
          method: "rooms.members.add",
          params: { kind: "a2a", id: "scout-2", outsideAgent: { id: "scout-2", name: "Scout" } },
        },
        { method: "rooms.send", params: { outsideAgent: { id: "scout-2", name: "Scout" } } },
      ]);
    } finally {
      presence.stop();
      await client.close();
      await server.close();
    }
  });

  it.each(["room_join", "room_post"])(
    "%s refuses an unknown identity with a reconnect action instead of posting as owner",
    async (name) => {
      const calls: string[] = [];
      const server = new McpServer({ name: "branch", version: "test" });
      registerTrunkMcpTools(
        server,
        {
          request: async <T>(method: string) => {
            calls.push(method);
            return {} as T;
          },
          onGatewayEvent: () => () => undefined,
        },
        { outsideAgent: () => undefined },
      );
      const client = new Client({ name: "Scout", version: "test" });
      const [a, b] = InMemoryTransport.createLinkedPair();
      try {
        await Promise.all([server.connect(a), client.connect(b)]);
        const result = await client.callTool({
          name,
          arguments: { room_id: "builders", ...(name === "room_post" ? { text: "Hello" } : {}) },
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toMatch(/Reconnect Graft/);
        expect(JSON.stringify(result.content)).not.toMatch(/update Branch/);
        expect(calls).toEqual([]);
      } finally {
        await client.close();
        await server.close();
      }
    },
  );
});
