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
  /** A random tag of the running client process. */
  instance?: string;
  /** "branch": another Branch grafted in as a device; "trunk": one of that Branch's Trunks. */
  kind?: "branch" | "trunk";
  /** For a "trunk": the id of the grafted Branch it lives on. */
  via?: string;
  avatar?: string;
  trunkId?: string;
};
export type OutsideAgentRecord = OutsideAgent & {
  firstSeenAt: number;
  lastSeenAt: number;
  activityAt?: number;
  /** The paired device that said hello (a grafted Branch); unset for owner-level connections. */
  deviceId?: string;
};
/** Settings › Grafts: the master switch, disconnected agents, and who may drive the window. */
export type OutsideAgentSettings = {
  enabled: boolean;
  revoked: string[];
  mayDriveWindow: string[];
};

/** A client that said hello within this window is shown online. `branch mcp serve` says hello every minute. */
export const OUTSIDE_AGENT_ONLINE_MS = 3 * 60_000;
const SESSION_ROW_TTL_MS = 24 * 60 * 60_000;
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

/**
 * The ids and grafted-Trunk ids of every outside agent, and nothing else from the registry. Team memory uses this
 * to keep outside Branches out of team membership without exposing device ids, activity or project folders.
 */
export function listOutsideAgentIdentityIds(env?: NodeJS.ProcessEnv): string[] {
  const ids = new Set<string>();
  for (const record of listOutsideAgents(env)) {
    ids.add(record.id);
    if (record.trunkId) {
      ids.add(record.trunkId);
    }
  }
  return [...ids].toSorted();
}

/**
 * The id this running client gets: its stable id, unless another process is online under it right now; then
 * the first free `<id>-2`, `<id>-3`, ... (an offline row, or one this same process holds, is free).
 */
export function assignOutsideAgentId(
  agent: Pick<OutsideAgent, "id" | "instance">,
  records: readonly OutsideAgentRecord[],
  now = Date.now(),
): string {
  if (!agent.instance) return agent.id;
  const byId = new Map(records.map((row) => [row.id, row]));
  for (let n = 1; ; n++) {
    const id = n === 1 ? agent.id : `${agent.id.slice(0, 60)}-${n}`;
    const row = byId.get(id);
    if (
      !row ||
      !isOutsideAgentOnline(row, now) ||
      !row.instance ||
      row.instance === agent.instance
    ) {
      return id;
    }
  }
}

/**
 * Before per-session ids (#226), an MCP client's id was its product name alone ("claude-code"), so rules written
 * then (Who it knows `a2a:claude-code`, Disconnect, window rights) meant every session of that product. The
 * product-wide id of a session id `claude-code-a1b2c3` or `claude-code-a1b2c3-2` is `claude-code`; its rules keep
 * applying to every such session, so nothing set before the change is lost.
 */
export function legacyOutsideId(id: string): string | undefined {
  return /^(.+)-[0-9a-f]{6}(?:-\d+)?$/.exec(id)?.[1];
}

const forms = (id: string) => [id, legacyOutsideId(id)].filter((v): v is string => Boolean(v));

/** Remember an outside agent (insert or refresh). Written atomically; the oldest rows go past the cap. */
export function recordOutsideAgent(
  agent: OutsideAgent,
  now = Date.now(),
  env?: NodeJS.ProcessEnv,
  opts: { leaving?: boolean; deviceId?: string } = {},
): OutsideAgentRecord {
  const all = listOutsideAgents(env);
  // The product-wide row from before per-session ids folds into the first session that says hello.
  const legacy = legacyOutsideId(agent.id);
  const old = legacy ? all.find((row) => row.id === legacy && !row.instance) : undefined;
  const rows = all.filter((row) => row.id !== agent.id && row !== old);
  const previous = all.find((row) => row.id === agent.id) ?? old;
  const record: OutsideAgentRecord = {
    id: agent.id,
    name: agent.name,
    ...(agent.version ? { version: agent.version } : {}),
    ...(agent.where ? { where: agent.where } : {}),
    ...(agent.project ? { project: agent.project } : {}),
    ...(agent.instance ? { instance: agent.instance } : {}),
    ...(agent.kind ? { kind: agent.kind } : {}),
    ...(agent.via ? { via: agent.via } : {}),
    ...(agent.avatar || previous?.avatar ? { avatar: agent.avatar ?? previous?.avatar } : {}),
    ...(agent.trunkId || previous?.trunkId ? { trunkId: agent.trunkId ?? previous?.trunkId } : {}),
    ...(opts.deviceId ? { deviceId: opts.deviceId } : {}),
    ...(agent.activity
      ? { activity: agent.activity, activityAt: now }
      : previous?.activity
        ? { activity: previous.activity, activityAt: previous.activityAt }
        : {}),
    firstSeenAt: previous?.firstSeenAt ?? now,
    // A goodbye marks it offline now, so the next session of the same agent gets this id back.
    lastSeenAt: opts.leaving ? now - OUTSIDE_AGENT_ONLINE_MS : now,
  };
  // Extra-session rows (<id>-2, -3, ...) that have been offline for a day carry nothing worth keeping.
  const stale = (row: OutsideAgentRecord) =>
    /-[0-9a-f]{6}-\d+$/.test(row.id) && now - row.lastSeenAt > SESSION_ROW_TTL_MS;
  const next = [record, ...rows.filter((row) => !stale(row))]
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

/** Apply one change from Settings › Grafts and return the result. */
export function updateOutsideAgentSettings(
  change: { enabled?: boolean; id?: string; revoked?: boolean; mayDriveWindow?: boolean },
  env?: NodeJS.ProcessEnv,
): OutsideAgentSettings {
  const current = readOutsideAgentSettings(env);
  const toggle = (list: string[], on: boolean | undefined) => {
    if (on === undefined || !change.id) return list;
    const legacy = legacyOutsideId(change.id);
    // One session's choice turns a product-wide rule into per-session rules for its other sessions.
    const expanded =
      legacy && list.includes(legacy)
        ? [
            ...list.filter((id) => id !== legacy),
            ...listOutsideAgents(env)
              .map((row) => row.id)
              .filter((id) => legacyOutsideId(id) === legacy),
          ]
        : list;
    return on
      ? [...new Set([...expanded, change.id])]
      : [...new Set(expanded)].filter((id) => id !== change.id);
  };
  const next: OutsideAgentSettings = {
    enabled: change.enabled ?? current.enabled,
    revoked: toggle(current.revoked, change.revoked),
    mayDriveWindow: toggle(current.mayDriveWindow, change.mayDriveWindow),
  };
  writeJson(settingsFile(env), next);
  return next;
}

/** Whether the owner let this session drive their window (its own id or its product-wide one). */
export function outsideAgentMayDriveWindow(id: string, settings: OutsideAgentSettings): boolean {
  return forms(id).some((form) => settings.mayDriveWindow.includes(form));
}

/** Why Branch refuses this outside agent now, or undefined when it may work with Branch. */
export function outsideAgentRefusal(
  agent: Pick<OutsideAgent, "id" | "name">,
  settings: OutsideAgentSettings = readOutsideAgentSettings(),
): string | undefined {
  if (!settings.enabled) {
    return "Other agents are off in Settings › Grafts.";
  }
  if (forms(agent.id).some((id) => settings.revoked.includes(id))) {
    return `${agent.name} was disconnected in Settings › Grafts.`;
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
      ...(row.kind ? { kind: row.kind } : {}),
      ...(row.via ? { via: row.via } : {}),
      ...(row.avatar ? { avatar: row.avatar } : {}),
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

/**
 * A grafted Branch is a scoped device: what it says hello as stays bound to its device. It may not take a row
 * another device or an owner-level client holds, and its Trunks must sit under its own Branch row. Owner-level
 * connections (no deviceId) may not take a device's rows either.
 */
export function outsideAgentDeviceRefusal(
  agent: Pick<OutsideAgent, "id" | "name" | "via">,
  deviceId: string | undefined,
  records: readonly OutsideAgentRecord[],
  settings: OutsideAgentSettings = { enabled: true, revoked: [], mayDriveWindow: [] },
): string | undefined {
  const row = records.find((candidate) => candidate.id === agent.id);
  if (row && row.deviceId !== deviceId && !(deviceId && releasedDeviceRow(row, settings))) {
    return `${agent.name} is already connected from another device.`;
  }
  if (agent.via && (!deviceId || records.find((r) => r.id === agent.via)?.deviceId !== deviceId)) {
    return `${agent.name} must say hello through its own grafted Branch.`;
  }
  return undefined;
}

/**
 * A grafted Branch's row after Disconnect: its pairing was removed with it (contacts.outside.set revokes device
 * rows only once device.pair.remove succeeded), so only a new setup code the owner approved can bring a device
 * back. Such a row is released: the next paired device that says hello as it takes it over and un-revokes it.
 */
export function releasedDeviceRow(
  row: OutsideAgentRecord,
  settings: OutsideAgentSettings,
): boolean {
  return Boolean(row.deviceId) && settings.revoked.includes(row.id);
}

/** Rows a re-paired grafted Branch takes back on hello: un-revoked, so its new pairing works without manual steps. */
export function reclaimDeviceRow(
  id: string,
  deviceId: string | undefined,
  records: readonly OutsideAgentRecord[],
  env?: NodeJS.ProcessEnv,
): OutsideAgentSettings | undefined {
  const settings = readOutsideAgentSettings(env);
  const row = records.find((candidate) => candidate.id === id);
  if (!deviceId || !row || !releasedDeviceRow(row, settings)) return undefined;
  return updateOutsideAgentSettings({ id, revoked: false }, env);
}

/** The paired device behind a scoped (non-owner) connection: a grafted Branch. Owner-level connections (admin
 *  scope, as the owner's window and the owner's own Graft have) return undefined. */
export function graftDeviceId(
  client: { connect?: { scopes?: readonly string[]; device?: { id?: string } } } | null | undefined,
): string | undefined {
  const scopes = Array.isArray(client?.connect?.scopes) ? client.connect.scopes : [];
  if (scopes.includes("operator.admin")) return undefined;
  return client?.connect?.device?.id || undefined;
}

/** Why a grafted Branch may not send this message: it speaks only as itself or one of its Trunks. Other scoped
 *  devices (a paired phone) have no rows here and keep upstream's rules. */
export function graftSendRefusal(
  outsideId: string | undefined,
  deviceId: string | undefined,
  records: readonly OutsideAgentRecord[] = listOutsideAgents(),
): string | undefined {
  if (!deviceId || !records.some((row) => row.deviceId === deviceId)) return undefined;
  const row = outsideId ? records.find((candidate) => candidate.id === outsideId) : undefined;
  return row?.deviceId === deviceId
    ? undefined
    : "A grafted Branch sends only as itself or one of its Trunks.";
}

/** The device ids and every row they said hello as, for a Disconnect of a grafted Branch or one of its Trunks. */
export function outsideAgentDeviceRows(
  id: string,
  records: readonly OutsideAgentRecord[],
): { deviceId: string; ids: string[] } | undefined {
  const deviceId = records.find((row) => row.id === id)?.deviceId;
  if (!deviceId) return undefined;
  return { deviceId, ids: records.filter((row) => row.deviceId === deviceId).map((row) => row.id) };
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
  const policy = createAgentToAgentPolicy(cfg);
  return forms(outsideId).every((id) => policy.isAllowed(agentId, `a2a:${id}`));
}
