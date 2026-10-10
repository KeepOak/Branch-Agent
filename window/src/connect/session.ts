// The open conversation on the engine: history, the live run, approvals and sending. It starts on the
// default Trunk's main conversation and switches with open(key) (DESIGN-SPEC §4.1.1.1 row click).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { EventFrame, HelloOk } from "@branch/gateway-client/browser";
import { BranchGateway, type GatewayStatus } from "./gateway";
import type { SendExtras, WindowEngine } from "./engine";
import { RunStreams, readRunEvent } from "./stream-order";
import { storedOperatorToken } from "./device-token-store";
import { withOwner } from "./agent-owner";
import { projectRun, type Approval, type Block } from "../thread/model";
import { historyToBlocks, markStopped, readApprovalRecords } from "../thread/history";
import { sanitizeBlocks } from "../thread/tool-output-display";
import { isPreparationPending, PreparationRetry, preparationTimeoutLabel } from "./preparation-status";
import { addNotSent, healNotSent } from "../composer/queue";
import { droppedFiles, engineKeyOf, FirstSendEcho, heldRuns, UnconfirmedSends } from "./unconfirmed";
import { failedAck, isRetryable, refusedOrUnsent, requestWithRetry } from "./send-errors";
import { firstSendEcho, shouldKeepFirstSendEcho } from "../composer/sending";
import { safeStorage } from "../composer/drafts";

export type SessionSnapshot = {
  status: GatewayStatus;
  /** The open conversation. */
  sessionKey: string | null;
  /** The default Trunk's main conversation (hello.snapshot.sessionDefaults.mainSessionKey). */
  mainKey: string | null;
  name: string;
  history: Block[];
  live: Block[];
  pendingUser: string | null;
  /** Messages the engine accepted but no turn has picked up yet (chat.history pendingInputs), then "delivered" until
   *  the history shows them in place. A post by another Trunk or an outside agent waits here while a turn runs. */
  queued: QueuedMessage[];
  liveRunId: string | null;
  /** When the live run started (engine time), so "Working · 3m 12s" counts from the real start, not from when this
   *  window opened it. */
  liveStartedAt: number | null;
  doneAt: number | null;
  lastActivityAt: number | null;
  error: string | null;
  /** How the last run in this conversation ended, so the done cheer speaks for that run only (§4.2.5). */
  ended: RunEnd | null;
  /** What you told the Trunk while it worked (sent with queueMode "steer"), until the turn ends (§4.2.2 Steered note). */
  steered: SteeredNote[];
  /**
   * False until this conversation's transcript has been read. Empty history before that is still loading,
   * not a new conversation, so the thread must not show the empty start screen. A cached transcript with
   * no messages is not that read.
   */
  historyReady: boolean;
};

/** `absorbed`: the engine took your message into another turn ("ok"); that turn's own end is what counts. */
export type RunEnd = { runId: string; outcome: "done" | "stopped" | "failed" | "absorbed"; at: number };
/** `target` is the turn it was told to; the note goes when that turn ends and the history has it in place. */
export type SteeredNote = { runId: string; text: string; target: string };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** A run's start time, as the engine reports it on its in-flight snapshot or lifecycle start. */
const runStart = (v: Record<string, unknown>): number | null =>
  typeof v.startedAt === "number" && Number.isFinite(v.startedAt) && v.startedAt > 0 ? v.startedAt : null;

/** `runId`: the run the engine admitted it as (pendingInputs `runId`, the sender's idempotency key). */
export type QueuedMessage = { key: string; block: Extract<Block, { kind: "user" }>; state: "queued" | "delivered"; runId?: string };

/** The engine's waiting inputs as user blocks, merged with what was shown: gone from the engine means a turn picked
 *  it up ("delivered"); a full history read (`settled`) drops the delivered ones, since the history now has them. */
export function mergeQueued(
  shown: readonly QueuedMessage[],
  pendingInputs: unknown,
  sessionKey: string,
  settled: boolean,
  /** Runs this window already shows in its own place (your message above the turn, a steered note). The engine
   *  lists their input as waiting while it admits them; drawing it again made a grey copy under the dots. */
  ownRuns: ReadonlySet<string> = new Set(),
): QueuedMessage[] {
  const items = (Array.isArray(rec(pendingInputs).items) ? (rec(pendingInputs).items as unknown[]) : [])
    .map(rec)
    .filter((item) => item.state === "queued" && item.message && str(item.id) && !ownRuns.has(str(item.runId)));
  const blocks = historyToBlocks(items.map((item) => item.message), [], sessionKey, null);
  const waiting: QueuedMessage[] = [];
  items.forEach((item, at) => {
    const block = blocks.filter((b) => b.kind === "user")[at] as Extract<Block, { kind: "user" }> | undefined;
    if (block) waiting.push({ key: `queued:${str(item.id)}`, block: { ...block, key: `queued:${str(item.id)}` }, state: "queued", ...(str(item.runId) ? { runId: str(item.runId) } : {}) });
  });
  const now = new Set(waiting.map((q) => q.key));
  const delivered = settled ? [] : shown.filter((q) => !now.has(q.key) && !(q.runId && ownRuns.has(q.runId))).map((q) => ({ ...q, state: "delivered" as const }));
  return [...delivered, ...waiting];
}

export type GatewayEventListener = (event: string, payload: unknown) => void;


/** The group chat a room's lead conversation belongs to: `agent:<lead>:room:<roomId>` (engine rooms.send). */
export function roomIdOf(sessionKey: string): string {
  return /^agent:[^:]+:room:([^:]+)$/.exec(sessionKey)?.[1] ?? "";
}

export class SaplingSession {
  gatewayUrl: string;
  private readonly eventListeners = new Set<GatewayEventListener>();
  private wanted: string | null;
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly runs = new RunStreams();
  private readonly approvals = new Map<string, Approval>();
  private readonly finished = new Set<string>();
  /** Runs that were stopped (Stop, or the engine's "aborted"): their turn says "Stopped", never "Done". */
  private readonly stoppedRuns = new Set<string>();
  /** Messages this window sent, by run id (= the idempotency key, engine chat-send-session.ts): their text, and
   *  whether the thread draws them itself (your message over its turn, or a steered note). */
  private readonly ownSends = new Map<string, { text: string; shown: boolean; attachments: number }>();
  /** First message of an empty conversation, kept on screen until history holds it (unconfirmed.ts FirstSendEcho). */
  private readonly firstEcho = new FirstSendEcho();
  /** Messages sent but not confirmed (connect/unconfirmed.ts). */
  private readonly unconfirmed = new UnconfirmedSends({
    request: (method, params) => this.gateway.request(method, params),
    engine: () => (this.snapshot.status.phase === "connected" ? this.engineKey : null),
    view: {
      before: (sessionKey, item) => this.showResend(sessionKey, item.id, item.text, item.sentWith?.queueMode, item.sentWith?.attachments ?? 0),
      after: (sessionKey) => {
        if (sessionKey === this.snapshot.sessionKey) this.refreshSettled();
      },
    },
    notice: (text) => this.set({ error: text }),
  });
  /** The engine this window is connected to (unconfirmed.ts engineKeyOf), from its last hello. */
  private engineKey: string | null = null;
  /** The engine's session id for the conversation last read, so a send knows whether its conversation existed. */
  private readSession: { sessionKey: string; id: string } | null = null;
  /** Turns that failed while their history couldn't be read: whether the engine kept your message is decided by the
   *  next read of that same conversation. */
  private readonly unchecked = new Map<string, { sessionKey: string; text: string; attachments: number; failure: string }>();
  /** Whether any event of the live run has arrived (until one has, the engine's ack may still name its run). */
  private liveSeen = false;
  /** Codex emits many updates per item. Keep raw events off React's render path between frames. */
  private liveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Only the newest `chat.history` read may land; an older one resolving later would bring back stale history. */
  private historyReads = 0;
  /** Transcripts already read, keyed by conversation, so a click paints messages before the next engine read. */
  private readonly historyCache = new Map<string, Block[]>();
  /** One full `chat.history` read per conversation, shared by opening it and by warming the sidebar. */
  private readonly transcriptFlight = new Map<string, Promise<unknown>>();
  /** Newest read per conversation, so a slower older read cannot replace a newer transcript. */
  private readonly historyReadGen = new Map<string, number>();
  private warmQueue: string[] = [];
  private warmRunning = 0;
  /** Bumped when the engine changes, so a read from the previous engine cannot fill the cache. */
  private historyEpoch = 0;
  /** The last history read's failure, while its notice may still show. */
  private readError: string | null = null;
  /** The newest `chat.history` read, so a finishing run can wait for the one that really lands. */
  private currentRead: Promise<void> | null = null;
  private preparationRetry: ReturnType<typeof setTimeout> | null = null;
  private readonly preparationBackoff = new PreparationRetry();
  private stopped = false;
  private gateway: BranchGateway;
  private retiringGateway: BranchGateway | null = null;
  private retiringRunId: string | null = null;
  private sharedToken: string | undefined;
  /** The credential the engine's HTTP routes accept from this window: the shared token, else the paired device's. */
  get httpToken(): string | null {
    return this.sharedToken || storedOperatorToken(this.gatewayUrl);
  }

  /** `initialKey` reopens the conversation the window last showed (§3.3 "Reopen where you were"). */
  constructor(url: string, sharedToken: string | undefined, initialKey: string | null = null) {
    this.gatewayUrl = url;
    this.sharedToken = sharedToken;
    this.wanted = initialKey;
    this.snapshot = {
      status: { phase: "connecting" },
      sessionKey: null,
      mainKey: null,
      name: "",
      history: [],
      live: [],
      pendingUser: null,
      queued: [],
      liveRunId: null,
      liveStartedAt: null,
      doneAt: null,
      lastActivityAt: null,
      error: null,
      steered: [],
      ended: null,
      historyReady: false,
    };
    this.gateway = this.createGateway(url, sharedToken);
  }

  private createGateway(url: string, sharedToken: string | undefined): BranchGateway {
    let gateway: BranchGateway;
    gateway = new BranchGateway({
      url,
      sharedToken,
      onStatus: (status) => { if (this.gateway === gateway) this.onStatus(status); },
      onEvent: (event) => this.onEvent(event),
    });
    return gateway;
  }

  start(): void {
    this.stopped = false;
    this.gateway.start();
  }

  stop(): void {
    if (this.liveRefreshTimer) clearTimeout(this.liveRefreshTimer);
    this.stopped = true;
    this.warmQueue = [];
    this.historyEpoch += 1;
    this.unconfirmed.stop();
    if (this.preparationRetry) clearTimeout(this.preparationRetry);
    this.preparationRetry = null;
    this.preparationBackoff.reset();
    this.gateway.stop();
    this.retiringGateway?.stop();
    this.retiringGateway = null;
    this.retiringRunId = null;
  }

  /** The desktop swapped the engine in place: reconnect at once. */
  reconnectNow(): void {
    this.gateway.reconnectNow();
  }

  /** Move new requests to a ready successor without unmounting the composer or losing O's live events. */
  handoff(url: string, sharedToken = this.sharedToken): void {
    if (url === this.gatewayUrl) { this.reconnectNow(); return; }
    this.historyEpoch += 1;
    this.historyReads += 1;
    this.historyCache.clear();
    this.transcriptFlight.clear();
    this.warmQueue = [];
    this.retiringGateway?.stop();
    this.retiringRunId = this.snapshot.liveRunId;
    this.retiringGateway = this.retiringRunId || this.snapshot.pendingUser !== null ? this.gateway : null;
    if (!this.retiringGateway) this.gateway.stop();
    this.gatewayUrl = url;
    this.sharedToken = sharedToken;
    this.gateway = this.createGateway(url, sharedToken);
    this.engineCache = null;
    this.gateway.start();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  private engineCache: { key: string | null; hello: HelloOk | null; engine: WindowEngine } | null = null;
  private connectionEpoch = 0;

  /** The shared engine handle for the open conversation (rebuilt when the conversation or connection changes). */
  get engine(): WindowEngine {
    const status = this.snapshot.status;
    const hello = status.phase === "connected" ? status.hello : null;
    const key = this.snapshot.sessionKey;
    if (!this.engineCache || this.engineCache.key !== key || this.engineCache.hello !== hello) {
      this.engineCache = { key, hello, engine: buildEngine(this, key, hello) };
    }
    return this.engineCache.engine;
  }

  /** Reads the open conversation's history again from the engine. */
  reload(): Promise<void> {
    return this.loadHistory();
  }

  /** The Trunk got ready after this window stopped waiting for it: open the conversation again, with a fresh wait. */
  retryOpen(): void {
    const { status, sessionKey } = this.snapshot;
    if (this.stopped || status.phase !== "connected" || !sessionKey) return;
    this.preparationBackoff.reset();
    void this.bootstrap(status, sessionKey);
  }

  /** Any engine method, for the parts of the window that call the engine themselves. */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.gateway.request<T>(method, params);
  }

  requestScopeUpgrade(options?: { onPending?: (requestId: string) => void }) {
    return this.gateway.requestScopeUpgrade(options);
  }

  cancelScopeUpgrade(): void {
    this.gateway.cancelScopeUpgrade();
  }

  /** Every event the engine pushes, raw (`event`, `payload`). */
  onGatewayEvent(listener: GatewayEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Local unconfirmed echo of the first message, so opening the new conversation does not flash EmptyState. */
  seedFirstSend(sessionKey: string, text: string, runId: string = crypto.randomUUID()): string {
    const echo = firstSendEcho(text);
    if (!echo || !sessionKey) return runId;
    this.firstEcho.set(sessionKey, echo, runId);
    this.ownSends.set(runId, { text: echo, shown: true, attachments: 0 });
    if (this.snapshot.sessionKey === sessionKey) {
      this.liveSeen = false;
      this.set({ pendingUser: echo, liveRunId: this.snapshot.liveRunId ?? runId, liveStartedAt: this.snapshot.liveStartedAt ?? Date.now(), live: [], doneAt: null, error: null });
    }
    return runId;
  }

  /** Opens another conversation. A transcript already read paints at once; one still loading does not look empty. */
  async open(key: string): Promise<void> {
    if (!key || key === this.snapshot.sessionKey) {
      const echo = this.firstEcho.peek(key);
      if (echo && !this.snapshot.pendingUser && !this.snapshot.history.length && this.snapshot.historyReady !== false) this.seedFirstSend(key, echo.text, echo.runId);
      // A failed read leaves the conversation unready. Opening it again, including the same row, tries the read once more.
      if (key && key === this.snapshot.sessionKey && this.snapshot.historyReady === false && this.snapshot.error) await this.loadOpen();
      return;
    }
    this.wanted = key;
    this.runs.clear();
    if (this.liveRefreshTimer) clearTimeout(this.liveRefreshTimer);
    this.liveRefreshTimer = null;
    this.approvals.clear();
    this.ownSends.clear();
    const echo = this.firstEcho.peek(key);
    if (echo) this.ownSends.set(echo.runId, { text: echo.text, shown: true, attachments: 0 });
    const cached = this.cachedTranscript(key);
    this.set({
      sessionKey: key,
      history: cached.history,
      historyReady: cached.historyReady,
      live: [],
      queued: [],
      doneAt: null,
      lastActivityAt: null,
      error: null,
      steered: [],
      ended: null,
      pendingUser: echo?.text ?? null,
      liveRunId: echo?.runId ?? null,
      liveStartedAt: echo ? Date.now() : null,
    });
    await this.loadOpen();
  }

  /** The transcript this window can paint now. An empty cached read is not final: the first message may arrive later. */
  private cachedTranscript(key: string): { history: Block[]; historyReady: boolean } {
    const history = this.historyCache.get(key);
    if (history && history.length > 0) return { history, historyReady: true };
    return { history: [], historyReady: false };
  }

  private async loadOpen(): Promise<void> {
    try {
      await Promise.all([this.backfillApprovals().catch(() => undefined), this.loadHistory()]);
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Reads transcripts for sidebar rows before a click, a few at a time. Opening one of them can then
   * paint from memory instead of waiting on `chat.history`.
   */
  warmHistories(keys: readonly string[]): void {
    if (this.stopped) return;
    for (const key of keys) {
      if (this.warmQueue.length >= 8) break;
      if (!key || this.historyCache.has(key) || this.warmQueue.includes(key) || this.transcriptFlight.has(key)) continue;
      this.warmQueue.push(key);
    }
    this.pumpWarm();
  }

  private pumpWarm(): void {
    if (this.stopped) {
      this.warmQueue = [];
      return;
    }
    while (this.warmRunning < 2 && this.warmQueue.length) {
      const key = this.warmQueue.shift();
      if (!key || this.historyCache.has(key)) continue;
      const epoch = this.historyEpoch;
      this.warmRunning += 1;
      void this.chatHistory(key).then((history) => {
        if (this.stopped || epoch !== this.historyEpoch || this.historyCache.has(key)) return;
        const messages = rec(history).messages;
        this.historyCache.set(key, historyToBlocks(Array.isArray(messages) ? messages : [], [], key, null));
      }, () => undefined).finally(() => {
        this.warmRunning -= 1;
        this.pumpWarm();
      });
    }
  }

  /** The full transcript read. A click and a sidebar warm share one request while it is in flight. */
  private chatHistory(sessionKey: string): Promise<unknown> {
    const existing = this.transcriptFlight.get(sessionKey);
    if (existing) return existing;
    const flight = this.gateway.request("chat.history", { sessionKey }).finally(() => {
      if (this.transcriptFlight.get(sessionKey) === flight) this.transcriptFlight.delete(sessionKey);
    });
    this.transcriptFlight.set(sessionKey, flight);
    return flight;
  }

  private set(patch: Partial<SessionSnapshot>): void {
    const preparationDelay = patch.error && isPreparationPending(patch.error) ? this.preparationBackoff.nextDelay() : null;
    if (patch.error && isPreparationPending(patch.error) && preparationDelay === null) {
      patch = { ...patch, error: preparationTimeoutLabel(this.snapshot.name) };
    }
    this.snapshot = { ...this.snapshot, ...patch };
    if (patch.error === null || (patch.status && patch.status.phase !== "connected")) {
      if (this.preparationRetry) clearTimeout(this.preparationRetry);
      this.preparationRetry = null;
      this.preparationBackoff.reset();
    } else if (!this.stopped && patch.error && isPreparationPending(patch.error) && !this.preparationRetry) {
      this.preparationRetry = setTimeout(() => {
        this.preparationRetry = null;
        const { status, sessionKey } = this.snapshot;
        if (status.phase === "connected" && sessionKey) void this.bootstrap(status, sessionKey);
      }, preparationDelay ?? 500);
    }
    for (const listener of this.listeners) {
      listener();
    }
  }

  private onStatus(status: GatewayStatus): void {
    this.connectionEpoch += 1;
    if (status.phase !== "connected") {
      // The engine no longer knows this device: its pairing there is gone, and so are its records for it. (A request
      // for more scopes keeps the pairing.)
      if (status.phase === "pairing" && status.reason === "not-paired") this.unconfirmed.unpaired(this.gatewayUrl);
      this.set({ status });
      return;
    }
    this.engineKey = engineKeyOf(this.gatewayUrl, status.hello);
    const mainKey = readMainSessionKey(status.hello);
    const sessionKey = this.wanted ?? mainKey;
    // Every hello is a fresh engine (a restart, or an update swapped in under this window): the runs this
    // window mirrored are gone with the old one. Clear them; chat.history's inFlightRun says what still runs.
    if (!this.retiringGateway) {
      this.runs.clear();
      this.approvals.clear();
      // A fresh engine: what this window drew itself is gone with the live view, so the engine's own copies show.
      this.ownSends.clear();
      this.liveSeen = false;
      const echo = sessionKey ? this.firstEcho.peek(sessionKey) : null;
      if (echo) this.ownSends.set(echo.runId, { text: echo.text, shown: true, attachments: 0 });
      const switching = sessionKey !== this.snapshot.sessionKey;
      const cached = switching && sessionKey ? this.cachedTranscript(sessionKey) : null;
      this.set({
        sessionKey, mainKey, live: [], steered: [],
        ...(cached ? cached : {}),
        liveRunId: echo?.runId ?? null,
        liveStartedAt: echo ? Date.now() : null,
        pendingUser: echo?.text ?? null,
      });
    } else {
      this.set({ sessionKey, mainKey });
    }
    void this.bootstrap(status, sessionKey);
  }

  private async bootstrap(status: GatewayStatus, sessionKey: string | null): Promise<void> {
    const epoch = this.connectionEpoch;
    const current = () => !this.stopped && epoch === this.connectionEpoch;
    if (!sessionKey) {
      this.set({ status, error: "The engine did not say which conversation is the default Trunk's." });
      return;
    }
    try {
      const [agents] = await Promise.all([
        this.gateway.request("agents.list", {}),
        this.gateway.request("sessions.subscribe", { limit: 20 }),
      ]);
      if (!current()) return;
      this.set({ name: readAgentName(agents) });
      await Promise.all([this.backfillApprovals().catch(() => undefined), this.loadHistory()]);
      if (!current()) return;
      this.set({ status, error: null });
      if (this.engineKey) this.unconfirmed.connected(this.engineKey);
    } catch (error) {
      if (!current()) return;
      this.set({ status, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Pending approvals that were raised before this connection (docs/gateway/clients.md). */
  private async backfillApprovals(): Promise<void> {
    const list = await this.gateway.request("exec.approval.list", {});
    const items = Array.isArray(list) ? list : (rec(list).items ?? rec(list).approvals);
    if (Array.isArray(items)) {
      for (const item of items) {
        this.addApproval(rec(item));
      }
    }
  }

  private loadHistory(): Promise<void> {
    const read = this.readHistory().catch((error: unknown) => {
      // Remembered so the next read that works can take back exactly this notice, and nothing else.
      this.readError = error instanceof Error ? error.message : String(error);
      throw error;
    });
    this.currentRead = read;
    return read;
  }

  private async readHistory(): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    if (!sessionKey) {
      return;
    }
    const read = ++this.historyReads;
    const gen = (this.historyReadGen.get(sessionKey) ?? 0) + 1;
    this.historyReadGen.set(sessionKey, gen);
    const epoch = this.historyEpoch;
    // The approval ledger only dresses the steps; when it fails (right after a rewind it answered "approval not
    // found") the history still shows, without a raw notice that never clears.
    const [history, ledger] = await Promise.all([
      this.chatHistory(sessionKey),
      this.gateway.request("approval.history", { limit: 100, kind: "exec" }).catch(() => null),
    ]);
    if (epoch !== this.historyEpoch || this.historyReadGen.get(sessionKey) !== gen) {
      return; // a newer read of this conversation, or a different engine, replaced this one
    }
    const h = rec(history);
    const inFlight = rec(h.inFlightRun);
    const inFlightId = str(inFlight.runId);
    // A run this window already saw end is history now, even if the engine still lists it while it tidies up.
    const inFlightRunId = inFlightId && !this.finished.has(inFlightId) ? inFlightId : null;
    const messages = Array.isArray(h.messages) ? h.messages : [];
    const blocks = markStopped(historyToBlocks(messages, readApprovalRecords(ledger), sessionKey, inFlightRunId), this.stoppedRuns);
    this.historyCache.set(sessionKey, blocks);
    if (sessionKey !== this.snapshot.sessionKey || read !== this.historyReads) {
      return; // another conversation was opened, or a newer read started, while this one loaded
    }
    // Only the open conversation's read may say whether that conversation existed. A late read of the one
    // just left must not make a lost send in this one look like it went to a conversation that was never created.
    this.readSession = { sessionKey, id: str(h.sessionId) };
    const staleNotice = this.readError;
    this.readError = null;
    const info = rec(h.sessionInfo);
    const echo = this.firstEcho.peek(sessionKey);
    const historyHasEcho = Boolean(echo && keptInHistory(blocks, echo.runId, echo.text));
    if (historyHasEcho && echo) this.firstEcho.clear(echo.runId);
    this.set({
      history: blocks,
      historyReady: true,
      // The notice a failed read left goes once a read works; any other notice (a refused steer, an approval) stays.
      ...(staleNotice && this.snapshot.error === staleNotice ? { error: null } : {}),
      queued: mergeQueued(this.snapshot.queued, h.pendingInputs, sessionKey, true, this.shownRuns()),
      lastActivityAt: typeof info.lastActivityAt === "number" ? info.lastActivityAt : null,
      ...(inFlightRunId ? { liveRunId: inFlightRunId, liveStartedAt: runStart(inFlight) } : {}),
      ...(historyHasEcho && this.snapshot.pendingUser === echo?.text ? { pendingUser: null } : {}),
      ...(!inFlightRunId && echo && !historyHasEcho ? { pendingUser: echo.text, liveRunId: this.snapshot.liveRunId ?? echo.runId, liveStartedAt: this.snapshot.liveStartedAt ?? Date.now() } : {}),
    });
    if (inFlightRunId) {
      this.adoptInFlight(inFlightRunId, str(inFlight.text), inFlight);
    }
    this.settleRead(sessionKey, blocks, h.pendingInputs, inFlightId);
  }

  /**
   * What a read of `sessionKey` settles, for that conversation only: a failed turn whose message the engine did or
   * didn't keep, and any "Not sent" card whose message the engine turns out to hold after all (it goes).
   */
  private settleRead(sessionKey: string, history: readonly Block[], pendingInputs: unknown, inFlightId: string): void {
    const kept = heldRuns(history, pendingInputs, inFlightId);
    const held = (runId: string) => kept.has(runId);
    for (const [runId, end] of [...this.unchecked]) {
      if (end.sessionKey !== sessionKey) continue;
      this.unchecked.delete(runId);
      if (!held(runId) && !keptInHistory(history, runId, end.text)) this.notSent(sessionKey, runId, end.text, end.failure, end.attachments);
    }
    try {
      healNotSent(safeStorage(), sessionKey, [...kept]);
    } catch {
      // The line can't be read here; the card stays until it can.
    }
  }

  /** A message sent again in the open conversation is drawn like a fresh send: over its own turn, or while another
   *  turn runs as the engine's waiting copy (a steer as a steered note on that turn). Returns how to take it back. */
  private showResend(sessionKey: string, id: string, text: string, queueMode: string | undefined, attachments: number): () => void {
    if (sessionKey !== this.snapshot.sessionKey) return () => undefined;
    const busy = this.snapshot.liveRunId !== null && !this.finished.has(this.snapshot.liveRunId);
    const steer = busy && queueMode === "steer";
    this.ownSends.set(id, { text, shown: !busy || steer, attachments });
    if (steer) this.set({ steered: [...this.snapshot.steered, { runId: id, text, target: this.snapshot.liveRunId ?? "" }] });
    return () => {
      this.ownSends.delete(id);
      if (steer) this.set({ steered: this.snapshot.steered.filter((note) => note.runId !== id) });
    };
  }

  /** The connection kept for a run the previous engine still finishes goes once that run is over. */
  private releaseRetiring(runId: string): void {
    if (this.retiringGateway && (!this.retiringRunId || this.retiringRunId === runId)) {
      this.retiringGateway.stop();
      this.retiringGateway = null;
      this.retiringRunId = null;
    }
  }

  private adoptInFlight(runId: string, text: string, snapshot: Record<string, unknown>): void {
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    for (const raw of events) {
      const event = readRunEvent(raw);
      if (event?.runId === runId) this.runs.accept(event);
    }
    if (!this.runs.events(runId).some((event) => event.stream === "plan")) {
      const plan = rec(snapshot.plan);
      if (Array.isArray(plan.steps)) this.runs.accept({ runId, seq: -1, stream: "plan", ts: 0, data: { steps: plan.steps } });
    }
    if (text && !this.runs.events(runId).some((event) => event.stream === "assistant")) {
      this.runs.accept({ runId, seq: 0, stream: "assistant", ts: 0, data: { delta: text } });
    }
    this.refreshLive();
  }

  private onEvent(event: EventFrame): void {
    for (const listener of this.eventListeners) {
      listener(event.event, event.payload);
    }
    const payload = rec(event.payload);
    if (event.event === "agent" || event.event === "session.tool") {
      this.onAgentEvent(payload);
      // A turn starting in this conversation may have picked up a waiting message.
      if (str(payload.sessionKey) === this.snapshot.sessionKey && str(payload.stream) === "lifecycle" && str(rec(payload.data).phase) === "start" && this.snapshot.queued.length) {
        void this.loadQueued();
      }
    } else if (event.event === "chat") {
      const state = str(payload.state);
      if (["final", "error", "aborted"].includes(state) && this.isOurs(payload)) {
        const runId = str(payload.runId);
        const abort = state === "aborted" ? readAbort({ ...payload, aborted: true }) : null;
        if (abort === "stopped" && runId) this.stoppedRuns.add(runId);
        if (this.finished.has(runId)) {
          this.refreshSettled();
        } else if (abort === "superseded") {
          void this.finishRun(runId, "", true);
        } else {
          const failure = typeof abort === "object" && abort ? abort.failure : str(payload.errorMessage) || (state === "aborted" ? "Stopped before it started." : "It stopped before it started.");
          void this.finishRun(runId, state === "final" ? "" : failure);
        }
      }
    } else if ((event.event === "session.message" || event.event === "sessions.changed") && str(payload.sessionKey) === this.snapshot.sessionKey) {
      // A turn can end with only this (a dispatch that failed before its run reported): end the live run with it,
      // so your message is kept as Not sent instead of the thread waiting on "Thinking it over".
      const phase = str(payload.phase);
      const runId = str(payload.runId);
      if ((phase === "error" || phase === "end") && runId && runId === this.snapshot.liveRunId && !this.finished.has(runId)) {
        void this.finishRun(runId, phase === "error" ? str(payload.error) || str(payload.errorMessage) || "It stopped before it started." : "");
      }
      this.refreshSettled();
    } else if (event.event === "rooms.event" && roomIdOf(this.snapshot.sessionKey ?? "") === str(payload.roomId) && str(payload.roomId)) {
      // A post in this group chat by a Trunk or an outside agent (rooms.send): the room's lead thread shows it.
      this.refreshSettled();
    } else if (event.event === "exec.approval.requested") {
      this.addApproval(payload);
      this.refreshLive();
    } else if (event.event === "exec.approval.resolved") {
      this.resolveApproval(str(payload.id), str(payload.decision));
    }
  }

  private isOurs(payload: Record<string, unknown>): boolean {
    const key = str(payload.sessionKey);
    return !key || key === this.snapshot.sessionKey;
  }

  private onAgentEvent(payload: Record<string, unknown>): void {
    const event = readRunEvent(payload);
    if (!event || !this.isOurs(payload) || this.finished.has(event.runId)) {
      return;
    }
    if (this.runs.accept(event) === "stale") return;
    // Only a run with no live run before it becomes the live one; your send's turn is matched by its run id (the
    // idempotency key) alone, so another client's or a scheduled run can never take over your message.
    if (!this.snapshot.liveRunId) {
      const own = this.ownSends.get(event.runId);
      if (own) {
        // A message you sent while the turn before ran: its own turn starts now, so it is drawn over that turn and
        // its waiting copy goes.
        own.shown = true;
      }
      this.set({
        liveRunId: event.runId,
        liveStartedAt: runStart(event.data) ?? (event.ts || Date.now()),
        doneAt: null,
        ...(own ? { pendingUser: own.text, queued: this.snapshot.queued.filter((q) => q.runId !== event.runId) } : {}),
      });
    }
    if (event.runId === this.snapshot.liveRunId) this.liveSeen = true;
    if (event.runId === this.snapshot.liveRunId) {
      if (event.stream === "lifecycle" && (event.data.phase === "end" || event.data.phase === "error")) this.refreshLive();
      else this.scheduleLiveRefresh();
    }
    if (event.stream === "lifecycle" && (event.data.phase === "end" || event.data.phase === "error")) {
      // The engine marks an aborted run's end (`aborted`, status "cancelled") even when no "aborted" chat event came;
      // its stopReason says whether you stopped it or it timed out, was cut by a restart, or was superseded.
      const abort = readAbort(event.data);
      if (abort === "stopped") this.stoppedRuns.add(event.runId);
      const failure = typeof abort === "object" && abort ? abort.failure : event.data.phase === "error" ? str(event.data.error) || "It stopped before it started." : "";
      void this.finishRun(event.runId, failure, abort === "superseded");
    }
  }

  private addApproval(payload: Record<string, unknown>): void {
    const request = rec(payload.request);
    const sessionKey = str(request.sessionKey);
    if (sessionKey && sessionKey !== this.snapshot.sessionKey) {
      return;
    }
    const id = str(payload.id);
    if (id && !this.approvals.has(id)) {
      this.approvals.set(id, {
        id,
        command: str(request.command),
        cwd: str(request.cwd) || undefined,
        host: str(request.host) || undefined,
        warnings: readWarnings(request.commandAnalysis),
        state: "pending",
        runId: str(request.runId) || undefined,
      });
    }
  }

  private resolveApproval(id: string, decision: string): void {
    const approval = this.approvals.get(id);
    if (!approval) {
      return;
    }
    this.approvals.set(id, { ...approval, state: decision === "deny" ? "denied" : "allowed" });
    this.refreshLive();
  }

  private refreshLive(): void {
    if (this.liveRefreshTimer) clearTimeout(this.liveRefreshTimer);
    this.liveRefreshTimer = null;
    const runId = this.snapshot.liveRunId;
    this.set({ live: runId ? withWaitingApprovals(sanitizeBlocks(projectRun(this.runs.events(runId), this.approvals)), this.approvals, runId) : [] });
  }

  private scheduleLiveRefresh(): void {
    if (!this.liveRefreshTimer) this.liveRefreshTimer = setTimeout(() => this.refreshLive(), 100);
  }

  /**
   * The engine wrote to the open conversation after its run ended here. A failed run's "couldn't be completed"
   * receipt is persisted after the lifecycle error the window already finished on, so read history again.
   * Skipped while a run is still live or a send is in flight; that run's history is read when it finishes.
   */
  private refreshSettled(): void {
    const { liveRunId, pendingUser, sessionKey } = this.snapshot;
    const settled = liveRunId ? this.finished.has(liveRunId) : pendingUser === null;
    const waitingEcho = Boolean(sessionKey && this.firstEcho.peek(sessionKey) && !liveRunId);
    if (settled || waitingEcho) {
      this.loadHistory().catch((error: unknown) => this.set({ error: error instanceof Error ? error.message : String(error) }));
    } else {
      // A turn is running: the history waits for it to end, but what is waiting for a turn shows now.
      void this.loadQueued();
    }
  }

  /** Only the waiting inputs (chat.history pendingInputs), read while a turn runs without touching the history. */
  private async loadQueued(): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    if (!sessionKey) return;
    const history = await this.gateway.request("chat.history", { sessionKey, limit: 1 }).catch(() => null);
    if (!history || sessionKey !== this.snapshot.sessionKey) return;
    this.set({ queued: mergeQueued(this.snapshot.queued, rec(history).pendingInputs, sessionKey, false, this.shownRuns()) });
  }

  /** The run ended: the engine's history becomes the record, replacing the live view in one step. `failure` is why
   *  it ended early; when the engine never kept your message, the thread keeps it as "Not sent" with that reason. */
  private async finishRun(runId: string, failure = "", absorbed = false): Promise<void> {
    if (!runId || this.finished.has(runId)) {
      return;
    }
    this.finished.add(runId);
    let read = false;
    try {
      await this.loadHistory();
      // An event during the read (session.message, the chat terminal) can start a newer read and make this one
      // stand down: wait for the newest so the turn's own history is in before the live view goes.
      read = await this.settledRead();
    } catch {
      // The live view still goes; whether the message was kept waits for a read that works.
    } finally {
      this.releaseRetiring(runId);
      this.runs.drop(runId);
      const wasLive = this.snapshot.liveRunId === runId;
      const outcome: RunEnd["outcome"] = this.stoppedRuns.has(runId) ? "stopped" : failure ? "failed" : absorbed ? "absorbed" : "done";
      const own = this.ownSends.get(runId);
      if (wasLive && own?.shown && failure) {
        // Only a history that was read now can say the message wasn't kept; otherwise the next read settles it.
        const sessionKey = this.snapshot.sessionKey ?? "";
        if (!read) this.unchecked.set(runId, { sessionKey, text: own.text, attachments: own.attachments, failure });
        else if (!keptInHistory(this.snapshot.history, runId, own.text)) this.notSent(sessionKey, runId, own.text, failure, own.attachments);
      }
      this.ownSends.delete(runId);
      for (const note of this.snapshot.steered) if (note.target === runId) this.ownSends.delete(note.runId);
      if (wasLive) this.liveSeen = false;
      const historyHasMessage = Boolean(own && keptInHistory(this.snapshot.history, runId, own.text));
      const keepEcho = Boolean(own?.shown && shouldKeepFirstSendEcho(historyHasMessage, Boolean(failure)));
      // Another turn that is still running took this send in: drop the local echo so the bubble is not drawn twice.
      if (!keepEcho || (absorbed && !wasLive)) this.firstEcho.clear(runId);
      else if (own) this.firstEcho.set(this.snapshot.sessionKey ?? "", own.text, runId);
      this.set({
        // Only a run that finished plays "Done" (header, agent window, cheer); a stopped or failed one, or one whose
        // input another turn took in, does not.
        ...(wasLive ? { liveRunId: null, liveStartedAt: null, live: [], pendingUser: keepEcho && own ? own.text : null, doneAt: outcome === "done" && !keepEcho ? Date.now() : null, ended: { runId, outcome, at: Date.now() } } : {}),
        // Your send, taken into another turn that is still running: that turn's history has your message, so your
        // own bubble goes now instead of drawing it twice. Only when the bubble is that send's: someone else's run,
        // or a queued send of yours (not drawn) taken in, leaves the bubble alone.
        ...(!wasLive && absorbed && own?.shown && this.snapshot.pendingUser === own.text ? { pendingUser: null, ended: { runId, outcome, at: Date.now() } } : {}),
        steered: this.snapshot.steered.filter((note) => note.runId !== runId && note.target !== runId),
      });
    }
  }

  /** Resolves once no newer `chat.history` read is still landing: true when the newest one worked. */
  private async settledRead(): Promise<boolean> {
    let ok = true;
    for (let read = this.currentRead; read; read = this.currentRead === read ? null : this.currentRead) {
      ok = await read.then(() => true, () => false);
    }
    return ok;
  }

  /** The runs the thread draws itself, so the engine's waiting copy of them is not drawn again. */
  private shownRuns(): Set<string> {
    return new Set([...this.ownSends].filter(([, send]) => send.shown).map(([runId]) => runId));
  }

  /**
   * Sends your words. The run id is the idempotency key (engine chat-send-session.ts), so the turn shows as working
   * the moment you press Send, not when the engine acknowledges it (that can take many seconds). A message sent while
   * a turn is already going never replaces that turn: a steer shows as a steered note, anything else waits its turn.
   */
  async send(text: string, extras?: SendExtras, idempotencyKey?: string): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    if (!sessionKey) {
      return;
    }
    const roomId = roomIdOf(sessionKey);
    if (roomId) {
      await this.sendToRoom(roomId, text, extras);
      return;
    }
    // Every send is a new message to the engine: a "Not sent" card is one the engine refused (it remembers that
    // refusal under the id for minutes) or didn't keep, so Try again must not reuse its id.
    const rest = extras ?? {};
    const runId = idempotencyKey ?? crypto.randomUUID();
    const attachments = rest.attachments?.length ?? 0;
    const busy = this.snapshot.liveRunId !== null && !this.finished.has(this.snapshot.liveRunId);
    const steer = busy && rest.queueMode === "steer";
    const sentTo = this.sentTo(sessionKey);
    this.ownSends.set(runId, { text, shown: !busy || steer, attachments });
    if (!busy) {
      this.runs.clear();
      this.liveSeen = false;
      if (this.snapshot.historyReady !== false && !this.snapshot.history.length) this.seedFirstSend(sessionKey, text, runId);
      this.set({ pendingUser: text, liveRunId: runId, liveStartedAt: Date.now(), live: [], doneAt: null, error: null });
    } else if (steer) {
      this.set({ steered: [...this.snapshot.steered, { runId, text, target: this.snapshot.liveRunId ?? "" }] });
    }
    const dispatchGateway = this.gateway;
    try {
      const result = rec(await requestWithRetry(() => dispatchGateway.request("chat.send", { ...rest, sessionKey, message: text, idempotencyKey: runId })));
      const acked = str(result.runId) || runId;
      if (dispatchGateway === this.retiringGateway) this.retiringRunId = acked;
      if (acked !== runId && this.snapshot.liveRunId === runId && !this.liveSeen) {
        this.ownSends.set(acked, this.ownSends.get(runId)!);
        this.ownSends.delete(runId);
        const echo = this.firstEcho.peek(sessionKey);
        if (echo?.runId === runId) this.firstEcho.set(sessionKey, echo.text, acked);
        this.set({ liveRunId: acked });
      }
      // "ok" means the engine already had this input (a retry it deduplicated, or a steer the turn took in): no run
      // of its own will report, so the history is the record now.
      const status = str(result.status);
      // Any other answer ("error", "failed", …) means no run will report.
      const failure = failedAck(result);
      if (status === "ok" && this.snapshot.liveRunId === acked && !this.liveSeen) void this.finishRun(acked, "", true);
      else if (failure && this.snapshot.liveRunId === acked) void this.finishRun(acked, failure);
      else if (this.snapshot.liveRunId === acked) this.refreshLive();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.ownSends.delete(runId);
      this.firstEcho.clear(runId);
      if (this.snapshot.liveRunId === runId) {
        this.liveSeen = false;
        this.set({ pendingUser: null, liveRunId: null, liveStartedAt: null, live: [] });
      } else {
        this.set({ steered: this.snapshot.steered.filter((note) => note.runId !== runId) });
      }
      // The engine said no, or the message never left: Not sent. Lost on the way (a steer too), or still refused as
      // busy after asking again (a handoff lease): the engine may hold it or take it soon, so it is "Not confirmed
      // yet" until a read of its conversation settles it. A run that kept the previous engine's connection open won't
      // report now, so that connection goes.
      if (refusedOrUnsent(error) && !isRetryable(error)) this.notSent(sessionKey, runId, text, reason, attachments);
      else {
        if (dispatchGateway === this.retiringGateway) this.releaseRetiring(runId);
        if (sentTo) this.unconfirmed.lost(sessionKey, runId, text, rest, sentTo);
        else this.notSent(sessionKey, runId, text, reason, attachments);
      }
    }
  }

  private async sendToRoom(roomId: string, text: string, extras?: SendExtras): Promise<void> {
    this.set({ pendingUser: text, doneAt: null, error: null });
    try {
      if (extras?.attachments?.length) throw new Error("Attachments are not supported in group chats yet.");
      await this.gateway.request("rooms.send", { roomId, message: text });
      this.set({ pendingUser: null });
      await this.loadHistory();
    } catch (error) {
      this.set({ pendingUser: null, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Try again and Edit went back to just before your message (`sessions.rewind`): the thread drops it and what came
   * after at once. A history read right after the rewind can still return the old turn, so none started before
   * this may land.
   */
  rewound(entryId: string): void {
    const at = this.snapshot.history.findIndex((b) => b.kind === "user" && b.meta?.entryId === entryId);
    if (at < 0) return;
    this.historyReads += 1;
    const history = this.snapshot.history.slice(0, at);
    const sessionKey = this.snapshot.sessionKey;
    if (sessionKey) {
      // A read that started before the rewind must not put the dropped tail back into the cache.
      this.historyReadGen.set(sessionKey, (this.historyReadGen.get(sessionKey) ?? 0) + 1);
      this.historyCache.set(sessionKey, history);
    }
    this.set({ history });
  }

  /** Where a send goes, for its record if the connection goes before the engine answers: this engine, now, after the
   *  newest entry its conversation showed, which existed if a read gave it a session id. Null before any hello. */
  private sentTo(sessionKey: string): { engine: string; at: number; anchor?: string; existed: boolean } | null {
    if (!this.engineKey) return null;
    // Only a message from you or a steer: a stored row in its place, never a projected one (a partial reply, a note)
    // the engine may draw at the newest position of every read.
    const anchor = [...this.snapshot.history].reverse().find((b) => (b.kind === "user" || b.kind === "steer") && b.meta?.runKey && b.meta.entryId);
    const entryId = anchor && (anchor.kind === "user" || anchor.kind === "steer") ? anchor.meta?.entryId : undefined;
    const existed = this.readSession?.sessionKey === sessionKey && Boolean(this.readSession.id);
    return { engine: this.engineKey, at: Date.now(), ...(entryId ? { anchor: entryId } : {}), existed };
  }

  /** Your message whose turn ended before the engine kept it (§4.2.2 "Not sent"): it goes to this conversation's
   *  waiting line as "failed", the one record the thread (Try again, Discard) and Inbox read (composer/queue.ts). */
  private notSent(sessionKey: string, runId: string, text: string, error: string, attachments = 0): void {
    if (!sessionKey) return;
    try {
      // Attachments aren't kept with it (the line holds words); the reason says so, so Try again isn't silently less.
      addNotSent(safeStorage(), sessionKey, { id: runId, text, error: `${error}${droppedFiles(attachments)}` });
    } catch (stored) {
      this.set({ error: `${text.slice(0, 40)}… wasn't sent (${error}), and this computer couldn't keep it: ${stored instanceof Error ? stored.message : String(stored)}` });
    }
  }

  async answer(id: string, decision: "allow-once" | "deny"): Promise<void> {
    try {
      await this.gateway.request("exec.approval.resolve", { id, decision });
      this.resolveApproval(id, decision);
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  async stopRun(): Promise<void> {
    const { sessionKey, liveRunId } = this.snapshot;
    if (sessionKey && liveRunId) {
      // Only an abort the engine confirms makes the turn "Stopped": Stop pressed as the run finished leaves it done.
      const result = rec(await this.gateway.request("chat.abort", { sessionKey, runId: liveRunId }).catch(() => null));
      const runIds = Array.isArray(result.runIds) ? result.runIds : [];
      if (result.aborted !== true && !runIds.includes(liveRunId)) return;
      this.stoppedRuns.add(liveRunId);
      const { ended } = this.snapshot;
      if (ended?.runId === liveRunId && ended.outcome !== "stopped") {
        // The run's end beat the confirmation here: say Stopped after all.
        this.set({ history: markStopped(this.snapshot.history, this.stoppedRuns), ended: { ...ended, outcome: "stopped" }, doneAt: null });
      }
    }
  }
}

function buildEngine(session: SaplingSession, sessionKey: string | null, hello: HelloOk | null): WindowEngine {
  const attachments = hello?.policy.attachments;
  const agentId = sessionKey ? agentIdOf(sessionKey) : undefined;
  return {
    gatewayUrl: session.gatewayUrl,
    connected: hello !== null,
    reconnect: () => session.reconnectNow(),
    // With several Trunks, owned calls that name none go to the open conversation's Trunk (the default one).
    request: (method, params) => session.request(method, withOwner(method, params, agentId)),
    onEvent: (listener) => session.onGatewayEvent((event, payload) => listener({ event, payload })),
    sessionKey,
    ...(agentId ? { agentId } : {}),
    mediaPicture: (source) => (sessionKey ? loadMediaPicture(session.gatewayUrl, source, sessionKey, agentId, session.httpToken) : Promise.resolve({ error: "unavailable" as const })),
    send: (text) => session.send(text),
    rewound: (entryId) => session.rewound(entryId),
    scopes: hello ? [...hello.auth.scopes] : [],
    requestScopeUpgrade: (options) => session.requestScopeUpgrade(options),
    cancelScopeUpgrade: () => session.cancelScopeUpgrade(),
    ...(attachments ? { attachmentPolicy: { maxBytes: attachments.maxBytes, maxImageBytes: attachments.maxImageBytes } } : {}),
  };
}

/** The Trunk of an agent-scoped key ("agent:<id>:..."), as the engine's routing/session-key.ts reads it. */
export function agentIdOf(sessionKey: string): string | undefined {
  const m = /^agent:([^:]+):/.exec(sessionKey);
  return m ? m[1] : undefined;
}

function readWarnings(analysis: unknown): string[] {
  const lines = rec(analysis).warningLines;
  return Array.isArray(lines) ? lines.filter((l): l is string => typeof l === "string") : [];
}

function readMainSessionKey(hello: HelloOk): string | null {
  const defaults = rec(rec(hello.snapshot).sessionDefaults);
  return str(defaults.mainSessionKey) || null;
}

function readAgentName(result: unknown): string {
  const r = rec(result);
  const agents = Array.isArray(r.agents) ? r.agents.map(rec) : [];
  const agent = agents.find((a) => a.id === r.defaultId) ?? agents[0];
  if (!agent) {
    return "";
  }
  return str(rec(agent.identity).name) || str(agent.name) || str(agent.id);
}

/** A picture on the Trunk's computer, ready to show, or why it can't. */
export type MediaPicture = { src: string } | { error: "outside" | "unavailable" };

/** The engine's assistant-media route for a gateway address (engine gateway/control-ui.ts, `assistant.media.get`). */
function assistantMediaBase(gatewayUrl: string): string | null {
  try {
    const base = new URL(gatewayUrl);
    base.protocol = base.protocol === "wss:" ? "https:" : "http:";
    return `${base.origin}/__branch__/assistant-media`;
  } catch {
    return null;
  }
}

/**
 * Reads a picture on the Trunk's computer through the engine's assistant-media route. The window asks for its
 * availability (`meta=1`) with the gateway credential in an Authorization header (the route answers CORS for this
 * window), and gets back a media ticket: signed, five minutes, bound to that one file and conversation. The picture
 * then loads with the ticket alone. The credential never goes in a URL, so it can't leak through "Open in your
 * browser", a saved or copied picture address, or logs.
 */
export async function loadMediaPicture(
  gatewayUrl: string,
  source: string,
  sessionKey: string,
  agentId: string | undefined,
  token: string | null,
  fetcher: typeof fetch = fetch,
): Promise<MediaPicture> {
  const base = assistantMediaBase(gatewayUrl);
  if (!base) return { error: "unavailable" };
  const where = { source, sessionKey, ...(agentId ? { agentId } : {}) };
  try {
    const res = await fetcher(`${base}?${new URLSearchParams({ meta: "1", ...where })}`, {
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) return { error: "unavailable" };
    const meta = rec(await res.json());
    if (meta.available !== true) return { error: str(meta.code) === "outside-allowed-folders" ? "outside" : "unavailable" };
    const ticket = str(meta.mediaTicket);
    return { src: `${base}?${new URLSearchParams({ ...where, ...(ticket ? { mediaTicket: ticket } : {}) })}` };
  } catch {
    return { error: "unavailable" };
  }
}

/** Whether the history holds your message of this run: the engine keys it "<runId>:user" (readMeta `runKey`); a
 *  history without keys counts it kept when its last message from you has the same words. */
export function keptInHistory(history: readonly Block[], runId: string, text: string): boolean {
  const mine = history.filter((b): b is Extract<Block, { kind: "user" }> => b.kind === "user");
  if (mine.some((b) => b.meta?.runKey === runId)) return true;
  const last = mine.at(-1);
  return Boolean(last && !last.meta?.runKey && last.text.trim() === text.trim());
}

export { refusedOrUnsent, requestWithRetry } from "./send-errors";
export { heldRuns } from "./unconfirmed";

/** An approval the engine raised for the live run (`exec.approval.requested`) can arrive before the run's own
 *  "waiting-approval" event (one with no run named counts as the live run's). Until that comes, the card joins the
 *  live run at its end, so the header, the agent window and the thread all say "Waiting for you" while the card is up. */
export function withWaitingApprovals(live: Block[], approvals: ReadonlyMap<string, Approval>, runId: string): Block[] {
  const shown = new Set(live.filter((b) => b.kind === "approval").map((b) => (b as Extract<Block, { kind: "approval" }>).approval.id));
  const waiting = [...approvals.values()].filter((a) => a.state === "pending" && (a.runId === runId || !a.runId) && !shown.has(a.id));
  return waiting.length ? [...live, ...waiting.map((approval): Block => ({ kind: "approval", key: `approval:${approval.id}`, approval }))] : live;
}

/**
 * How an aborted run ended (`aborted: true` or status "cancelled" on its end, or the chat "aborted" event): you
 * stopped it, or it was superseded by a newer turn, or it failed (timed out, cut by a restart, or its provider was
 * signed out: the engine aborts that provider's runs with stopReason "auth-revoked"). A plain Stop may carry
 * no stopReason at all, so only the reasons that are not a stop are named; null when the run wasn't aborted.
 */
export function readAbort(data: Record<string, unknown>): "stopped" | "superseded" | { failure: string } | null {
  if (data.aborted !== true && data.status !== "cancelled") return null;
  const reason = str(data.stopReason);
  if (reason === "timeout") return { failure: "It ran out of time." };
  if (reason === "restart") return { failure: "Interrupted by a restart." };
  if (reason === "auth-revoked") return { failure: "Its provider was signed out." };
  if (reason === "superseded") return "superseded";
  return "stopped";
}
