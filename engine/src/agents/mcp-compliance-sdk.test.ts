import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { McpComplianceTransport } from "./mcp-compliance-transport.js";

describe("real SDK output-schema interoperability", () => {
  it.each([false, true])("missing structuredContent with repair=%s", async (repair) => {
    const [inbound, outbound] = InMemoryTransport.createLinkedPair();
    const server = new Server(
      { name: "legacy-test-server", version: "1" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "legacy",
          inputSchema: { type: "object" },
          outputSchema: {
            type: "object",
            properties: { answer: { type: "number" } },
            required: ["answer"],
          },
        },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [{ type: "text", text: '{"answer":42}' }],
    }));
    const client = new Client({ name: "branch-test-client", version: "1" });
    try {
      await Promise.all([
        server.connect(inbound),
        client.connect(repair ? new McpComplianceTransport(outbound) : outbound),
      ]);
      await client.listTools();
      if (repair) {
        expect(await client.callTool({ name: "legacy" })).toMatchObject({
          structuredContent: { answer: 42 },
        });
      } else {
        await expect(client.callTool({ name: "legacy" })).rejects.toThrow();
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
