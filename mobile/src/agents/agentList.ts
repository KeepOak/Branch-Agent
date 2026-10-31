// The home computer's agents (Trunks), read with agents.list the way Chats and the window roster do.
// Status is running when a session for that agent has an active run, otherwise idle. The engine has
// no agents.pause or agents.resume, so this list is read-only: a lost phone cannot change household Trunks.
import { LIST_PARAMS } from '../chats/chatList';
import type { EngineLink } from '../pairing/pairingSession';

export type AgentStatus = 'running' | 'idle';

export type AgentRow = {
  id: string;
  name: string;
  avatar: string;
  status: AgentStatus;
};

export type AgentListSnapshot = {
  rows: AgentRow[];
  loaded: boolean;
  error: string | null;
};

export const LIST_FAILED_MESSAGE = 'Your computer didn’t send its agents. Try again in a moment.';

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function initial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

function codeOf(error: unknown): string {
  return str(rec(error).gatewayCode) || str(rec(error).code);
}

function missingScope(error: unknown): boolean {
  return codeOf(error) === 'FORBIDDEN' || str(rec(rec(error).details).code) === 'MISSING_SCOPE';
}

export function listFailureMessage(error: unknown): string {
  if (missingScope(error)) return 'This phone isn’t allowed to see agents any more. Pair it again from Branch on your computer.';
  if (codeOf(error) === 'UNAVAILABLE') return 'Your computer is busy right now. Try again in a moment.';
  return LIST_FAILED_MESSAGE;
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  running: 'Running',
  idle: 'Idle',
};

/** Agent ids that have a run going, from a sessions.list / sessions.subscribe payload. */
export function runningAgentIds(sessionsResult: unknown): Set<string> {
  const sessions = rec(sessionsResult).sessions;
  const ids = new Set<string>();
  const rows = Array.isArray(sessions) ? sessions : [];
  for (const raw of rows) {
    const r = rec(raw);
    const activeRunIds = Array.isArray(r.activeRunIds) ? r.activeRunIds.filter((id) => typeof id === 'string' && id) : [];
    if (r.hasActiveRun !== true && activeRunIds.length === 0) continue;
    const agentId = str(r.agentId);
    if (agentId) ids.add(agentId);
  }
  return ids;
}

/** One agents.list payload as rows, with running taken from sessions when given. */
export function readAgentRows(agentsResult: unknown, sessionsResult?: unknown): AgentRow[] {
  const running = runningAgentIds(sessionsResult);
  const rows: AgentRow[] = [];
  const listed = rec(agentsResult).agents;
  const rawAgents = Array.isArray(listed) ? listed : [];
  for (const raw of rawAgents) {
    const a = rec(raw);
    const id = str(a.id);
    if (!id) continue;
    const identity = rec(a.identity);
    const name = str(identity.name) || str(a.name) || id;
    rows.push({
      id,
      name,
      avatar: str(identity.emoji) || initial(name),
      status: running.has(id) ? 'running' : 'idle',
    });
  }
  return rows;
}

export class AgentList {
  private snapshot: AgentListSnapshot = { rows: [], loaded: false, error: null };
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private readonly offs: Array<() => void> = [];
  private disposed = false;
  /** Last sessions.list payload that landed, so a later sessions read failure does not idle every Trunk. */
  private lastSessions: unknown | undefined;

  constructor(private readonly link: EngineLink) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AgentListSnapshot => this.snapshot;

  /** Reads now if the computer is connected, and again on every reconnect and every change. */
  attach(): void {
    this.disposed = false;
    this.offs.push(
      this.link.onConnected(() => void this.start()),
      this.link.onEvent((event, payload) => this.onEvent(event, payload)),
    );
    if (this.link.hello) void this.start();
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Forgets every row, after the phone unpairs. */
  reset(): void {
    this.lastSessions = undefined;
    this.set({ rows: [], loaded: false, error: null });
  }

  async start(): Promise<void> {
    await this.loadRoster();
  }

  onEvent(event: string, payload: unknown): void {
    const state = str(rec(payload).state);
    if (event === 'sessions.changed' || event === 'agents.changed' || (event === 'chat' && ['final', 'error', 'aborted'].includes(state))) {
      this.refreshSoon();
    }
  }

  refreshSoon(delayMs = 150): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, delayMs);
  }

  refresh(): Promise<void> {
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    const read = async () => {
      await Promise.resolve();
      try {
        do {
          this.again = false;
          await this.loadRoster();
        } while (this.again && !this.disposed);
      } finally {
        this.inFlight = null;
      }
    };
    this.inFlight = read();
    return this.inFlight;
  }

  private async loadRoster(): Promise<void> {
    const [agentsResult, sessionsResult] = await Promise.allSettled([
      this.link.request('agents.list', {}),
      this.link.request('sessions.list', LIST_PARAMS),
    ]);
    if (agentsResult.status === 'rejected') {
      this.set({ error: listFailureMessage(agentsResult.reason) });
      return;
    }
    if (sessionsResult.status === 'rejected') {
      if (this.lastSessions === undefined) {
        this.set({ error: listFailureMessage(sessionsResult.reason) });
        return;
      }
      this.apply(agentsResult.value, this.lastSessions);
      return;
    }
    this.lastSessions = sessionsResult.value;
    this.apply(agentsResult.value, sessionsResult.value);
  }

  private apply(agents: unknown, sessions: unknown): void {
    this.set({
      rows: readAgentRows(agents, sessions),
      loaded: true,
      error: null,
    });
  }

  private set(patch: Partial<AgentListSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}
