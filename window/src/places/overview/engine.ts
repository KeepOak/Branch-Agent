import type { WindowEngine } from "../../connect/engine";
import { cleanName } from "../../shell/plain-words";

export type Tile = "sessions" | "health" | "computer" | "spend" | "people" | "presence" | "agents" | "backup" | "update" | "runs";
export type Resource = { value?: unknown; loading: boolean; error?: string; updatedAt?: number };
export type OverviewSnapshot = { tiles: Record<Tile, Resource> };

// Contracts copied from gateway/server-methods/{sessions-read,health,system,usage,users,agents,backup,update-status,audit}.ts.
export const OVERVIEW_READS: Record<Tile, { method: string; params: Record<string, unknown> }> = {
  sessions: { method: "sessions.list", params: { includeGlobal: true, includeUnknown: true, configuredAgentsOnly: true, includeLastMessage: true, includeDerivedTitles: true, archived: "all" } },
  health: { method: "health", params: { probe: false } },
  computer: { method: "system.info", params: {} },
  // sessions.usage aggregates every matched session before its row limit, so one row is enough for the totals.
  spend: { method: "sessions.usage", params: { agentScope: "all", range: "7d", mode: "gateway", limit: 1 } },
  people: { method: "users.list", params: {} },
  presence: { method: "system-presence", params: {} },
  agents: { method: "agents.list", params: {} },
  backup: { method: "backup.status", params: {} },
  update: { method: "update.status", params: {} },
  runs: { method: "audit.list", params: { kind: "agent_run", limit: 500 } },
};
const TILES = Object.keys(OVERVIEW_READS) as Tile[];
export const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const text = (v: unknown): string => typeof v === "string" ? v : "";
export const number = (v: unknown): number | undefined => typeof v === "number" && Number.isFinite(v) ? v : undefined;
export const records = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.map(record) : [];
export const errorMessage = (e: unknown): string => e instanceof Error ? e.message : String(e);

/** Individual tiles fail independently. Late responses from a closed view cannot publish. */
export class OverviewData {
  private state: OverviewSnapshot = { tiles: Object.fromEntries(TILES.map(key => [key, { loading: true }])) as Record<Tile, Resource> };
  private listeners = new Set<() => void>();
  private pending = new Map<Tile, Promise<void>>();
  private repeat = new Set<Tile>();
  private epoch = 0;
  private disposed = false;
  private unsubscribe?: () => void;
  private readonly engine: WindowEngine;
  constructor(engine: WindowEngine) { this.engine = engine; }
  getSnapshot = (): OverviewSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private tile(key: Tile, value: Resource): void {
    if (this.disposed) return;
    this.state = { tiles: { ...this.state.tiles, [key]: value } };
    this.listeners.forEach(listener => listener());
  }
  start(): void {
    this.disposed = false;
    this.unsubscribe = this.engine.onEvent(({ event, payload }) => {
      if (event === "sessions.changed") void this.refresh(["sessions", "runs"], true);
      if (event === "presence") void this.refresh(["presence"], true);
      if (event === "users.changed") void this.refresh(["people", "presence"], true);
      if (event === "health") this.tile("health", { value: payload, loading: false, updatedAt: Date.now() });
    });
    void this.refresh();
  }
  stop(): void {
    this.disposed = true;
    this.epoch += 1;
    this.unsubscribe?.();
    this.pending.clear();
    this.repeat.clear();
  }
  async refresh(keys: readonly Tile[] = TILES, repeatAfterPending = false): Promise<void> {
    if (this.disposed) return;
    await Promise.all(keys.map(key => {
      const pending = this.pending.get(key);
      if (pending) {
        if (repeatAfterPending) this.repeat.add(key);
        return pending;
      }
      const epoch = this.epoch;
      const task = this.load(key, epoch).finally(() => {
        if (epoch !== this.epoch || this.disposed) return;
        this.pending.delete(key);
        if (this.repeat.delete(key)) void this.refresh([key]);
      });
      this.pending.set(key, task);
      return task;
    }));
  }
  private async load(key: Tile, epoch: number): Promise<void> {
    this.tile(key, { ...this.state.tiles[key], loading: true, error: undefined });
    try {
      const read = OVERVIEW_READS[key];
      const value = await this.engine.request(read.method, read.params);
      if (epoch === this.epoch) this.tile(key, { value, loading: false, updatedAt: Date.now() });
    } catch (error) {
      if (epoch === this.epoch) this.tile(key, { ...this.state.tiles[key], loading: false, error: errorMessage(error) });
    }
  }
}

export type Session = {
  key: string; agentId: string; title: string; preview: string; working: boolean; updatedAt?: number; createdAt?: number;
  status: string; runId?: string; lastRunId?: string; ownerId: string; ownerLabel: string; human: boolean; helper: boolean; automation: boolean;
  global: boolean; unread: boolean; archived: boolean; cost?: number; recap: string; recapState: string; lastRunError: string;
  kind: string; room?: number;
};
/** What a conversation is called on screen. Threads without a saved name say which Trunk they belong to, never "Untitled". */
export function conversationTitle(s: Pick<Session, "title" | "automation">, trunk: string): string {
  if (cleanName(s.title)) return cleanName(s.title);
  if (s.automation) return trunk ? `${trunk} automation run` : "Automation run";
  return trunk ? `Chat with ${trunk}` : "Chat";
}
function actorOf(row: Record<string, unknown>): Record<string, unknown> {
  const owner = record(record(row.owner).actor);
  return Object.keys(owner).length ? owner : record(row.createdActor);
}
function roomLeft(row: Record<string, unknown>): number | undefined {
  const used = number(row.totalTokens), size = number(row.contextTokens);
  return used !== undefined && size ? Math.max(0, Math.min(1, 1 - used / size)) : undefined;
}
export function session(row: Record<string, unknown>): Session {
  const runIds = Array.isArray(row.activeRunIds) ? row.activeRunIds : [];
  const actor = actorOf(row), summary = record(row.activitySummary);
  return {
    key: text(row.key), agentId: text(row.agentId),
    title: text(row.label) || text(row.displayName) || text(row.derivedTitle),
    preview: text(record(row.observerDigest).headline) || text(row.lastMessagePreview),
    working: row.hasActiveRun === true || runIds.length > 0 || row.status === "running",
    updatedAt: number(row.updatedAt), createdAt: number(row.createdAt), status: text(row.status),
    runId: text(runIds[0]) || undefined, lastRunId: text(row.lastRunId) || undefined,
    ownerId: actor.type === "human" ? text(actor.id) : "", ownerLabel: actor.type === "human" ? text(actor.label) || text(record(actor.identity).displayName) : "",
    human: actor.type === "human",
    helper: Boolean(text(row.spawnedBy) || text(row.parentSessionKey)), automation: row.createdVia === "cron",
    global: row.kind === "global" || row.kind === "unknown", unread: row.unread === true, archived: row.archived === true,
    cost: number(row.estimatedCostUsd), recap: text(summary.text), recapState: text(summary.state), lastRunError: text(row.lastRunError),
    kind: text(row.chatType) || text(row.kind), room: roomLeft(row),
  };
}
export function sessions(value: unknown): Session[] {
  return records(record(value).sessions).filter(row => text(row.key)).map(session).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** Conversations a person can open, as the preview counts them: no helpers, automations or Branch-wide ones. */
export const countable = (row: Session): boolean => !row.helper && !row.automation && !row.global && !row.archived;

export type Agent = { id: string; name: string; mode: string };
export function agents(value: unknown): { defaultId: string; mainKey: string; list: Agent[] } {
  const v = record(value);
  return {
    defaultId: text(v.defaultId), mainKey: text(v.mainKey) || "main",
    list: records(v.agents).filter(a => text(a.id)).map(a => ({ id: text(a.id), name: text(record(a.identity).name) || text(a.name) || text(a.id), mode: text(a.defaultPermissionMode) })),
  };
}
export const agentName = (list: Agent[], id: string): string => list.find(a => a.id === id)?.name || id || "Trunk";

export type Run = { runId: string; agentId: string; sessionKey: string; startedAt?: number; finishedAt?: number; status: string };
/** Agent runs from content-free audit events: one start and one finish per run id. */
export function runs(value: unknown): Run[] {
  const byId = new Map<string, Run>();
  for (const e of records(record(value).events)) {
    const runId = text(e.runId);
    if (!runId || e.kind !== "agent_run") continue;
    const run = byId.get(runId) ?? { runId, agentId: text(e.agentId), sessionKey: text(e.sessionKey), status: "started" };
    const at = number(e.occurredAt);
    if (e.action === "agent.run.started") run.startedAt = at;
    if (e.action === "agent.run.finished") { run.finishedAt = at; run.status = text(e.status) || "unknown"; }
    if (!run.sessionKey) run.sessionKey = text(e.sessionKey);
    byId.set(runId, run);
  }
  return [...byId.values()].sort((a, b) => (b.startedAt ?? b.finishedAt ?? 0) - (a.startedAt ?? a.finishedAt ?? 0));
}
export const runMs = (run: Run): number | undefined => run.startedAt !== undefined && run.finishedAt !== undefined ? run.finishedAt - run.startedAt : undefined;

export type Person = { id: string; name: string; role: string; online: boolean; active: boolean; lastActive?: number; onlineSince?: number; where: string; watching: string[] };
const ACTIVE_MS = 5 * 6e4;
/** Gateway presence names connected people, whereas the profile list alone does not establish presence. */
export function people(profiles: unknown, presence: unknown, now = Date.now()): Person[] {
  const live = records(presence);
  return records(record(profiles).profiles).filter(profile => text(profile.id) && !profile.mergedInto).map(profile => {
    const connections = live.filter(entry => text(record(entry.user).id) === profile.id);
    return personFrom(text(profile.id), text(profile.displayName) || text(profile.id), text(profile.role), connections, now);
  });
}
/** Connections made with the Gateway's own key rather than a personal sign-in (the preview's "Shared owner"). */
export function sharedConnections(presence: unknown): Record<string, unknown>[] {
  return records(presence).filter(entry => !text(record(entry.user).id) && entry.mode !== "gateway" && entry.reason !== "self" && Array.isArray(entry.roles) && entry.roles.includes("operator"));
}
export function personFrom(id: string, name: string, role: string, connections: Record<string, unknown>[], now = Date.now()): Person {
  const activity = connections.flatMap(entry => number(entry.lastActivityAt) ?? []);
  const since = connections.flatMap(entry => number(entry.onlineSince) ?? []);
  const lastActive = activity.length ? Math.max(...activity) : undefined;
  const first = connections[0] ?? {};
  const device = text(first.deviceFamily) || text(first.platform);
  return {
    id, name, role, online: connections.length > 0, active: lastActive !== undefined && now - lastActive < ACTIVE_MS, lastActive,
    onlineSince: since.length ? Math.min(...since) : undefined,
    where: [device, text(first.timeZone)].filter(Boolean).join(" · "),
    watching: connections.flatMap(entry => Array.isArray(entry.watchedSessions) ? entry.watchedSessions.filter((k): k is string => typeof k === "string") : []),
  };
}
