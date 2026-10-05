// Outside agents that reach Branch through `branch mcp serve` (Claude Code, Codex, Gemini CLI, ...). They use the
// A2A outside-contact model (CONTACTS-SPEC E7): contact id `a2a:<id>`, an "A2A · <where>" badge, and the per-pair
// agentToAgent rule `a2a:<id>` that the message tool already checks for configured A2A peers.
import fs from "node:fs";
import path from "node:path";
import type { TranscriptSenderIdentity } from "../../chat/sender-identity.js";
import { resolveStateDir } from "../../config/paths.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { createAgentToAgentPolicy } from "../../plugin-sdk/session-visibility.js";
import type { OutsidePeer } from "./project.js";

export type OutsideAgent = { id: string; name: string; version?: string; where?: string };
export type OutsideAgentRecord = OutsideAgent & { firstSeenAt: number; lastSeenAt: number };

/** A client that said hello within this window is shown online. `branch mcp serve` says hello every minute. */
export const OUTSIDE_AGENT_ONLINE_MS = 3 * 60_000;
const MAX_RECORDS = 64;

/** "Claude Code" -> "claude-code": the stable id behind contact `a2a:<id>` and the per-pair rule. */
export function outsideAgentId(name: string): string {
  return (
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "outside-agent"
  );
}

function registryFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "contacts", "outside-agents.json");
}

export function listOutsideAgents(env?: NodeJS.ProcessEnv): OutsideAgentRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryFile(env), "utf8")) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (row): row is OutsideAgentRecord =>
            !!row &&
            typeof row.id === "string" &&
            typeof row.name === "string" &&
            typeof row.lastSeenAt === "number",
        )
      : [];
  } catch {
    return [];
  }
}

/** Remember an outside agent (insert or refresh). Written atomically; the oldest rows go past the cap. */
export function recordOutsideAgent(
  agent: OutsideAgent,
  now = Date.now(),
  env?: NodeJS.ProcessEnv,
): OutsideAgentRecord {
  const rows = listOutsideAgents(env).filter((row) => row.id !== agent.id);
  const previous = listOutsideAgents(env).find((row) => row.id === agent.id);
  const record: OutsideAgentRecord = {
    id: agent.id,
    name: agent.name,
    ...(agent.version ? { version: agent.version } : {}),
    ...(agent.where ? { where: agent.where } : {}),
    firstSeenAt: previous?.firstSeenAt ?? now,
    lastSeenAt: now,
  };
  const next = [record, ...rows]
    .toSorted((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, MAX_RECORDS);
  const file = registryFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return record;
}

/** Outside agents as the contacts projection's peers; configured A2A peers keep their own entry. */
export function outsideAgentPeers(
  records: readonly OutsideAgentRecord[],
  configured: readonly OutsidePeer[],
): OutsidePeer[] {
  const taken = new Set(configured.map((peer) => peer.name));
  return records
    .filter((row) => !taken.has(row.id))
    .map((row) => ({
      name: row.id,
      where: row.where ?? null,
      card: {
        name: row.name,
        description: row.version
          ? `${row.name} ${row.version}, connected over MCP`
          : `${row.name}, connected over MCP`,
        skills: [],
        fetchedAt: row.lastSeenAt,
      },
    }));
}

export function isOutsideAgentOnline(record: OutsideAgentRecord, now = Date.now()): boolean {
  return now - record.lastSeenAt < OUTSIDE_AGENT_ONLINE_MS;
}

/** The transcript sender for a message an outside agent wrote: drawn as an A2A agent, never as the owner. */
export function outsideAgentSender(agent: Pick<OutsideAgent, "id" | "name">): {
  id: string;
  name: string;
  identity: TranscriptSenderIdentity;
} {
  return {
    id: agent.id,
    name: agent.name,
    identity: {
      type: "observation" as const,
      id: agent.id,
      pluginId: "a2a",
      accountId: "mcp",
      senderKind: "bot" as const,
    },
  };
}

/** "Who it knows": the Trunk must know the outside agent (`agents.entries.<trunk>.agentToAgent` with `a2a:<id>`). */
export function outsideAgentMayMessage(
  cfg: BranchConfig,
  agentId: string,
  outsideId: string,
): boolean {
  return createAgentToAgentPolicy(cfg).isAllowed(agentId, `a2a:${outsideId}`);
}
