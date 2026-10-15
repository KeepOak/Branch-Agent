import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TrunkGateway } from "./trunk-tools.js";

function ok(text: string, structuredContent: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

/**
 * The Trunk job queue for an outside agent (the Coordinator): add briefed jobs, see who holds what, mark a job
 * done or put a stuck claim back. Branch itself hands the top job to a Trunk whose run ends while it is idle.
 */
export function registerQueueMcpTools(server: McpServer, gw: TrunkGateway): void {
  server.tool(
    "queue_add",
    "Add a briefed job to the Trunk queue. An idle Trunk takes the highest-priority job when its run ends, in a new thread titled with the job title.",
    {
      title: z.string().min(1).max(100),
      brief_text: z.string().min(1),
      priority: z.number().int().optional().describe("Higher runs first; default 0"),
    },
    async ({ title, brief_text, priority }) => {
      const result = await gw.request<Record<string, unknown>>("trunks.queue.add", {
        title,
        brief_text,
        ...(priority !== undefined ? { priority } : {}),
      });
      return ok(`queued ${title}`, result);
    },
  );

  server.tool(
    "queue_list",
    "List the Trunk queue, highest priority first: each job's status (queued, claimed, needs_attention, released, blocked or done) and the Trunk that holds it.",
    {},
    async () => {
      const result = await gw.request<Record<string, unknown>>("trunks.queue.list", {});
      const items = Array.isArray(result.items) ? result.items : [];
      // A job whose run could not be stopped is named in plain English, so it is not missed in the list.
      const attention = items.flatMap((item) => {
        const row = item as { status?: unknown; attention_reason?: unknown };
        return row.status === "needs_attention" && typeof row.attention_reason === "string"
          ? [row.attention_reason]
          : [];
      });
      return ok([`${items.length} queued jobs`, ...attention].join("\n"), { items });
    },
  );

  server.tool(
    "queue_done",
    "Mark a queued job done. The Trunk that held it takes the next job if it is idle.",
    { id: z.string().min(1) },
    async ({ id }) => {
      const result = await gw.request<Record<string, unknown>>("trunks.queue.done", { id });
      return ok("done", result);
    },
  );

  server.tool(
    "queue_release",
    "Put a stuck claim back in the queue so another Trunk can take the job.",
    { id: z.string().min(1) },
    async ({ id }) => {
      const result = await gw.request<Record<string, unknown>>("trunks.queue.release", { id });
      return ok("released", result);
    },
  );
}
