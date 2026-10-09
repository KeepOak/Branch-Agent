// The approvals waiting for this phone: every exec and plugin approval the engine has pending, read with
// exec.approval.list and plugin.approval.list on each connect and kept current from the
// *.approval.requested and *.approval.resolved events, the way the window does
// (window/src/thread/useEngineData.ts useApprovalDetails, window/src/connect/session.ts addApproval).
// Answering sends exec.approval.resolve (plugin.approval.resolve for a plugin's request). Whichever
// surface answers first wins; the others hear *.approval.resolved and the card moves to Answered.
import { agentIdOf, readAgents } from '../chats/chatList';
import type { EngineLink } from '../pairing/pairingSession';

export type ApprovalKind = 'exec' | 'plugin';
export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

export type Approval = {
  id: string;
  kind: ApprovalKind;
  agentId?: string;
  sessionKey?: string;
  /** The command an exec approval would run; a plugin's title when it has no command. */
  command: string;
  /** A plugin's question ("Send an email to Dana?") and what it will do, in its own words. */
  title?: string;
  description?: string;
  cwd?: string;
  host?: string;
  /** What the engine noticed about the command (commandAnalysis.warningLines). */
  warnings: string[];
  allowedDecisions: ApprovalDecision[];
  createdAtMs?: number;
  expiresAtMs?: number;
};

export type Answered = Approval & {
  /** gone: it left the engine's list while this phone wasn't listening, so how it ended isn't known. */
  outcome: 'allowed' | 'denied' | 'expired' | 'gone';
  always: boolean;
  by: 'phone' | 'elsewhere';
  at: number;
};

export type Trunk = { name: string; avatar: string };

export type ApprovalsSnapshot = {
  /** Oldest first: the one that has waited longest is answered first. */
  pending: Approval[];
  /** Newest first, this session only. */
  answered: Answered[];
  /** The Trunks by id, for names and avatars. */
  trunks: Record<string, Trunk>;
  loaded: boolean;
  error: string | null;
  /** The answer on its way for each approval. */
  sending: Record<string, ApprovalDecision>;
  /** Why an answer didn't go through, in plain words. */
  failed: Record<string, string>;
};

const ANSWERED_KEPT = 20;
const DECISIONS: readonly ApprovalDecision[] = ['allow-once', 'allow-always', 'deny'];
/** How long an answer waits for the computer to come back (after the phone wakes from the background). */
export const RECONNECT_WAIT_MS = 15_000;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function itemsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const r = rec(result);
  const items = r.items ?? r.approvals;
  return Array.isArray(items) ? items : [];
}

/** One pending approval, from a list item or a requested event (both carry { id, request, createdAtMs, expiresAtMs }). */
export function readApproval(payload: unknown, kind: ApprovalKind): Approval | null {
  const p = rec(payload);
  const r = rec(p.request);
  const id = str(p.id);
  if (!id) return null;
  const allowed = Array.isArray(r.allowedDecisions) ? r.allowedDecisions.filter((d): d is ApprovalDecision => DECISIONS.includes(d as ApprovalDecision)) : [];
  const lines = rec(r.commandAnalysis).warningLines;
  const sessionKey = str(r.sessionKey);
  const agentId = str(r.agentId) || (sessionKey ? agentIdOf(sessionKey) : undefined) || '';
  const createdAtMs = num(p.createdAtMs);
  const expiresAtMs = num(p.expiresAtMs);
  return {
    id,
    kind,
    ...(agentId ? { agentId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    command: str(r.commandPreview) || str(r.command) || str(r.title),
    ...(str(r.title) ? { title: str(r.title) } : {}),
    ...(kind === 'plugin' && str(r.description) ? { description: str(r.description) } : {}),
    ...(str(r.cwd) ? { cwd: str(r.cwd) } : {}),
    ...(str(r.host) ? { host: str(r.host) } : {}),
    warnings: Array.isArray(lines) ? lines.filter((l): l is string => typeof l === 'string' && l.trim() !== '') : str(r.warningText) ? [str(r.warningText)] : [],
    allowedDecisions: allowed.length ? allowed : ['allow-once', 'allow-always', 'deny'],
    ...(createdAtMs ? { createdAtMs } : {}),
    ...(expiresAtMs ? { expiresAtMs } : {}),
  };
}

/** The Trunk who asked, by its id, with a stand-in when the engine didn't say. */
export function trunkOf(approval: Approval, trunks: Record<string, Trunk>): Trunk {
  const known = approval.agentId ? trunks[approval.agentId] : undefined;
  if (known) return known;
  const name = approval.agentId ? approval.agentId.charAt(0).toUpperCase() + approval.agentId.slice(1) : 'A Trunk';
  return { name, avatar: approval.agentId ? name.charAt(0) : '?' };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The engine's answer when someone else got there first (approval-shared.ts). */
function alreadySettled(message: string): boolean {
  return /expired or not found|already resolved|unknown or expired/i.test(message);
}

export class ApprovalInbox {
  private snapshot: ApprovalsSnapshot = { pending: [], answered: [], trunks: {}, loaded: false, error: null, sending: {}, failed: {} };
  private readonly listeners = new Set<() => void>();
  private readonly offs: Array<() => void> = [];
  private disposed = false;
  private readonly now: () => number;
  private readonly reconnectWaitMs: number;

  constructor(
    private readonly link: EngineLink,
    opts: { now?: () => number; reconnectWaitMs?: number } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.reconnectWaitMs = opts.reconnectWaitMs ?? RECONNECT_WAIT_MS;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ApprovalsSnapshot => this.snapshot;

  /** Reads now if the computer is connected, and again on every reconnect. */
  attach(): void {
    this.disposed = false;
    this.offs.push(
      this.link.onConnected(() => void this.refresh()),
      this.link.onEvent((event, payload) => this.onEvent(event, payload)),
    );
    if (this.link.hello) void this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
  }

  /** Forgets everything, after the phone unpairs. */
  reset(): void {
    this.set({ pending: [], answered: [], trunks: {}, loaded: false, error: null, sending: {}, failed: {} });
  }

  /**
   * Reads every pending approval. One that was waiting here but is no longer on the engine's list was
   * answered (or ran out of time) while this phone wasn't listening, so it moves to Answered.
   */
  async refresh(): Promise<void> {
    try {
      const [execs, plugins, agents] = await Promise.all([
        this.link.request('exec.approval.list', {}),
        this.link.request('plugin.approval.list', {}).catch(() => []),
        this.link.request('agents.list', {}).catch(() => null),
      ]);
      const pending = [
        ...itemsOf(execs).map((item) => readApproval(item, 'exec')),
        ...itemsOf(plugins).map((item) => readApproval(item, 'plugin')),
      ].filter((a): a is Approval => a !== null);
      const ids = new Set(pending.map((a) => a.id));
      const now = this.now();
      const left = this.snapshot.pending.filter((a) => !ids.has(a.id)).map((a) => this.ended(a, a.expiresAtMs && a.expiresAtMs <= now ? 'expired' : 'gone', false, 'elsewhere'));
      const trunks = agents ? Object.fromEntries(readAgents(agents).agents) : this.snapshot.trunks;
      this.set({
        pending: sortPending(pending),
        answered: [...left, ...this.snapshot.answered].slice(0, ANSWERED_KEPT),
        trunks,
        loaded: true,
        error: null,
        failed: Object.fromEntries(Object.entries(this.snapshot.failed).filter(([id]) => ids.has(id))),
      });
    } catch (error) {
      this.set({ error: messageOf(error) });
    }
  }

  onEvent(event: string, payload: unknown): void {
    if (event === 'exec.approval.requested' || event === 'plugin.approval.requested') {
      const approval = readApproval(payload, event.startsWith('plugin') ? 'plugin' : 'exec');
      if (!approval || this.snapshot.pending.some((a) => a.id === approval.id)) return;
      this.set({ pending: sortPending([...this.snapshot.pending, approval]) });
    } else if (event === 'exec.approval.resolved' || event === 'plugin.approval.resolved') {
      const p = rec(payload);
      this.settle(str(p.id), str(p.decision), 'elsewhere');
    }
  }

  /**
   * Sends this phone's answer. If the computer isn't reachable yet (the phone was just woken from the
   * background by a notification button), it waits for the connection to come back first.
   * Resolves true when the engine took the answer.
   */
  async answer(id: string, decision: ApprovalDecision): Promise<boolean> {
    let approval = this.snapshot.pending.find((a) => a.id === id);
    if (!approval && !this.link.hello) {
      // Opened cold from a notification button: read the list once the computer answers.
      await this.connected().then(() => this.refresh(), () => undefined);
      approval = this.snapshot.pending.find((a) => a.id === id);
    }
    if (!approval || this.snapshot.sending[id]) return false;
    const { [id]: _cleared, ...failed } = this.snapshot.failed;
    this.set({ sending: { ...this.snapshot.sending, [id]: decision }, failed });
    try {
      await this.connected();
      await this.link.request(approval.kind === 'plugin' ? 'plugin.approval.resolve' : 'exec.approval.resolve', { id, decision });
      this.done(id);
      this.settle(id, decision, 'phone');
      return true;
    } catch (error) {
      this.done(id);
      const message = messageOf(error);
      if (alreadySettled(message)) {
        // Someone else answered first, or it ran out of time; its resolved event may follow.
        const still = this.snapshot.pending.find((a) => a.id === id);
        if (still) this.move(still, this.ended(still, still.expiresAtMs && still.expiresAtMs <= this.now() ? 'expired' : 'gone', false, 'elsewhere'));
        return false;
      }
      const words = this.link.hello ? `Your answer didn’t go through: ${message}` : 'Your computer isn’t connected right now. Try again when it’s back.';
      this.set({ failed: { ...this.snapshot.failed, [id]: words } });
      return false;
    }
  }

  private connected(): Promise<void> {
    if (this.link.hello) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('not connected'));
      }, this.reconnectWaitMs);
      const off = this.link.onConnected(() => {
        clearTimeout(timer);
        off();
        resolve();
      });
    });
  }

  private done(id: string): void {
    const { [id]: _sent, ...sending } = this.snapshot.sending;
    this.set({ sending });
  }

  private settle(id: string, decision: string, by: Answered['by']): void {
    const approval = this.snapshot.pending.find((a) => a.id === id);
    if (!approval) {
      // Our own answer's resolved event lands after the reply: keep "on this phone".
      return;
    }
    const allowed = decision === 'allow-once' || decision === 'allow-always';
    const timedOut = !allowed && by === 'elsewhere' && Boolean(approval.expiresAtMs && approval.expiresAtMs <= this.now() + 1000);
    this.move(approval, this.ended(approval, timedOut ? 'expired' : allowed ? 'allowed' : 'denied', decision === 'allow-always', by));
  }

  private ended(approval: Approval, outcome: Answered['outcome'], always: boolean, by: Answered['by']): Answered {
    return { ...approval, outcome, always, by, at: this.now() };
  }

  private move(approval: Approval, answered: Answered): void {
    const { [approval.id]: _failed, ...failed } = this.snapshot.failed;
    this.set({
      pending: this.snapshot.pending.filter((a) => a.id !== approval.id),
      answered: [answered, ...this.snapshot.answered.filter((a) => a.id !== approval.id)].slice(0, ANSWERED_KEPT),
      failed,
    });
  }

  private set(patch: Partial<ApprovalsSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

function sortPending(list: Approval[]): Approval[] {
  return [...list].sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
}
