import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerQueueMcpTools } from "./queue-tools.js";
import type { TrunkGateway } from "./trunk-tools.js";

type ToolResult = { content: Array<{ text: string }> };
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

/** Captures each registered tool's handler so the test can call it directly. */
function captureTools(gw: TrunkGateway): Map<string, ToolHandler> {
  const tools = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _description: string, _schema: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  registerQueueMcpTools(server, gw);
  return tools;
}

describe("queue_list", () => {
  it("names a job that needs a person in plain English, in its summary line", async () => {
    const gw = {
      request: async () => ({
        items: [
          {
            id: "job-1",
            title: "stuck job",
            status: "needs_attention",
            claimed_by: "builder-birch",
            attention_reason: "Couldn't stop stuck job on builder-birch; needs a person.",
          },
          { id: "job-2", title: "queued job", status: "queued" },
        ],
      }),
    } as unknown as TrunkGateway;
    const list = captureTools(gw).get("queue_list");

    const result = await list!({});

    expect(result.content[0].text).toBe(
      "2 queued jobs\nCouldn't stop stuck job on builder-birch; needs a person.",
    );
  });

  it("reports only the job count when nothing needs a person", async () => {
    const gw = {
      request: async () => ({ items: [{ id: "job-1", title: "a", status: "queued" }] }),
    } as unknown as TrunkGateway;
    const result = await captureTools(gw).get("queue_list")!({});
    expect(result.content[0].text).toBe("1 queued jobs");
  });
});
