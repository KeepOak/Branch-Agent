// @vitest-environment jsdom
// Your own messages keep their place while a turn runs (live-findings 1, 2, 5, 8, 12): the turn shows as working the
// moment you press Send, the engine's waiting copy of your message is not drawn again under the dots, a steer never
// replaces the turn it steers, and a message the engine never kept stays as "Not sent".
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";

type Options = { onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };
type Sent = { message: string; idempotencyKey: string; queueMode?: string; sessionKey?: string };

const fake = vi.hoisted(() => ({
  options: null as Options | null,
  transcript: [] as Record<string, unknown>[],
  pending: [] as Record<string, unknown>[],
  sent: [] as Sent[],
  ack: null as null | ((value: unknown) => void),
  nack: null as null | ((error: Error) => void),
  stopped: [] as string[],
  holdAck: false,
  sendError: null as Error | null,
  sendErrors: [] as Error[],
  historyError: null as string | null,
  receipts: [] as Record<string, unknown>[],
  inFlight: null as Record<string, unknown> | null,
  reads: [] as Record<string, unknown>[],
  receiptsError: null as Error | null,
  sessionId: "s1" as string | null,
  /** Every chat.history read is refused with this (the bootstrap read too). */
  historyRefusal: null as Error | null,
  /** Answers chat.send gives instead of "started" (one per send). */
  acks: [] as Record<string, unknown>[],
}));

vi.mock("./gateway", () => ({
  BranchGateway: class {
    private readonly url: string;
    constructor(options: Options & { url: string }) {
      fake.options = options;
      this.url = options.url;
    }
    start(): void {}
    stop(): void {
      fake.stopped.push(this.url);
    }
    async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
      switch (method) {
        case "chat.history":
          fake.reads.push({ ...params });
          if (fake.historyError) throw new Error(fake.historyError);
          if (fake.receiptsError && params?.inputRunIds) throw fake.receiptsError;
          if (fake.historyRefusal && params?.limit) throw fake.historyRefusal;
          // Pages from the newest message back, as the engine does: `offset` messages skipped, then `limit`.
          const end = fake.transcript.length - (typeof params?.offset === "number" ? params.offset : 0);
          const from = Math.max(0, end - (typeof params?.limit === "number" ? params.limit : 200));
          return {
            ...(fake.sessionId ? { sessionId: fake.sessionId } : {}),
            hasMore: from > 0,
            ...(from > 0 ? { nextOffset: fake.transcript.length - from } : {}),
            messages: fake.transcript.slice(from, Math.max(from, end)).map((m) => ({ ...m })),
            pendingInputs: { items: fake.pending.map((p) => ({ ...p })), total: fake.pending.length },
            ...(fake.inFlight ? { inFlightRun: { ...fake.inFlight } } : {}),
            ...(Array.isArray(params?.inputRunIds)
              ? { inputReceipts: fake.receipts.filter((r) => (params.inputRunIds as string[]).includes(String(r.runId))) }
              : {}),
          };
        case "chat.send": {
          const sent = params as unknown as Sent;
          fake.sent.push(sent);
          if (fake.sendErrors.length) throw fake.sendErrors.shift();
          if (fake.sendError) throw fake.sendError;
          if (fake.acks.length) return fake.acks.shift();
          if (fake.holdAck) return new Promise((resolve, reject) => ((fake.ack = resolve), (fake.nack = reject)));
          return { runId: sent.idempotencyKey, status: "started" };
        }
        case "agents.list":
          return { agents: [{ id: "main", name: "Juniper" }], defaultId: "main" };
        case "approval.history":
          return { items: [] };
        case "exec.approval.list":
          return [];
        case "sessions.rewind":
          // The engine's history can still show the old turn right after a rewind.
          return { editorText: "Write an essay" };
        default:
          return {};
      }
    }
  },
}));

import { mergeQueued, SaplingSession } from "./session";
import { askAgain } from "../thread/actions";
import { loadLine, notSentEverywhere, saveLine } from "../composer/queue";

const KEY = "agent:main:main";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: KEY } }, auth: { scopes: [] }, policy: {} };
/** An engine refusal, as the gateway client raises it (a response error carries its gateway code). */
function refusal(message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { gatewayCode: "INVALID_REQUEST", retryable: false, ...extra });
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const emit = async (event: string, payload: unknown) => {
  fake.options?.onEvent({ event, payload });
  await settle();
};
const agent = (runId: string, seq: number, stream: string, data: Record<string, unknown>) =>
  emit("agent", { runId, seq, stream, ts: seq, sessionKey: KEY, data });

/** The connection comes back (a fresh hello), and what it starts settles. */
async function reconnect(): Promise<void> {
  fake.options?.onStatus({ phase: "connected", hello } as unknown as GatewayStatus);
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await settle();
}

async function connected(): Promise<SaplingSession> {
  const session = new SaplingSession("ws://fake", undefined);
  session.start();
  fake.options?.onStatus({ phase: "connected", hello } as unknown as GatewayStatus);
  await settle();
  await settle();
  return session;
}

afterEach(() => {
  localStorage.clear();
  Object.assign(fake, { options: null, transcript: [], pending: [], sent: [], ack: null, holdAck: false, sendError: null, sendErrors: [], historyError: null, receipts: [], inFlight: null, reads: [], nack: null, stopped: [], receiptsError: null, sessionId: "s1", acks: [], historyRefusal: null });
});

describe("your own messages while a turn runs", () => {
  it("keeps the first message of an empty conversation after send settles, before history arrives", async () => {
    fake.sessionId = null;
    fake.transcript = [];
    fake.acks = [{ status: "ok" }];
    const session = await connected();
    expect(session.getSnapshot().history).toEqual([]);
    const sending = session.send("What is 2+3? Answer in one word.");
    expect(session.getSnapshot()).toMatchObject({ pendingUser: "What is 2+3? Answer in one word." });
    await sending;
    await settle();
    expect(session.getSnapshot()).toMatchObject({ pendingUser: "What is 2+3? Answer in one word.", history: [], liveRunId: null });
    const runId = fake.sent[0]!.idempotencyKey;
    fake.sessionId = "s-new";
    fake.transcript = [{ role: "user", content: "What is 2+3? Answer in one word.", timestamp: 1, idempotencyKey: `${runId}:user` }];
    await emit("sessions.changed", { sessionKey: KEY });
    await settle();
    expect(session.getSnapshot().pendingUser).toBeNull();
    expect(session.getSnapshot().history.some((block) => block.kind === "user" && block.text === "What is 2+3? Answer in one word.")).toBe(true);
    session.stop();
  });

  it("opens a new conversation with the first-send echo already on screen", async () => {
    fake.sessionId = null;
    fake.transcript = [];
    const session = await connected();
    session.seedFirstSend("agent:main:topic-1", "What is 2+3? Answer in one word.", "echo-1");
    await session.open("agent:main:topic-1");
    await settle();
    expect(session.getSnapshot()).toMatchObject({
      sessionKey: "agent:main:topic-1",
      pendingUser: "What is 2+3? Answer in one word.",
      history: [],
    });
    session.stop();
  });

  it("shows the turn working the moment you send, before the engine acknowledges it", async () => {
    fake.holdAck = true;
    const session = await connected();
    const sending = session.send("Write an essay");
    await settle();
    const runId = fake.sent[0]!.idempotencyKey;
    expect(session.getSnapshot()).toMatchObject({ pendingUser: "Write an essay", liveRunId: runId });
    fake.ack?.({ runId, status: "started" });
    await sending;
    expect(session.getSnapshot().liveRunId).toBe(runId);
    session.stop();
  });

  it("does not draw the engine's waiting copy of your message under the turn, but still draws other people's", async () => {
    const session = await connected();
    await session.send("Write an essay");
    const runId = fake.sent[0]!.idempotencyKey;
    fake.pending = [
      { id: "p1", runId, state: "queued", acceptedAt: 1, message: { role: "user", content: "Write an essay", timestamp: 1 } },
      { id: "p2", runId: "someone-else", state: "queued", acceptedAt: 2, message: { role: "user", content: "From the phone", timestamp: 2 } },
    ];
    await emit("sessions.changed", { sessionKey: KEY });
    await settle();
    expect(session.getSnapshot().queued.map((q) => q.block.text)).toEqual(["From the phone"]);
    session.stop();
  });

  it("keeps the running turn when you steer it, and shows the steer as a note until the turn ends", async () => {
    const session = await connected();
    await session.send("Run two commands");
    const runId = fake.sent[0]!.idempotencyKey;
    await agent(runId, 1, "lifecycle", { phase: "start", startedAt: 100 });
    await session.send("Also run echo three", { queueMode: "steer" });
    const steer = fake.sent[1]!;
    expect(steer.queueMode).toBe("steer");
    expect(session.getSnapshot()).toMatchObject({ pendingUser: "Run two commands", liveRunId: runId, steered: [{ text: "Also run echo three", target: runId }] });
    // The engine lists the steer as waiting until the turn takes it; the note already says it.
    fake.pending = [{ id: "p3", runId: steer.idempotencyKey, state: "queued", acceptedAt: 3, message: { role: "user", content: "Also run echo three", timestamp: 3 } }];
    await emit("sessions.changed", { sessionKey: KEY });
    expect(session.getSnapshot().queued).toEqual([]);
    fake.pending = [];
    fake.transcript = [{ role: "user", content: "Run two commands", timestamp: 1, idempotencyKey: `${runId}:user` }];
    await agent(runId, 2, "lifecycle", { phase: "end", startedAt: 100, endedAt: 200 });
    await settle();
    expect(session.getSnapshot()).toMatchObject({ liveRunId: null, pendingUser: null, steered: [] });
    session.stop();
  });

  it("keeps a message the engine never kept as Not sent in this conversation's waiting line, the record Inbox reads", async () => {
    const session = await connected();
    await session.send("Say hi in three words.");
    const runId = fake.sent[0]!.idempotencyKey;
    await emit("chat", { runId, sessionKey: KEY, state: "error", errorMessage: "Error: Session database changed while waiting for admission" });
    await settle();
    expect(session.getSnapshot()).toMatchObject({ liveRunId: null, pendingUser: null });
    expect(loadLine(localStorage, KEY)).toMatchObject([{ id: runId, text: "Say hi in three words.", state: "failed", error: "Error: Session database changed while waiting for admission" }]);
    expect(notSentEverywhere(localStorage)).toMatchObject([{ sessionKey: KEY, item: { id: runId, state: "failed" } }]);
    session.stop();
  });

  it("does not call a failed turn Not sent when the history kept your message", async () => {
    const session = await connected();
    await session.send("Hello");
    const runId = fake.sent[0]!.idempotencyKey;
    fake.transcript = [
      { role: "user", content: "Hello", timestamp: 1, idempotencyKey: `${runId}:user` },
      { role: "custom", customType: "run-failed-before-reply", display: true, content: "Your request couldn't be completed: boom", timestamp: 2 },
    ];
    await emit("chat", { runId, sessionKey: KEY, state: "error", errorMessage: "boom" });
    await settle();
    expect(loadLine(localStorage, KEY)).toEqual([]);
    session.stop();
  });

  it("keeps a message the engine refused as Not sent, saying when its attachments weren't kept", async () => {
    fake.sendError = refusal("Attachments are too large.");
    const session = await connected();
    await session.send("Hello", { attachments: [{ type: "image" }] });
    expect(session.getSnapshot()).toMatchObject({ liveRunId: null, pendingUser: null });
    expect(loadLine(localStorage, KEY)).toMatchObject([{ text: "Hello", state: "failed", error: "Attachments are too large. Its attachment wasn't kept; add it again." }]);
    session.stop();
  });

  it("asks again with the same id when the engine says it is busy for a moment, before calling it Not sent", async () => {
    fake.sendErrors = [refusal("busy", { retryable: true, retryAfterMs: 1 })];
    const session = await connected();
    await session.send("Hello");
    expect(fake.sent.map((s) => s.idempotencyKey)).toEqual([fake.sent[0]!.idempotencyKey, fake.sent[0]!.idempotencyKey]);
    expect(loadLine(localStorage, KEY)).toEqual([]);
    session.stop();
  });

  it("keeps a message lost on the way as Not confirmed yet, and sends it once more under the same id when a read shows the engine doesn't have it", async () => {
    fake.sendErrors = [new Error("gateway closed (1006)")];
    const session = await connected();
    await session.send("Lost on the way", { queueMode: "followup", attachments: [{ type: "image" }] });
    const id = fake.sent[0]!.idempotencyKey;
    expect(loadLine(localStorage, KEY)).toMatchObject([{ id, text: "Lost on the way", state: "checking", sentWith: { queueMode: "followup", attachments: 1 } }]);
    await reconnect();
    // The conversation is read, with the message's receipt asked for, before anything goes again.
    expect(fake.reads).toContainEqual({ sessionKey: KEY, limit: 50, inputRunIds: [id] });
    expect(fake.sent.map((s) => [s.message, s.idempotencyKey, s.queueMode])).toEqual([["Lost on the way", id, "followup"], ["Lost on the way", id, "followup"]]);
    expect((fake.sent[1] as unknown as { attachments?: unknown[] }).attachments).toEqual([{ type: "image" }]);
    expect(loadLine(localStorage, KEY)).toEqual([]);
    session.stop();
  });

  it("never sends a lost message again when the conversation already has it (its message in the history)", async () => {
    fake.sendErrors = [new Error("gateway closed (1006)")];
    const session = await connected();
    await session.send("Already there");
    const id = fake.sent[0]!.idempotencyKey;
    fake.transcript = [{ role: "user", content: "Already there", timestamp: 1, idempotencyKey: `${id}:user` }];
    await reconnect();
    expect(fake.sent).toHaveLength(1);
    expect(loadLine(localStorage, KEY)).toEqual([]);
    session.stop();
  });

  it("never sends a lost steer again when the conversation holds it as a steer, with no receipts to go by", async () => {
    const session = await connected();
    await session.send("Run two commands");
    const runId = fake.sent[0]!.idempotencyKey;
    await agent(runId, 1, "lifecycle", { phase: "start", startedAt: 100 });
    fake.sendErrors = [new Error("gateway closed (1006)")];
    await session.send("Also run echo three", { queueMode: "steer" });
    const steerId = fake.sent[1]!.idempotencyKey;
    expect(loadLine(localStorage, KEY)).toMatchObject([{ id: steerId, state: "checking", sentWith: { queueMode: "steer" } }]);
    fake.transcript = [
      { role: "user", content: "Run two commands", timestamp: 1, idempotencyKey: `${runId}:user` },
      { role: "user", content: "Also run echo three", timestamp: 2, idempotencyKey: `${steerId}:user`, __branch: { steerTargetRunId: runId } },
    ];
    await reconnect();
    expect(fake.sent).toHaveLength(2);
    expect(loadLine(localStorage, KEY)).toEqual([]);
    session.stop();
  });

  it("checks without receipts when the engine can't answer them, and still sends the message only if it isn't there", async () => {
    fake.sendErrors = [new Error("gateway closed (1006)")];
    const session = await connected();
    await session.send("Older store");
    const id = fake.sent[0]!.idempotencyKey;
    fake.receiptsError = refusal("Pending input receipt lookup has ambiguous source run IDs", { gatewayCode: "UNAVAILABLE" });
    await reconnect();
    // Asked with receipts, refused, asked again without; the read reaches the start without it, so it goes once.
    expect(fake.reads.filter((r) => r.limit === 50)).toEqual([{ sessionKey: KEY, limit: 50, inputRunIds: [id] }, { sessionKey: KEY, limit: 50 }]);
    expect(fake.sent.map((s) => s.idempotencyKey)).toEqual([id, id]);
    expect(loadLine(localStorage, KEY)).toEqual([]);
    session.stop();
  });

  it("never sends a lost message again when the engine has a receipt for it (taken in by a turn long ago)", async () => {
    fake.sendErrors = [new Error("gateway closed (1006)")];
    const session = await connected();
    await session.send("Taken in");
    const id = fake.sent[0]!.idempotencyKey;
    fake.receipts = [{ runId: id, state: "consumed", consumedByEventId: "e1" }];
    await reconnect();
    expect(fake.sent).toHaveLength(1);
    expect(loadLine(localStorage, KEY)).toEqual([]);
    session.stop();
  });

  it("keeps a lost message across a reload, and the reloaded window checks it and sends it once", async () => {
    fake.sendErrors = [new Error("gateway closed (1006)")];
    const before = await connected();
    await before.send("Mid-loss");
    const id = fake.sent[0]!.idempotencyKey;
    before.stop(); // the window reloads before the connection is back
    expect(loadLine(localStorage, KEY)).toMatchObject([{ id, state: "checking" }]);
    const after = await connected();
    await flush();
    expect(fake.sent.map((s) => [s.message, s.idempotencyKey, s.sessionKey])).toEqual([["Mid-loss", id, KEY], ["Mid-loss", id, KEY]]);
    expect(loadLine(localStorage, KEY)).toEqual([]);
    // Another reload sends nothing more.
    after.stop();
    const again = await connected();
    await flush();
    expect(fake.sent).toHaveLength(2);
    again.stop();
  });

  it("files a reloaded lost message that had attachments as Not sent instead of sending its words alone", async () => {
    fake.sendErrors = [new Error("gateway closed (1006)")];
    const before = await connected();
    await before.send("With a picture", { attachments: [{ type: "image" }] });
    before.stop();
    const after = await connected();
    await flush();
    expect(fake.sent).toHaveLength(1);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ text: "With a picture", state: "failed", error: expect.stringContaining("attachment wasn't kept") }]);
    after.stop();
  });

  it("waits out a handoff lease and asks again under the same id: never Not sent", async () => {
    const lease = () => refusal("session is held by the previous engine", { gatewayCode: "UNAVAILABLE", retryable: true, retryAfterMs: 1, details: { reason: "session-handoff-lease" } });
    fake.sendErrors = [lease(), lease(), lease()];
    const session = await connected();
    await session.send("During the handoff");
    const id = fake.sent[0]!.idempotencyKey;
    expect(fake.sent.map((s) => s.idempotencyKey)).toEqual([id, id, id]);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ id, state: "checking" }]);
    await reconnect();
    expect(fake.sent.map((s) => s.idempotencyKey)).toEqual([id, id, id, id]);
    expect(loadLine(localStorage, KEY)).toEqual([]);
    session.stop();
  });

  it("closes the previous engine's connection when a send on it is lost during a handoff", async () => {
    fake.holdAck = true;
    const session = await connected();
    const sending = session.send("Across the handoff");
    await settle();
    session.handoff("ws://successor");
    expect(fake.stopped).toEqual([]); // kept open: the send on it is still out
    fake.nack?.(new Error("gateway closed (1006)"));
    await sending;
    expect(fake.stopped).toEqual(["ws://fake"]);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ text: "Across the handoff", state: "checking" }]);
    session.stop();
  });

  it("never sends a lost message to another engine: switching computers keeps its text as Not sent", async () => {
    saveLine(localStorage, KEY, [{ id: "for-a", text: "For computer A", files: [], state: "checking", sentTo: { engine: "computer-a|", at: 1, existed: true, owner: "w" } }]);
    const session = await connected();
    await flush();
    expect(fake.sent).toEqual([]);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ id: "for-a", text: "For computer A", state: "failed", error: expect.stringContaining("may have arrived there") }]);
    expect(session.getSnapshot().error).toContain("computer-a");
    session.stop();
  });

  it("keeps the text when an engine no longer knows this device, but not for a scope upgrade", async () => {
    fake.sendErrors = [new Error("gateway closed (1006)")];
    const session = await connected();
    await session.send("Before the pairing went");
    fake.options?.onStatus({ phase: "pairing", reason: "scope-upgrade" } as GatewayStatus);
    expect(loadLine(localStorage, KEY)).toHaveLength(1);
    fake.options?.onStatus({ phase: "pairing", reason: "not-paired" } as GatewayStatus);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ text: "Before the pairing went", state: "failed", error: expect.stringContaining("no longer knows this computer") }]);
    session.stop();
  });

  it("never calls a message missing when a page on the way back holds a message stripped to fit", async () => {
    fake.transcript = [{ role: "user", content: "Earlier", timestamp: 1, idempotencyKey: "earlier:user", __branch: { id: "anchor" } }];
    const session = await connected();
    fake.sendErrors = [new Error("gateway closed (1006)")];
    await session.send("A very long paste");
    // The engine replaced the message to fit the page and kept no key on it: it could be this one.
    fake.transcript = [...fake.transcript, { role: "user", content: [{ type: "text", text: "[chat.history omitted: message too large]" }], timestamp: 2, __branch: { id: "big", truncated: true, reason: "oversized" } }];
    await reconnect();
    expect(fake.sent).toHaveLength(1);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ state: "failed", error: expect.stringContaining("couldn't tell whether it arrived") }]);
    session.stop();
  });

  it("re-sends past a long assistant reply once the read reaches the anchor", async () => {
    fake.transcript = [{ role: "user", content: "Earlier", timestamp: 1, idempotencyKey: "earlier:user", __branch: { id: "anchor" } }];
    const session = await connected();
    fake.sendErrors = [new Error("gateway closed (1006)")];
    await session.send("After the long reply");
    const id = fake.sent[0]!.idempotencyKey;
    fake.transcript.push({ role: "assistant", content: "A".repeat(9_000), timestamp: 2, __branch: { id: "long-reply", truncated: true } });
    await reconnect();
    expect(fake.sent.map((sent) => sent.idempotencyKey)).toEqual([id, id]);
    session.stop();
  });

  it("uses a waiting item's id as the engine's idempotency key", async () => {
    const session = await connected();
    await session.send("From the waiting line", undefined, "waiting-line-id");
    expect(fake.sent).toMatchObject([{ message: "From the waiting line", idempotencyKey: "waiting-line-id" }]);
    session.stop();
  });

  it("never sends a lost message again when the read can't reach back past it: Not sent instead", async () => {
    // The conversation had an entry when the message went; a long turn has since written far more than the pages
    // the window reads, and the engine's in-memory dedupe is long gone.
    fake.transcript = [{ role: "user", content: "Earlier", timestamp: 1, idempotencyKey: "earlier:user", __branch: { id: "anchor" } }];
    const session = await connected();
    fake.sendErrors = [new Error("gateway closed (1006)")];
    await session.send("Lost before a long turn");
    expect(loadLine(localStorage, KEY)).toMatchObject([{ state: "checking", sentTo: { anchor: "anchor", existed: true } }]);
    const filler = Array.from({ length: 2_000 }, (_, i) => ({ role: "toolResult", content: `step ${i}`, timestamp: 2 + i }));
    fake.transcript = [...fake.transcript, ...filler];
    await reconnect();
    expect(fake.sent).toHaveLength(1);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ state: "failed", error: expect.stringContaining("couldn't tell whether it arrived") }]);
    session.stop();
  });

  it("reads older pages until it reaches the entry before the message, then sends it once when it isn't there", async () => {
    fake.transcript = [{ role: "user", content: "Earlier", timestamp: 1, idempotencyKey: "earlier:user", __branch: { id: "anchor" } }];
    const session = await connected();
    fake.sendErrors = [new Error("gateway closed (1006)")];
    await session.send("Lost, then a few hundred steps");
    const id = fake.sent[0]!.idempotencyKey;
    fake.transcript = [...fake.transcript, ...Array.from({ length: 300 }, (_, i) => ({ role: "toolResult", content: `step ${i}`, timestamp: 2 + i }))];
    await reconnect();
    expect(fake.reads.filter((r) => r.offset !== undefined).length).toBeGreaterThan(0);
    expect(fake.sent.map((s) => s.idempotencyKey)).toEqual([id, id]);
    session.stop();
  });

  it("files a lost message whose conversation was deleted as Not sent, instead of bringing the conversation back", async () => {
    fake.sendErrors = [new Error("gateway closed (1006)")];
    const session = await connected();
    await session.send("In a conversation that goes");
    fake.sessionId = null;
    await reconnect();
    expect(fake.sent).toHaveLength(1);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ state: "failed", error: "Its conversation was deleted." }]);
    session.stop();
  });

  it("sends the first message of a conversation that was never made, since the engine can't have it", async () => {
    fake.sessionId = null;
    fake.sendErrors = [new Error("gateway closed (1006)")];
    const session = await connected();
    await session.send("First words");
    await reconnect();
    expect(fake.sent).toHaveLength(2);
    expect(loadLine(localStorage, KEY)).toEqual([]);
    session.stop();
  });

  it("files a re-send the engine answers with a failure as Not sent, like the first send", async () => {
    fake.sendErrors = [new Error("gateway closed (1006)")];
    const session = await connected();
    await session.send("Lost, then refused");
    fake.acks = [{ status: "error", summary: "No model is set up." }];
    await reconnect();
    expect(fake.sent).toHaveLength(2);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ state: "failed", error: "No model is set up." }]);
    session.stop();
  });

  it("sends a lost message again with a single try during a handoff lease, and reads again before the next try", async () => {
    const lease = () => refusal("session is held by the previous engine", { gatewayCode: "UNAVAILABLE", retryable: true, retryAfterMs: 1, details: { reason: "session-handoff-lease" } });
    fake.sendErrors = [new Error("gateway closed (1006)"), lease()];
    const session = await connected();
    await session.send("During a handoff");
    await reconnect();
    expect(fake.sent).toHaveLength(2);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ state: "checking" }]);
    session.stop();
  });

  it("stops asking about a message when the engine refuses the read for good: Not sent", async () => {
    fake.sendErrors = [new Error("gateway closed (1006)")];
    const session = await connected();
    await session.send("Unreadable");
    fake.historyRefusal = refusal("not allowed");
    await reconnect();
    // Asked with receipts, then without; both refused, so nothing more is asked about it.
    expect(fake.reads.filter((r) => r.limit === 50)).toHaveLength(2);
    expect(fake.sent).toHaveLength(1);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ state: "failed", error: expect.stringContaining("couldn't check whether it arrived") }]);
    session.stop();
  });

  it("draws a lost message sent again while another turn runs as the engine's waiting copy, not hidden", async () => {
    fake.sendErrors = [new Error("gateway closed (1006)")];
    const session = await connected();
    await session.send("Lost while idle");
    const id = fake.sent[0]!.idempotencyKey;
    // By the time the connection is back, a turn from elsewhere is running, so the engine queues the message.
    fake.inFlight = { runId: "from-the-phone", text: "", events: [] };
    await reconnect();
    expect(fake.sent.map((s) => s.idempotencyKey)).toEqual([id, id]);
    fake.pending = [{ id: "p1", runId: id, state: "queued", acceptedAt: 1, message: { role: "user", content: "Lost while idle", timestamp: 1 } }];
    await emit("sessions.changed", { sessionKey: KEY });
    await settle();
    expect(session.getSnapshot().queued.map((q) => q.block.text)).toEqual(["Lost while idle"]);
    session.stop();
  });

  it("files a lost send the engine then refuses as Not sent in its own conversation, even after you opened another", async () => {
    fake.sendErrors = [new Error("gateway closed (1006)"), refusal("No model is set up.")];
    const session = await connected();
    await session.send("For A");
    await session.open("agent:main:other");
    await reconnect();
    expect(fake.sent.map((s) => s.sessionKey)).toEqual([KEY, KEY]);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ text: "For A", state: "failed", error: "No model is set up." }]);
    expect(loadLine(localStorage, "agent:main:other")).toEqual([]);
    session.stop();
  });

  it("sends Try again as a new message: the engine remembers its refusal under the old id", async () => {
    fake.sendError = refusal("No model is set up.");
    const session = await connected();
    await session.send("Hello");
    fake.sendError = null;
    await session.send("Hello");
    const [first, again] = fake.sent.map((s) => s.idempotencyKey);
    expect(again).not.toBe(first);
    session.stop();
  });

  it("takes a Not sent card away when a read shows the engine has that message after all", async () => {
    saveLine(localStorage, KEY, [{ id: "held-id", text: "Hello", files: [], state: "failed", error: "x" }, { id: "gone-id", text: "Other", files: [], state: "failed", error: "y" }]);
    fake.transcript = [{ role: "user", content: "Hello", timestamp: 1, idempotencyKey: "held-id:user" }];
    const session = await connected();
    expect(loadLine(localStorage, KEY).map((item) => item.id)).toEqual(["gone-id"]);
    session.stop();
  });

  it("lets no failed history read decide that a message wasn't kept", async () => {
    const session = await connected();
    await session.send("Hello");
    const runId = fake.sent[0]!.idempotencyKey;
    fake.historyError = "chat.history timed out";
    await emit("chat", { runId, sessionKey: KEY, state: "error", errorMessage: "boom" });
    await settle();
    expect(loadLine(localStorage, KEY)).toEqual([]);
    fake.historyError = null;
    fake.transcript = [{ role: "user", content: "Hello", timestamp: 1, idempotencyKey: `${runId}:user` }];
    await emit("session.message", { sessionKey: KEY });
    await settle();
    expect(loadLine(localStorage, KEY)).toEqual([]);
    session.stop();
  });

  it("plays no Done when another turn took the message in (an ok answer)", async () => {
    fake.holdAck = true;
    const session = await connected();
    const sending = session.send("Also this");
    await settle();
    fake.ack?.({ runId: fake.sent[0]!.idempotencyKey, status: "ok" });
    await sending;
    await settle();
    expect(session.getSnapshot()).toMatchObject({ liveRunId: null, doneAt: null });
    session.stop();
  });

  it("Try again drops the old turn at once and puts your message over the new reply", async () => {
    fake.transcript = [
      { role: "user", content: "Hi", timestamp: 1, __branch: { id: "e0" } },
      { role: "assistant", content: [{ type: "text", text: "Hello" }], stopReason: "stop", timestamp: 2, __branch: { id: "e1", runId: "r0" } },
      { role: "user", content: "Write an essay", timestamp: 3, __branch: { id: "e2" } },
      { role: "assistant", content: [{ type: "text", text: "Old essay" }], stopReason: "stop", timestamp: 4, __branch: { id: "e3", runId: "r1" } },
    ];
    const session = await connected();
    expect(session.getSnapshot().history.filter((b) => b.kind === "user")).toHaveLength(2);
    await askAgain(session.engine, "e2");
    const snap = session.getSnapshot();
    expect(snap.history.map((b) => (b.kind === "user" || b.kind === "text" ? b.text : b.kind))).toEqual(["Hi", "Hello", "done"]);
    expect(snap).toMatchObject({ pendingUser: "Write an essay", liveRunId: fake.sent[0]!.idempotencyKey });
    session.stop();
  });

  it("ends the turn as Not sent when only sessions.changed reports its failure", async () => {
    const session = await connected();
    await session.send("Say hi in three words.");
    const runId = fake.sent[0]!.idempotencyKey;
    await emit("sessions.changed", { sessionKey: KEY, phase: "error", runId, error: "Session database changed while waiting for admission" });
    await settle();
    expect(session.getSnapshot()).toMatchObject({ liveRunId: null, pendingUser: null });
    expect(loadLine(localStorage, KEY)).toMatchObject([{ id: runId, state: "failed", error: "Session database changed while waiting for admission" }]);
    session.stop();
  });

  it("never lets another run take over your message, however early it reports", async () => {
    const session = await connected();
    await session.send("Write an essay");
    const runId = fake.sent[0]!.idempotencyKey;
    await agent("scheduled-run", 1, "lifecycle", { phase: "start", startedAt: 500 });
    expect(session.getSnapshot()).toMatchObject({ liveRunId: runId, pendingUser: "Write an essay" });
    session.stop();
  });

  it("draws a message sent mid-turn once when its own turn starts: over that turn, with no waiting copy", async () => {
    const session = await connected();
    await session.send("First");
    const first = fake.sent[0]!.idempotencyKey;
    await agent(first, 1, "lifecycle", { phase: "start", startedAt: 1 });
    await session.send("Second, right away", { queueMode: "interrupt" });
    const second = fake.sent[1]!.idempotencyKey;
    fake.pending = [{ id: "p2", runId: second, state: "queued", acceptedAt: 2, message: { role: "user", content: "Second, right away", timestamp: 2 } }];
    await emit("sessions.changed", { sessionKey: KEY });
    expect(session.getSnapshot().queued.map((q) => [q.block.text, q.state])).toEqual([["Second, right away", "queued"]]);
    fake.transcript = [{ role: "user", content: "First", timestamp: 1, idempotencyKey: `${first}:user` }];
    await agent(first, 2, "lifecycle", { phase: "end", startedAt: 1, endedAt: 3 });
    await settle();
    fake.pending = [];
    await agent(second, 1, "lifecycle", { phase: "start", startedAt: 4 });
    await settle();
    expect(session.getSnapshot()).toMatchObject({ liveRunId: second, pendingUser: "Second, right away" });
    expect(session.getSnapshot().queued).toEqual([]);
    session.stop();
  });
});

describe("mergeQueued", () => {
  it("leaves out the runs the thread draws itself", () => {
    const items = [{ id: "a", runId: "mine", state: "queued", acceptedAt: 1, message: { role: "user", content: "mine", timestamp: 1 } }];
    expect(mergeQueued([], { items }, KEY, true, new Set(["mine"]))).toEqual([]);
    expect(mergeQueued([], { items }, KEY, true)).toHaveLength(1);
  });
});
