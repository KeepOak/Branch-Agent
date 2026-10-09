import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Read-only status tools for `branch mcp serve`: skills, memory and the computer-use capability.
 * Each one calls a single read method on the gateway and returns its answer unchanged. Nothing here
 * writes, installs, activates or runs anything.
 */
export type StatusGateway = {
  request<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});

function ok(text: string, structuredContent: Rec) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

/** Passes agentId only when the caller named one, so the gateway applies its own default otherwise. */
function agentParams(agentId: string | undefined): Rec {
  return agentId ? { agentId } : {};
}

export function registerTrunkStatusTools(server: McpServer, gw: StatusGateway): void {
  server.tool(
    "skills_status",
    "List the skills a Trunk can see: installed, enabled and eligible skills with their source. Read-only.",
    { agentId: z.string().min(1).optional() },
    async ({ agentId }) => {
      const result = rec(await gw.request("skills.status", agentParams(agentId)));
      const skills = Array.isArray(result.skills) ? result.skills : [];
      return ok(`${skills.length} skills`, result);
    },
  );

  server.tool(
    "memory_status",
    "Show a Trunk's memory: how many entries it holds and where they live (its own, or the project's shared memory). Read-only.",
    { agentId: z.string().min(1).optional() },
    async ({ agentId }) => {
      const result = rec(await gw.request("memory.status", agentParams(agentId)));
      return ok("memory status", result);
    },
  );

  server.tool(
    "computer_status",
    "Whether Branch's computer control is configured and available, and which actions and targets it supports. Read-only; it does not take a screenshot or act.",
    {},
    async () => {
      const result = rec(await gw.request("computer.status", {}));
      return ok(
        result.available === true ? "computer control available" : "computer control unavailable",
        result,
      );
    },
  );
}
