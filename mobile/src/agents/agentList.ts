// The home computer's agents (Trunks), read with agents.list the way Chats and the window roster do.
// Status is paused when agents.list says so, running when a session for that agent has an active run,
// otherwise idle. Pause and Resume call agents.pause / agents.resume when the engine advertises them
// on hello; today's engine does not, so the screen is read-only until it does.
import type { HelloOk } from '@branch/gateway-client/browser';
import { LIST_PARAMS } from '../chats/chatList';
import type { EngineLink } from '../pairing/pairingSession';

export type AgentStatus = 'running' | 'paused' | 'idle';

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
  /** The engine advertised agents.pause and agents.resume on this connection. */
  canControl: boolean;
  sending: Record<string, 'pause' | 'resume'>;
  failed: Record<string, string>;
};

export const PAUSE_METHOD = 'agents.pause';
export const RESUME_METHOD = 'agents.resume';

/** Shown when this engine has no pause/resume method the phone may call. */
export const PAUSE_UNAVAILABLE =
  'Pause and Resume need the computer to offer agents.pause and agents.resume. This engine doesn’t yet.';

export const LIST_FAILED_MESSAGE = 'Your computer didn’t send its agents. Try again in a moment.';
export const CONTROL_FAILED_MESSAGE = 'Your computer couldn’t change that Trunk just now. Try again in a moment.';

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

export function controlFailureMessage(error: unknown): string {
  if (missingScope(error)) return 'This phone isn’t allowed to pause or resume Trunks. Do that on your computer.';
  if (codeOf(error) === 'UNAVAILABLE') return 'Your computer is busy right now. Try again in a moment.';
  return CONTROL_FAILED_MESSAGE;
}

/** Methods the engine named on this handshake (HelloOk.features.methods). */
export function advertisedMethods(hello: HelloOk | null | undefined): Set<string> {
  const features = rec(hello).features;
  const methods = rec(features).methods;
  return new Set((Array.isArray(methods) ? methods : []).filter((m): m is string => typeof m === 'string' && m.length > 0));
}

/** True when this connection advertised both pause and resume. */
export function canPauseResume(hello: HelloOk | null | undefined): boolean {
  const methods = advertisedMethods(hello);
  return methods.has(PAUSE_METHOD) && methods.has(RESUME_METHOD);
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  running: 'Running',
  paused: 'Paused',
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
    const paused = a.paused === true;
    rows.push({
      id,
      name,
      avatar: str(identity.emoji) || initial(name),
      status: paused ? 'paused' : running.has(id) ? 'running' : 'idle',
    });
  }
  return rows;
}

export class AgentList {
  private snapshot: AgentListSnapshot = { rows: [], loaded: false, error: null, canControl: false, sending: {}, failed: {} };
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private readonly offs: Array<() => void> = [];
  private disposed = false;

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
    this.set({ rows: [], loaded: false, error: null, canControl: false, sending: {}, failed: {} });
  }

  async start(): Promise<void> {
    this.set({ canControl: canPauseResume(this.link.hello) });
    try {
      const [agents, sessions] = await Promise.all([
        this.link.request('agents.list', {}),
        this.link.request('sessions.list', LIST_PARAMS).catch(() => null),
      ]);
      this.apply(agents, sessions);
    } catch (error) {
      this.set({ error: listFailureMessage(error) });
    }
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
          try {
            const [agents, sessions] = await Promise.all([
              this.link.request('agents.list', {}),
              this.link.request('sessions.list', LIST_PARAMS).catch(() => null),
            ]);
            this.apply(agents, sessions);
          } catch (error) {
            this.set({ error: listFailureMessage(error) });
          }
        } while (this.again && !this.disposed);
      } finally {
        this.inFlight = null;
      }
    };
    this.inFlight = read();
    return this.inFlight;
  }

  async pause(id: string): Promise<void> {
    await this.control(id, 'pause');
  }

  async resume(id: string): Promise<void> {
    await this.control(id, 'resume');
  }

  private async control(id: string, action: 'pause' | 'resume'): Promise<void> {
    if (!this.snapshot.canControl || this.snapshot.sending[id]) return;
    const { [id]: _cleared, ...failed } = this.snapshot.failed;
    this.set({ sending: { ...this.snapshot.sending, [id]: action }, failed });
    try {
      await this.link.request(action === 'pause' ? PAUSE_METHOD : RESUME_METHOD, { agentId: id });
      await this.refresh();
    } catch (error) {
      this.set({ failed: { ...this.snapshot.failed, [id]: controlFailureMessage(error) } });
    } finally {
      const { [id]: _sent, ...sending } = this.snapshot.sending;
      this.set({ sending });
    }
  }

  private apply(agents: unknown, sessions: unknown): void {
    this.set({
      rows: readAgentRows(agents, sessions),
      loaded: true,
      error: null,
      canControl: canPauseResume(this.link.hello),
    });
  }

  private set(patch: Partial<AgentListSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}
