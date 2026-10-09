// One open chat: its messages from chat.history, the reply streaming in from the engine's `chat` events
// (status, delta, then final, error or aborted), and what you send with chat.send. It follows the window's
// SaplingSession (window/src/connect/session.ts) in the parts a phone needs: the idempotency key is the run id,
// a finished run reads the history again, and every reconnect reads it again, so the engine's copy always wins.
import type { EngineLink } from '../pairing/pairingSession';

export type ChatItem =
  | { kind: 'user'; key: string; text: string; at: number }
  | { kind: 'assistant'; key: string; text: string; at: number }
  /** A turn's tool calls, folded into one quiet line. */
  | { kind: 'work'; key: string; steps: string[]; durationMs: number }
  | { kind: 'notice'; key: string; text: string }
  | { kind: 'error'; key: string; text: string };

/** A message sent from this phone that the history doesn't hold yet. */
export type OwnSend = { id: string; text: string; at: number; state: 'sending' | 'sent' | 'failed'; error?: string };

/** The reply being written right now. */
export type LiveReply = { runId: string; text: string; phase: string | null; startedAt: number };

export type ConversationSnapshot = {
  items: ChatItem[];
  /** A history read has landed. */
  loaded: boolean;
  /** Why the last history read failed. */
  error: string | null;
  sends: OwnSend[];
  live: LiveReply | null;
  /** How the last reply ended when it didn't finish: stopped, or the engine's error. */
  ended: { runId: string; text: string; failed: boolean } | null;
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The text parts of a message's content, joined the way the window's history reader joins them. */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => rec(part).type === 'text')
    .map((part) => str(rec(part).text))
    .join('');
}

const STEP_TITLES: Record<string, string> = {
  exec: 'Ran a command',
  process: 'Checked on a command',
  read: 'Read a file',
  write: 'Wrote a file',
  edit: 'Edited a file',
  apply_patch: 'Edited files',
  web_search: 'Searched the web',
  web_fetch: 'Read a web page',
  browser: 'Used the browser',
  computer: 'Used the computer',
  memory_search: 'Looked in its memory',
  memory_get: 'Looked in its memory',
  sessions_send: 'Messaged another Trunk',
  sessions_spawn: 'Started a helper',
  message: 'Sent a message',
};

/** A plain name for one tool call. */
export function stepTitle(tool: string): string {
  return STEP_TITLES[tool] ?? (tool ? `Used ${tool.replace(/[_.-]+/g, ' ')}` : 'Did a step');
}

/** When a message was written: the engine's record time, else the message's own time. */
const writtenAt = (m: Record<string, unknown>) => num(rec(m.__branch).recordTimestampMs) || num(m.timestamp);

/** The run a user message started, from the idempotency key the engine kept with it (`<runId>:user`). */
function runKeyOf(m: Record<string, unknown>): string {
  const key = str(m.idempotencyKey) || str(rec(m.__branch).idempotencyKey);
  return key.endsWith(':user') ? key.slice(0, -':user'.length) : '';
}

const MEDIA_PARTS = new Set(['image', 'audio', 'video', 'file']);

/** The chat as the phone shows it: your messages, the replies, one work line per turn, notices and errors. */
export function historyItems(messages: readonly unknown[]): { items: ChatItem[]; runKeys: Set<string> } {
  const items: ChatItem[] = [];
  const runKeys = new Set<string>();
  let work: { at: number; steps: string[]; start: number } | null = null;
  let turnStart = 0;
  let lastTs = 0;
  const closeWork = () => {
    if (!work) return;
    items[work.at] = { kind: 'work', key: items[work.at].key, steps: work.steps, durationMs: Math.max(0, lastTs - work.start) };
    work = null;
  };
  for (const [index, raw] of messages.entries()) {
    const m = rec(raw);
    const at = writtenAt(m);
    const key = `h:${index}`;
    if (m.role === 'user') {
      closeWork();
      turnStart = num(m.timestamp) || at;
      const runKey = runKeyOf(m);
      if (runKey) runKeys.add(runKey);
      const provenance = rec(m.provenance);
      if (str(provenance.kind) === 'internal_system' && str(provenance.sourceTool).toLowerCase() === 'main_session_restart_recovery') {
        items.push({ kind: 'notice', key, text: 'Continued after an update' });
      } else {
        const text = messageText(m.content).trim();
        const files = Array.isArray(m.content) ? m.content.filter((part) => MEDIA_PARTS.has(str(rec(part).type))).length : 0;
        if (text || files) items.push({ kind: 'user', key, text: text || (files === 1 ? 'Sent a file' : `Sent ${files} files`), at: num(m.timestamp) || at });
      }
    } else if (m.role === 'assistant') {
      const parts = Array.isArray(m.content) ? m.content : [m.content];
      let texts: string[] = [];
      // Words said before a tool call read before the work line, as they were said.
      const flush = (at2: string) => {
        if (texts.length) items.push({ kind: 'assistant', key: at2, text: texts.join('\n\n'), at });
        texts = [];
      };
      for (const [i, part] of parts.entries()) {
        const p = rec(part);
        if (p.type === 'toolCall') {
          flush(`${key}:${i}`);
          if (!work) {
            work = { at: items.length, steps: [], start: turnStart || at };
            items.push({ kind: 'work', key: `${key}:work`, steps: [], durationMs: 0 });
          }
          work.steps.push(stepTitle(str(p.name)));
        } else if (p.type === 'text' && str(p.text).trim()) {
          texts.push(str(p.text).trim());
        } else if (typeof part === 'string' && part.trim()) {
          texts.push(part.trim());
        }
      }
      flush(key);
      if (str(m.stopReason) === 'error' && str(m.errorMessage)) items.push({ kind: 'error', key: `${key}:error`, text: str(m.errorMessage) });
    } else if (m.role === 'custom' && m.display === true) {
      const text = messageText(m.content).trim();
      if (text) items.push(str(m.customType) === 'run-failed-before-reply' ? { kind: 'error', key, text } : { kind: 'notice', key, text });
    }
    if (m.role !== 'custom' && m.role !== 'system') lastTs = Math.max(lastTs, at);
  }
  closeWork();
  return { items, runKeys };
}

/** Plain words for the engine's startup phases (ChatRunStartupPhaseSchema). */
const PHASES: Record<string, string> = {
  waiting_for_state: 'Getting ready…',
  preparing_workspace: 'Getting its workspace ready…',
  naming_worktree: 'Getting its workspace ready…',
  creating_worktree: 'Getting its workspace ready…',
  running_setup: 'Running setup…',
  provisioning_environment: 'Getting its computer ready…',
  preparing_context: 'Reading the chat…',
  memory_flushing: 'Saving what it learned…',
  starting_model: 'Starting the model…',
};

/** What the header and the reply bubble say before the first words arrive. */
export function phaseLabel(phase: string | null): string {
  return (phase && PHASES[phase]) || 'Thinking…';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Conversation {
  private snapshot: ConversationSnapshot = { items: [], loaded: false, error: null, sends: [], live: null, ended: null };
  private readonly listeners = new Set<() => void>();
  private readonly offs: Array<() => void> = [];
  /** Only the newest history read may land. */
  private reads = 0;
  /** Counts the live events this chat has seen; a history read only speaks for the reply as it was when the read began. */
  private liveEvents = 0;
  /**
   * The reply whose whole text this chat's events carry. The engine sends a connection an addition alone once that
   * connection holds the frame before it (server-broadcast-live-text.ts `canSendDelta`), whichever chat the phone
   * shows; the phone's connection rebuilds the whole text into every frame (PhoneGateway `chatStream`), so each
   * delta here has `message`. From the first one on the events are the reply's text, word for word, and a history
   * read only lends the run's start time. Cleared on a new connection, until its first frame for the run.
   */
  private streamed: string | null = null;
  /** Runs this chat saw end; a late event or a slow history read can't bring them back. */
  private readonly finished = new Set<string>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    readonly sessionKey: string,
    private readonly link: EngineLink,
    private readonly newId: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConversationSnapshot => this.snapshot;

  /** Reads the chat now if the computer is connected, again on every reconnect, and follows its replies live. */
  attach(): void {
    this.disposed = false;
    this.offs.push(
      this.link.onConnected(() => {
        // A new connection: the history says which reply is still being written, and its words until this
        // connection's first frame for that reply carries the whole text.
        this.streamed = null;
        void this.load();
      }),
      this.link.onEvent((event, payload) => this.onEvent(event, payload)),
    );
    if (this.link.hello) void this.load();
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  /** Reads the whole chat again. */
  async load(): Promise<void> {
    const read = ++this.reads;
    const fence = this.liveEvents;
    try {
      const history = rec(await this.link.request('chat.history', { sessionKey: this.sessionKey }));
      if (read !== this.reads || this.disposed) return;
      const { items, runKeys } = historyItems(Array.isArray(history.messages) ? history.messages : []);
      const inFlight = rec(history.inFlightRun);
      const inFlightId = str(inFlight.runId) && !this.finished.has(str(inFlight.runId)) ? str(inFlight.runId) : '';
      // A send the history now holds is drawn from the history; one that failed keeps its Try again. The history
      // holds a send when it has that send's key (`<runId>:user`), never because an earlier message said the same words.
      const sends = this.snapshot.sends.filter((send) => send.state !== 'sent' || !runKeys.has(send.id));
      const live = this.snapshot.live;
      let next: LiveReply | null = null;
      if (live && live.runId === inFlightId) {
        // The read names the reply on screen. Its words are the events' when this connection carries the whole text
        // (see `streamed`); otherwise the history's, which hold the words written before the phone was listening.
        next = { ...live, text: this.streamed === live.runId ? live.text : str(inFlight.text), startedAt: num(inFlight.startedAt) || live.startedAt };
      } else if (live && this.liveEvents !== fence && !this.finished.has(live.runId)) {
        // A reply that streamed while this read was on its way is newer than the read, which can't name it yet.
        next = live;
      } else if (inFlightId) {
        next = { runId: inFlightId, text: str(inFlight.text), phase: null, startedAt: num(inFlight.startedAt) || this.now() };
      } else if (live && !this.finished.has(live.runId) && sends.some((send) => send.id === live.runId && send.state !== 'failed')) {
        // Your message is on its way and its run hasn't reported yet: keep the Thinking bubble.
        next = live;
      }
      if (this.streamed && this.streamed !== next?.runId) this.streamed = null;
      this.set({ items, loaded: true, error: null, sends, live: next });
    } catch (error) {
      if (read !== this.reads || this.disposed) return;
      this.set({ error: messageOf(error) });
    }
  }

  /** Sends a message. The idempotency key is the run id, so sending it again never makes a second turn. */
  async send(text: string): Promise<void> {
    const message = text.trim();
    if (!message) return;
    const id = this.newId();
    this.set({ sends: [...this.snapshot.sends, { id, text: message, at: this.now(), state: 'sending' }], ended: null });
    await this.dispatch(id, message);
  }

  /** Sends a message that didn't go, again, under the same key. */
  async retry(id: string): Promise<void> {
    const send = this.snapshot.sends.find((s) => s.id === id);
    if (!send || send.state !== 'failed') return;
    this.patchSend(id, { state: 'sending', error: undefined });
    await this.dispatch(id, send.text);
  }

  /** Stops the reply being written. */
  async stop(): Promise<void> {
    const live = this.snapshot.live;
    if (!live) return;
    try {
      await this.link.request('chat.abort', { sessionKey: this.sessionKey, runId: live.runId });
    } catch (error) {
      this.set({ ended: { runId: live.runId, text: `Couldn’t stop it: ${messageOf(error)}`, failed: true } });
    }
  }

  /** Opening a chat clears its unread mark, as the window does (sessions.patch, guarded by the mark's time). */
  async markRead(row: { unread: boolean; markedUnreadAt?: number; agentId?: string }): Promise<void> {
    if (!row.unread) return;
    await this.link
      .request('sessions.patch', { key: this.sessionKey, unread: false, ...(row.agentId ? { agentId: row.agentId } : {}), expectedMarkedUnreadAt: row.markedUnreadAt ?? null })
      .catch(() => undefined);
  }

  private async dispatch(id: string, message: string): Promise<void> {
    if (!this.snapshot.live) this.set({ live: { runId: id, text: '', phase: null, startedAt: this.now() } });
    try {
      await this.link.request('chat.send', { sessionKey: this.sessionKey, message, idempotencyKey: id });
      this.patchSend(id, { state: 'sent' });
    } catch (error) {
      this.patchSend(id, { state: 'failed', error: messageOf(error) });
      if (this.snapshot.live?.runId === id) this.set({ live: null });
    }
  }

  private patchSend(id: string, patch: Partial<OwnSend>): void {
    this.set({ sends: this.snapshot.sends.map((send) => (send.id === id ? { ...send, ...patch } : send)) });
  }

  private onEvent(event: string, payload: unknown): void {
    const p = rec(payload);
    if (str(p.sessionKey) !== this.sessionKey) return;
    if (event === 'chat') {
      this.onChat(p);
    } else if (event === 'sessions.changed' && !this.snapshot.live) {
      // Something else changed this chat (a message typed on the computer, a reset): read it again, once.
      this.loadSoon();
    }
  }

  private onChat(p: Record<string, unknown>): void {
    const runId = str(p.runId);
    const state = str(p.state);
    if (!runId || this.finished.has(runId)) return;
    const live = this.snapshot.live;
    // A reply started somewhere else (the computer, an automation) streams here too.
    const current: LiveReply = live?.runId === runId ? live : { runId, text: '', phase: null, startedAt: this.now() };
    if (state === 'status' || state === 'delta') this.liveEvents += 1;
    if (state === 'status') {
      this.set({ live: { ...current, phase: str(p.phase) || null } });
    } else if (state === 'delta') {
      // A frame with `message` (or a replacement) is the reply's whole text so far; one without (an engine that sends
      // none) adds to the frame before it.
      const message = rec(p.message);
      const whole = 'content' in message ? messageText(message.content) : p.replace === true ? str(p.deltaText) : null;
      if (whole !== null) this.streamed = runId;
      this.set({ live: { ...current, text: whole ?? current.text + str(p.deltaText), phase: null } });
    } else if (state === 'final' || state === 'error' || state === 'aborted') {
      this.finished.add(runId);
      if (state === 'error') this.set({ ended: { runId, text: str(p.errorMessage) || 'The reply stopped with an error.', failed: true } });
      else if (state === 'aborted') this.set({ ended: { runId, text: 'Stopped.', failed: false } });
      // The finished reply is read from the history, so it reads exactly as the computer shows it. Until that
      // read lands the streamed text stays on screen: no gap between the live reply and the saved one.
      void this.load().then(() => {
        // A failed read keeps the streamed words on screen rather than leaving a gap.
        if (this.snapshot.live?.runId === runId && !this.snapshot.error) this.set({ live: null });
      });
    }
  }

  private loadSoon(delayMs = 200): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.load();
    }, delayMs);
  }

  private set(patch: Partial<ConversationSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}
