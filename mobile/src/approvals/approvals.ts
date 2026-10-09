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
  /** Why the list couldn't be read, in plain words (never the engine's own text). */
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

/** The engine's error code (ErrorCodes in gateway-error-details.ts), as the gateway client carries it. */
const codeOf = (error: unknown): string => str(rec(error).gatewayCode) || str(rec(error).code);

/** The engine refused because this phone's connection lacks a scope (FORBIDDEN, details MISSING_SCOPE). */
function missingScope(error: unknown): boolean {
  return codeOf(error) === 'FORBIDDEN' || str(rec(rec(error).details).code) === 'MISSING_SCOPE';
}

/**
 * The engine's reasons for refusing an answer because the approval isn't waiting any more: another surface
 * answered it first (approval-shared.ts APPROVAL_ALREADY_RESOLVED_DETAILS), or it ran out of time or the
 * engine restarted (approval-record-lookup.ts APPROVAL_NOT_FOUND_DETAILS, or the APPROVAL_NOT_FOUND code that
 * infra/approval-errors.ts also accepts). Read from the error's code and details, never from its words.
 */
const SETTLED_REASONS = new Set(['APPROVAL_ALREADY_RESOLVED', 'APPROVAL_NOT_FOUND']);
function alreadySettled(error: unknown): boolean {
  const details = rec(rec(error).details);
  return SETTLED_REASONS.has(str(details.reason)) || codeOf(error) === 'APPROVAL_NOT_FOUND';
}

/** What a card says for any refused answer the phone has no specific words for. Never the engine's own text. */
export const ANSWER_FAILED_MESSAGE = 'Your answer didn’t go through. Try again, or answer it on your computer.';
export const NOT_CONNECTED_MESSAGE = 'Your computer isn’t connected right now. Try again when it’s back.';

/**
 * Plain words for why the computer refused this phone's answer, keyed by the engine's error code and details.
 * The engine's message ("missing scope: operator.approvals", "invalid decision") is written for the command
 * line and is never shown, the same rule as pairingSession.ts failureMessage.
 */
export function answerFailureMessage(error: unknown): string {
  if (missingScope(error)) return 'This phone isn’t allowed to answer approvals any more. Answer this one on your computer, or pair this phone again.';
  if (codeOf(error) === 'UNAVAILABLE') return 'Your computer couldn’t take the answer just now. Try again in a moment.';
  return ANSWER_FAILED_MESSAGE;
}

/** What the list says when the phone has no specific words for why it couldn't be read. */
export const LIST_FAILED_MESSAGE = 'Your computer didn’t send its approvals. Try again in a moment.';

/** Plain words for why the computer wouldn't list its approvals, by the same rule as answerFailureMessage. */
export function listFailureMessage(error: unknown): string {
  if (missingScope(error)) return 'This phone isn’t allowed to see approvals any more. Pair it again from Branch on your computer.';
  if (codeOf(error) === 'UNAVAILABLE') return 'Your computer is busy right now. Try again in a moment.';
  return LIST_FAILED_MESSAGE;
}

export class ApprovalInbox {
  private snapshot: ApprovalsSnapshot = { pending: [], answered: [], trunks: {}, loaded: false, error: null, sending: {}, failed: {} };
  private readonly listeners = new Set<() => void>();
  private readonly offs: Array<() => void> = [];
  private disposed = false;
  private readonly now: () => number;
  private readonly reconnectWaitMs: number;
  /**
   * The decision in a *.approval.resolved event heard while this phone's own answer to that approval was on its
   * way. The engine broadcasts the resolution before it replies to the surface that answered, so whether the
   * event was ours is only known from the reply: { ok: true } means this phone's answer counted.
   */
  private readonly heard = new Map<string, string>();
  /**
   * What each list read still on its way has missed: the engine answers a read with the list as it was when the
   * read arrived, so a request or resolution heard after that must win over the read's answer.
   */
  private readonly reads = new Set<{ requested: Map<string, Approval>; resolved: Set<string> }>();

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
    this.heard.clear();
    this.set({ pending: [], answered: [], trunks: {}, loaded: false, error: null, sending: {}, failed: {} });
  }

  /**
   * Reads every pending approval. One that was waiting here but is no longer on the engine's list was
   * answered (or ran out of time) while this phone wasn't listening, so it moves to Answered.
   */
  async refresh(): Promise<void> {
    const since = { requested: new Map<string, Approval>(), resolved: new Set<string>() };
    this.reads.add(since);
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
      for (const approval of since.requested.values()) if (!pending.some((a) => a.id === approval.id)) pending.push(approval);
      const current = pending.filter((a) => !since.resolved.has(a.id));
      const ids = new Set(current.map((a) => a.id));
      const now = this.now();
      const left = this.snapshot.pending.filter((a) => !ids.has(a.id)).map((a) => this.ended(a, a.expiresAtMs && a.expiresAtMs <= now ? 'expired' : 'gone', false, 'elsewhere'));
      const trunks = agents ? Object.fromEntries(readAgents(agents).agents) : this.snapshot.trunks;
      this.set({
        pending: sortPending(current),
        answered: [...left, ...this.snapshot.answered].slice(0, ANSWERED_KEPT),
        trunks,
        loaded: true,
        error: null,
        failed: Object.fromEntries(Object.entries(this.snapshot.failed).filter(([id]) => ids.has(id))),
      });
    } catch (error) {
      this.set({ error: listFailureMessage(error) });
    } finally {
      this.reads.delete(since);
    }
  }

  onEvent(event: string, payload: unknown): void {
    if (event === 'exec.approval.requested' || event === 'plugin.approval.requested') {
      const approval = readApproval(payload, event.startsWith('plugin') ? 'plugin' : 'exec');
      if (!approval) return;
      for (const read of this.reads) read.requested.set(approval.id, approval);
      if (this.snapshot.pending.some((a) => a.id === approval.id)) return;
      this.set({ pending: sortPending([...this.snapshot.pending, approval]) });
    } else if (event === 'exec.approval.resolved' || event === 'plugin.approval.resolved') {
      const p = rec(payload);
      const id = str(p.id);
      for (const read of this.reads) read.resolved.add(id);
      if (this.snapshot.sending[id]) {
        this.heard.set(id, str(p.decision));
        return;
      }
      this.settle(id, str(p.decision), 'elsewhere');
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
      this.heard.delete(id);
      this.done(id);
      this.settle(id, decision, 'phone');
      return true;
    } catch (error) {
      const heard = this.heard.get(id);
      this.heard.delete(id);
      this.done(id);
      if (heard !== undefined) {
        // Another surface's answer reached the engine first; its resolved event says what it was.
        this.settle(id, heard, 'elsewhere');
        return false;
      }
      if (alreadySettled(error)) {
        // Someone else answered first, or it ran out of time, and this phone didn't hear how.
        const still = this.snapshot.pending.find((a) => a.id === id);
        if (still) this.move(still, this.ended(still, still.expiresAtMs && still.expiresAtMs <= this.now() ? 'expired' : 'gone', false, 'elsewhere'));
        return false;
      }
      const words = this.link.hello ? answerFailureMessage(error) : NOT_CONNECTED_MESSAGE;
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
      // Already moved: answered on this phone, or the same resolution heard again after a reconnect.
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
