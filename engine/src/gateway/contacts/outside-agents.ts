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

export type OutsideAgent = {
  id: string;
  name: string;
  version?: string;
  where?: string;
  /** The folder the agent works in (its MCP server's working folder name). */
  project?: string;
  /** What it is doing now, as it last said ("Messaging builder-oak"). */
  activity?: string;
};
export type OutsideAgentRecord = OutsideAgent & {
  firstSeenAt: number;
  lastSeenAt: number;
  activityAt?: number;
};
/** Settings › Connected agents: the master switch, disconnected agents, and who may drive the window. */
export type OutsideAgentSettings = {
  enabled: boolean;
  revoked: string[];
  mayDriveWindow: string[];
};

/** A client that said hello within this window is shown online. `branch mcp serve` says hello every minute. */
export const OUTSIDE_AGENT_ONLINE_MS = 3 * 60_000;
// Outside-agent rows are a Branch store with no upstream limit; this only bounds the file.
const MAX_RECORDS = 512;

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
  const all = listOutsideAgents(env);
  const rows = all.filter((row) => row.id !== agent.id);
  const previous = all.find((row) => row.id === agent.id);
  const record: OutsideAgentRecord = {
    id: agent.id,
    name: agent.name,
    ...(agent.version ? { version: agent.version } : {}),
    ...(agent.where ? { where: agent.where } : {}),
    ...(agent.project ? { project: agent.project } : {}),
    ...(agent.activity
      ? { activity: agent.activity, activityAt: now }
      : previous?.activity
        ? { activity: previous.activity, activityAt: previous.activityAt }
        : {}),
    firstSeenAt: previous?.firstSeenAt ?? now,
    lastSeenAt: now,
  };
  const next = [record, ...rows]
    .toSorted((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, MAX_RECORDS);
  writeJson(registryFile(env), next);
  return record;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function settingsFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "contacts", "outside-agents-settings.json");
}

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** On by default: `branch mcp serve` worked before this switch existed. */
export function readOutsideAgentSettings(env?: NodeJS.ProcessEnv): OutsideAgentSettings {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(env), "utf8")) as Record<string, unknown>;
    return {
      enabled: saved.enabled !== false,
      revoked: ids(saved.revoked),
      mayDriveWindow: ids(saved.mayDriveWindow),
    };
  } catch {
    return { enabled: true, revoked: [], mayDriveWindow: [] };
  }
}

/** Apply one change from Settings › Connected agents and return the result. */
export function updateOutsideAgentSettings(
  change: { enabled?: boolean; id?: string; revoked?: boolean; mayDriveWindow?: boolean },
  env?: NodeJS.ProcessEnv,
): OutsideAgentSettings {
  const current = readOutsideAgentSettings(env);
  const toggle = (list: string[], on: boolean | undefined) =>
    on === undefined || !change.id
      ? list
      : on
        ? [...new Set([...list, change.id])]
        : list.filter((id) => id !== change.id);
  const next: OutsideAgentSettings = {
    enabled: change.enabled ?? current.enabled,
    revoked: toggle(current.revoked, change.revoked),
    mayDriveWindow: toggle(current.mayDriveWindow, change.mayDriveWindow),
  };
  writeJson(settingsFile(env), next);
  return next;
}

/** Why Branch refuses this outside agent now, or undefined when it may work with Branch. */
export function outsideAgentRefusal(
  agent: Pick<OutsideAgent, "id" | "name">,
  settings: OutsideAgentSettings = readOutsideAgentSettings(),
): string | undefined {
  if (!settings.enabled) {
    return "Other agents are off in Settings › Connected agents.";
  }
  if (settings.revoked.includes(agent.id)) {
    return `${agent.name} was disconnected in Settings › Connected agents.`;
  }
  return undefined;
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
