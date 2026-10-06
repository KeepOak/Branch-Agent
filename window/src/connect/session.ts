// The open conversation on the engine: history, the live run, approvals and sending. It starts on the
// default Trunk's main conversation and switches with open(key) (DESIGN-SPEC §4.1.1.1 row click).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { EventFrame, HelloOk } from "@branch/gateway-client/browser";
import { BranchGateway, type GatewayStatus } from "./gateway";
import type { SendExtras, WindowEngine } from "./engine";
import { RunStreams, readRunEvent } from "./stream-order";
import { withOwner } from "./agent-owner";
import { projectRun, type Approval, type Block } from "../thread/model";
import { historyToBlocks, readApprovalRecords } from "../thread/history";
import { isPreparationPending, PreparationRetry, preparationTimeoutLabel } from "./preparation-status";

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
  liveRunId: string | null;
  /** When the live run started (engine time), so "Working · 3m 12s" counts from the real start, not from when this
   *  window opened it. */
  liveStartedAt: number | null;
  doneAt: number | null;
  lastActivityAt: number | null;
  error: string | null;
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** A run's start time, as the engine reports it on its in-flight snapshot or lifecycle start. */
const runStart = (v: Record<string, unknown>): number | null =>
  typeof v.startedAt === "number" && Number.isFinite(v.startedAt) && v.startedAt > 0 ? v.startedAt : null;

export type GatewayEventListener = (event: string, payload: unknown) => void;


/** The group chat a room's lead conversation belongs to: `agent:<lead>:room:<roomId>` (engine rooms.send). */
export function roomIdOf(sessionKey: string): string {
  return /^agent:[^:]+:room:([^:]+)$/.exec(sessionKey)?.[1] ?? "";
}

export class SaplingSession {
  readonly gatewayUrl: string;
  private readonly eventListeners = new Set<GatewayEventListener>();
  private wanted: string | null;
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly runs = new RunStreams();
  private readonly approvals = new Map<string, Approval>();
  private readonly finished = new Set<string>();
  /** Codex emits many updates per item. Keep raw events off React's render path between frames. */
  private liveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Only the newest `chat.history` read may land; an older one resolving later would bring back stale history. */
  private historyReads = 0;
  private preparationRetry: ReturnType<typeof setTimeout> | null = null;
  private readonly preparationBackoff = new PreparationRetry();
  private stopped = false;
  private readonly gateway: BranchGateway;

  /** `initialKey` reopens the conversation the window last showed (§3.3 "Reopen where you were"). */
  constructor(url: string, sharedToken: string | undefined, initialKey: string | null = null) {
    this.gatewayUrl = url;
    this.wanted = initialKey;
    this.snapshot = {
      status: { phase: "connecting" },
      sessionKey: null,
      mainKey: null,
      name: "",
      history: [],
      live: [],
      pendingUser: null,
      liveRunId: null,
      liveStartedAt: null,
      doneAt: null,
      lastActivityAt: null,
      error: null,
    };
    this.gateway = new BranchGateway({
      url,
      sharedToken,
      onStatus: (status) => this.onStatus(status),
      onEvent: (event) => this.onEvent(event),
    });
  }

  start(): void {
    this.stopped = false;
    this.gateway.start();
  }

  stop(): void {
    if (this.liveRefreshTimer) clearTimeout(this.liveRefreshTimer);
    this.stopped = true;
    if (this.preparationRetry) clearTimeout(this.preparationRetry);
    this.preparationRetry = null;
    this.preparationBackoff.reset();
    this.gateway.stop();
  }

  /** The desktop swapped the engine in place: reconnect at once. */
  reconnectNow(): void {
    this.gateway.reconnectNow();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  private engineCache: { key: string | null; hello: HelloOk | null; engine: WindowEngine } | null = null;

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

  /** Any engine method, for the parts of the window that call the engine themselves. */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.gateway.request<T>(method, params);
  }

  /** Every event the engine pushes, raw (`event`, `payload`). */
  onGatewayEvent(listener: GatewayEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Opens another conversation in the thread; its history is read from the engine. */
  async open(key: string): Promise<void> {
    if (!key || key === this.snapshot.sessionKey) {
      return;
    }
    this.wanted = key;
    this.runs.clear();
    if (this.liveRefreshTimer) clearTimeout(this.liveRefreshTimer);
    this.liveRefreshTimer = null;
    this.approvals.clear();
    this.set({ sessionKey: key, history: [], live: [], pendingUser: null, liveRunId: null, liveStartedAt: null, doneAt: null, lastActivityAt: null, error: null });
    try {
      await this.backfillApprovals();
      await this.loadHistory();
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) });
    }
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
    if (status.phase !== "connected") {
      this.set({ status });
      return;
    }
    const mainKey = readMainSessionKey(status.hello);
    const sessionKey = this.wanted ?? mainKey;
    // Every hello is a fresh engine (a restart, or an update swapped in under this window): the runs this
    // window mirrored are gone with the old one. Clear them; chat.history's inFlightRun says what still runs.
    this.runs.clear();
    this.approvals.clear();
    this.set({ sessionKey, mainKey, live: [], liveRunId: null, liveStartedAt: null, pendingUser: null });
    void this.bootstrap(status, sessionKey);
  }

  private async bootstrap(status: GatewayStatus, sessionKey: string | null): Promise<void> {
    if (!sessionKey) {
      this.set({ status, error: "The engine did not say which conversation is the default Trunk's." });
      return;
    }
    try {
      const [agents] = await Promise.all([
        this.gateway.request("agents.list", {}),
        this.gateway.request("sessions.subscribe", { limit: 20 }),
      ]);
      this.set({ name: readAgentName(agents) });
      await this.backfillApprovals();
      await this.loadHistory();
      this.set({ status, error: null });
    } catch (error) {
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

  private async loadHistory(): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    if (!sessionKey) {
      return;
    }
    const read = ++this.historyReads;
    const [history, ledger] = await Promise.all([
      this.gateway.request("chat.history", { sessionKey }),
      this.gateway.request("approval.history", { limit: 100, kind: "exec" }),
    ]);
    if (sessionKey !== this.snapshot.sessionKey || read !== this.historyReads) {
      return; // another conversation was opened, or a newer read started, while this one loaded
    }
    const h = rec(history);
    const inFlight = rec(h.inFlightRun);
    const inFlightId = str(inFlight.runId);
    // A run this window already saw end is history now, even if the engine still lists it while it tidies up.
    const inFlightRunId = inFlightId && !this.finished.has(inFlightId) ? inFlightId : null;
    const messages = Array.isArray(h.messages) ? h.messages : [];
    const blocks = historyToBlocks(messages, readApprovalRecords(ledger), sessionKey, inFlightRunId);
    const info = rec(h.sessionInfo);
    this.set({
      history: blocks,
      lastActivityAt: typeof info.lastActivityAt === "number" ? info.lastActivityAt : null,
      ...(inFlightRunId ? { liveRunId: inFlightRunId, liveStartedAt: runStart(inFlight) } : {}),
    });
    if (inFlightRunId) {
      this.adoptInFlight(inFlightRunId, str(inFlight.text), inFlight);
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
    } else if (event.event === "chat") {
      const state = str(payload.state);
      if (["final", "error", "aborted"].includes(state) && this.isOurs(payload)) {
        const runId = str(payload.runId);
        if (this.finished.has(runId)) {
          this.refreshSettled();
        } else {
          void this.finishRun(runId);
        }
      }
    } else if ((event.event === "session.message" || event.event === "sessions.changed") && str(payload.sessionKey) === this.snapshot.sessionKey) {
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
    if (!this.snapshot.liveRunId) {
      this.set({ liveRunId: event.runId, liveStartedAt: runStart(event.data) ?? (event.ts || Date.now()), doneAt: null });
    }
    if (event.runId === this.snapshot.liveRunId) {
      if (event.stream === "lifecycle" && (event.data.phase === "end" || event.data.phase === "error")) this.refreshLive();
      else this.scheduleLiveRefresh();
    }
    if (event.stream === "lifecycle" && (event.data.phase === "end" || event.data.phase === "error")) {
      void this.finishRun(event.runId);
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
    this.set({ live: runId ? projectRun(this.runs.events(runId), this.approvals) : [] });
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
    const { liveRunId, pendingUser } = this.snapshot;
    const settled = liveRunId ? this.finished.has(liveRunId) : pendingUser === null;
    if (settled) {
      this.loadHistory().catch((error: unknown) => this.set({ error: error instanceof Error ? error.message : String(error) }));
    }
  }

  /** The run ended: the engine's history becomes the record, replacing the live view in one step. */
  private async finishRun(runId: string): Promise<void> {
    if (!runId || this.finished.has(runId)) {
      return;
    }
    this.finished.add(runId);
    try {
      await this.loadHistory();
    } finally {
      this.runs.drop(runId);
      const wasLive = this.snapshot.liveRunId === runId;
      this.set({
        ...(wasLive ? { liveRunId: null, liveStartedAt: null, live: [], pendingUser: null, doneAt: Date.now() } : {}),
      });
    }
  }

  async send(text: string, extras?: SendExtras): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    if (!sessionKey) {
      return;
    }
    this.set({ pendingUser: text, doneAt: null, error: null });
    try {
      const roomId = roomIdOf(sessionKey);
      if (roomId && extras?.attachments?.length) throw new Error("Attachments are not supported in group chats yet.");
      const result = rec(await (roomId
        ? this.gateway.request("rooms.send", { roomId, message: text })
        : this.gateway.request("chat.send", { ...extras, sessionKey, message: text, idempotencyKey: crypto.randomUUID() })));
      const runId = str(result.runId);
      if (runId && !this.finished.has(runId)) {
        this.set({ liveRunId: runId, liveStartedAt: this.snapshot.liveRunId === runId ? this.snapshot.liveStartedAt : Date.now() });
        this.refreshLive();
      } else if (roomId) {
        this.set({ pendingUser: null });
        await this.loadHistory();
      }
    } catch (error) {
      this.set({ pendingUser: null, error: error instanceof Error ? error.message : String(error) });
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
      await this.gateway.request("chat.abort", { sessionKey, runId: liveRunId }).catch(() => undefined);
    }
  }
}

function buildEngine(session: SaplingSession, sessionKey: string | null, hello: HelloOk | null): WindowEngine {
  const attachments = hello?.policy.attachments;
  const agentId = sessionKey ? agentIdOf(sessionKey) : undefined;
  return {
    gatewayUrl: session.gatewayUrl,
    // With several Trunks, owned calls that name none go to the open conversation's Trunk (the default one).
    request: (method, params) => session.request(method, withOwner(method, params, agentId)),
    onEvent: (listener) => session.onGatewayEvent((event, payload) => listener({ event, payload })),
    sessionKey,
    ...(agentId ? { agentId } : {}),
    scopes: hello ? [...hello.auth.scopes] : [],
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
