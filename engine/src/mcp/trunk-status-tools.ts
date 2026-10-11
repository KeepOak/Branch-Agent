import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Read-only status tools for `branch mcp serve`: skills, memory and computer control.
 * Each tool calls one existing read method and returns only an allowlisted projection of its answer,
 * so no host filesystem path leaves the gateway. The gateway methods are read paths, not pure reads:
 * - skills.status starts the workspace skills watcher and prepares remote skill connections on each call.
 * - memory.status opens the memory provider for the read and closes it afterwards.
 * - computer.status asks the computer service for its status. It does not act.
 */
export type StatusGateway = {
  request<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Absolute paths (POSIX or Windows) in free text become "[path]". */
const PATH_IN_TEXT = /(?:[A-Za-z]:[\\/]|\/)[^\s"'`<>|]+/g;
export function scrubPaths(text: string): string {
  return text.replace(PATH_IN_TEXT, "[path]");
}

function ok(text: string, structuredContent: Rec) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

/** Passes agentId only when the caller named one, so the gateway applies its own default otherwise. */
function agentParams(agentId: string | undefined): Rec {
  return agentId ? { agentId } : {};
}

/** skills.status: per-skill flags and counts. Names and sources only, no paths, no install commands. */
export function projectSkillsStatus(answer: Rec): Rec {
  const skills = (Array.isArray(answer.skills) ? answer.skills : []).map(rec).map((skill) => {
    const requirements = rec(skill.requirements);
    return {
      name: str(skill.name),
      source: str(skill.source),
      bundled: bool(skill.bundled),
      enabled: skill.disabled !== true,
      eligible: bool(skill.eligible) ?? bool(requirements.eligible),
      modelVisible: bool(skill.modelVisible),
      userInvocable: bool(skill.userInvocable),
      blockedByAgentFilter: bool(skill.blockedByAgentFilter),
      platformIncompatible: bool(skill.platformIncompatible),
    };
  });
  return {
    agentId: str(answer.agentId),
    total: skills.length,
    eligible: skills.filter((skill) => skill.eligible === true).length,
    modelVisible: skills.filter((skill) => skill.modelVisible === true).length,
    skills,
  };
}

/** memory.status: the gateway's version, provider and health, with file and chunk counts. Paths and custom fields are dropped. */
export function projectMemoryStatus(answer: Rec): Rec {
  const details = rec(rec(answer.details).legacy);
  const sourceCounts = (Array.isArray(details.sourceCounts) ? details.sourceCounts : [])
    .map(rec)
    .map((row) => ({
      source: str(row.source),
      files: num(row.files),
      chunks: num(row.chunks),
    }));
  const storage = rec(details.storage);
  return {
    agentId: str(answer.agentId),
    providerId: str(answer.providerId),
    status: str(answer.status),
    message: str(answer.message) === undefined ? undefined : scrubPaths(str(answer.message) ?? ""),
    backend: str(details.backend),
    provider: str(details.provider),
    model: str(details.model),
    files: num(details.files),
    chunks: num(details.chunks),
    dirty: bool(details.dirty),
    sourceCounts,
    storageEntries: num(storage.embeddingCacheEntries),
  };
}

/** computer.status: whether control is configured and available, and what it can do. Error text is reduced to a flag. */
export function projectComputerStatus(answer: Rec): Rec {
  const computerUse = rec(answer.computerUse);
  return {
    configured: bool(answer.configured) === true,
    available: bool(answer.available) === true,
    actions: Array.isArray(computerUse.actions)
      ? computerUse.actions.filter((a) => typeof a === "string")
      : [],
    targets: Array.isArray(computerUse.targets)
      ? computerUse.targets.filter((t) => typeof t === "string")
      : [],
    hasError: str(answer.error) !== undefined,
  };
}

export function registerTrunkStatusTools(server: McpServer, gw: StatusGateway): void {
  server.tool(
    "skills_status",
    "List the skills a Trunk can see, with names, sources and whether each is enabled and eligible. No paths are returned. Not a pure read: the gateway starts its skills watcher and prepares remote skill connections on each call.",
    { agentId: z.string().min(1).optional() },
    async ({ agentId }) => {
      const projected = projectSkillsStatus(
        rec(await gw.request("skills.status", agentParams(agentId))),
      );
      // Text-only MCP clients must receive the same listing as structured clients.
      return ok(JSON.stringify(projected), projected);
    },
  );

  server.tool(
    "memory_status",
    "Show a Trunk's memory provider: whether it is ready or degraded, its provider and model, and file and chunk counts. No paths are returned. Not a pure read: the gateway opens the memory provider for this call and closes it afterwards.",
    { agentId: z.string().min(1).optional() },
    async ({ agentId }) => {
      const projected = projectMemoryStatus(
        rec(await gw.request("memory.status", agentParams(agentId))),
      );
      return ok(`memory ${projected.status ?? "unknown"}`, projected);
    },
  );

  server.tool(
    "computer_status",
    "Whether Branch's computer control is configured and available, and which actions and targets it supports. Takes no screenshot and does not act. Error text is not returned, only whether there was one.",
    {},
    async () => {
      const projected = projectComputerStatus(rec(await gw.request("computer.status", {})));
      return ok(
        projected.available ? "computer control available" : "computer control unavailable",
        projected,
      );
    },
  );
}
