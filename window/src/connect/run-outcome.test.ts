// How a run ends, as the window tells it (live-findings 3, 4, 9, 26): Stop is not success, a failing approval ledger
// does not leave a raw notice, and an approval card that arrives first makes the run "Waiting for you".
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";

type Options = { onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };

const fake = vi.hoisted(() => ({
  options: null as Options | null,
  transcript: [] as Record<string, unknown>[],
  ledgerError: null as string | null,
  historyError: null as string | null,
  aborted: true,
  sent: [] as string[],
  inFlight: null as string | null,
  ackStatus: "started",
}));

vi.mock("./gateway", () => ({
  BranchGateway: class {
    constructor(options: Options) {
      fake.options = options;
    }
    start(): void {}
    stop(): void {}
    async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
      switch (method) {
        case "chat.history":
          if (fake.historyError) throw new Error(fake.historyError);
          return { messages: fake.transcript.map((m) => ({ ...m })), ...(fake.inFlight ? { inFlightRun: { runId: fake.inFlight, text: "" } } : {}) };
        case "chat.send":
          fake.sent.push(String(params?.idempotencyKey));
          return { runId: params?.idempotencyKey, status: fake.ackStatus };
        case "agents.list":
          return { agents: [{ id: "main", name: "Juniper" }], defaultId: "main" };
        case "approval.history":
          if (fake.ledgerError) throw new Error(fake.ledgerError);
          return { items: [] };
        case "exec.approval.list":
          return [];
        case "exec.approval.resolve":
          throw new Error("approval expired");
        case "chat.abort":
          return { aborted: fake.aborted, runIds: fake.aborted ? [params?.runId] : [] };
        default:
          return {};
      }
    }
  },
}));

import { SaplingSession } from "./session";

const KEY = "agent:main:main";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: KEY } }, auth: { scopes: [] }, policy: {} };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const emit = async (event: string, payload: unknown) => {
  fake.options?.onEvent({ event, payload });
  await settle();
};
const agent = (runId: string, seq: number, stream: string, data: Record<string, unknown>) =>
  emit("agent", { runId, seq, stream, ts: seq, sessionKey: KEY, data });

async function connected(): Promise<SaplingSession> {
  const session = new SaplingSession("ws://fake", undefined);
  session.start();
  fake.options?.onStatus({ phase: "connected", hello } as unknown as GatewayStatus);
  await settle();
  await settle();
  return session;
}

afterEach(() => {
  Object.assign(fake, { options: null, transcript: [], ledgerError: null, historyError: null, aborted: true, sent: [], inFlight: null, ackStatus: "started" });
});

describe("how a run ends", () => {
  it("Stop ends the turn as Stopped: no Done face, no cheer, and the turn says so even with nothing written", async () => {
    const session = await connected();
    await session.send("Write an essay");
    const runId = fake.sent[0]!;
    await agent(runId, 1, "lifecycle", { phase: "start", startedAt: 1 });
    await session.stopRun();
    fake.transcript = [{ role: "user", content: "Write an essay", timestamp: 1, idempotencyKey: `${runId}:user` }];
    await emit("chat", { runId, sessionKey: KEY, state: "aborted" });
    await settle();
    const snap = session.getSnapshot();
    expect(snap).toMatchObject({ liveRunId: null, doneAt: null, ended: { runId, outcome: "stopped" } });
    expect(snap.history.map((b) => b.kind)).toEqual(["user", "done"]);
    expect(snap.history[1]).toMatchObject({ kind: "done", runId, stopped: true });
  });

  it("Stop pressed as the run finishes leaves a finished turn Done when the engine had nothing to abort", async () => {
    fake.aborted = false;
    const session = await connected();
    await session.send("Hello");
    const runId = fake.sent[0]!;
    fake.transcript = [
      { role: "user", content: "Hello", timestamp: 1_000, idempotencyKey: `${runId}:user` },
      { role: "assistant", content: [{ type: "text", text: "Hi" }], stopReason: "stop", timestamp: 2_000, __branch: { runId, recordTimestampMs: 3_000 } },
    ];
    const stopping = session.stopRun();
    await agent(runId, 1, "lifecycle", { phase: "end", startedAt: 1_000, endedAt: 3_000 });
    await stopping;
    await settle();
    expect(session.getSnapshot().ended).toMatchObject({ runId, outcome: "done" });
    expect(session.getSnapshot().history.find((b) => b.kind === "done")).not.toHaveProperty("stopped");
  });

  it("clears only the notice a failed history read left, never another one", async () => {
    const session = await connected();
    fake.historyError = "chat.history timed out";
    await emit("session.message", { sessionKey: KEY });
    await settle();
    expect(session.getSnapshot().error).toBe("chat.history timed out");
    fake.historyError = null;
    await emit("session.message", { sessionKey: KEY });
    await settle();
    expect(session.getSnapshot().error).toBeNull();
    // A notice of another kind (an answer the engine refused) outlives a later history read.
    await session.answer("a1", "allow-once");
    expect(session.getSnapshot().error).toBe("approval expired");
    await emit("session.message", { sessionKey: KEY });
    await settle();
    expect(session.getSnapshot().error).toBe("approval expired");
  });

  it("reads a stop from the run's own end (aborted), with no chat event", async () => {
    const session = await connected();
    await session.send("Essay");
    const runId = fake.sent[0]!;
    fake.transcript = [{ role: "user", content: "Essay", timestamp: 1, idempotencyKey: `${runId}:user` }];
    await agent(runId, 1, "lifecycle", { phase: "end", aborted: true, status: "cancelled", startedAt: 1, endedAt: 2 });
    await settle();
    expect(session.getSnapshot()).toMatchObject({ ended: { runId, outcome: "stopped" }, doneAt: null });
  });

  it.each([
    ["timeout", "It ran out of time."],
    ["restart", "Interrupted by a restart."],
    ["auth-revoked", "Its provider was signed out."],
  ])("doesn't call a run aborted for %s Stopped: it failed, and its error stays", async (stopReason) => {
    const session = await connected();
    await session.send("Essay");
    const runId = fake.sent[0]!;
    fake.transcript = [{ role: "user", content: "Essay", timestamp: 1, idempotencyKey: `${runId}:user` }];
    await agent(runId, 1, "lifecycle", { phase: "end", aborted: true, status: "cancelled", stopReason, startedAt: 1, endedAt: 2 });
    await settle();
    expect(session.getSnapshot()).toMatchObject({ ended: { runId, outcome: "failed" }, doneAt: null });
    expect(session.getSnapshot().history.find((b) => b.kind === "done")).not.toMatchObject({ stopped: true });
  });

  it("reads the chat aborted event the same way: a timeout is not a Stop", async () => {
    const session = await connected();
    await session.send("Essay");
    const runId = fake.sent[0]!;
    fake.transcript = [{ role: "user", content: "Essay", timestamp: 1, idempotencyKey: `${runId}:user` }];
    await emit("chat", { runId, sessionKey: KEY, state: "aborted", stopReason: "timeout" });
    await settle();
    expect(session.getSnapshot().ended).toMatchObject({ runId, outcome: "failed" });
  });

  it("clears your bubble when another turn that is still running took your message in", async () => {
    const session = await connected();
    // The other turn starts on another device after you pressed Send; the engine takes your message into it.
    fake.inFlight = "other-run";
    fake.ackStatus = "ok";
    await session.send("Also this");
    await settle();
    await settle();
    expect(session.getSnapshot()).toMatchObject({ liveRunId: "other-run", pendingUser: null, ended: { outcome: "absorbed" } });
  });

  it("leaves your bubble alone when a run that isn't yours is taken into another turn", async () => {
    const session = await connected();
    await session.send("Essay");
    const runId = fake.sent[0]!;
    await agent(runId, 1, "lifecycle", { phase: "start", startedAt: 1 });
    // A message from another device was superseded: its run ends, but it was never this window's send.
    await agent("from-the-phone", 2, "lifecycle", { phase: "end", aborted: true, status: "cancelled", stopReason: "superseded", startedAt: 1, endedAt: 2 });
    await settle();
    expect(session.getSnapshot()).toMatchObject({ liveRunId: runId, pendingUser: "Essay" });
    expect(session.getSnapshot().ended?.runId).not.toBe("from-the-phone");
  });

  it("leaves your running message's bubble when a queued send of yours is the one taken in", async () => {
    const session = await connected();
    await session.send("First");
    const first = fake.sent[0]!;
    await agent(first, 1, "lifecycle", { phase: "start", startedAt: 1 });
    await session.send("Queued second");
    const second = fake.sent[1]!;
    await agent(second, 2, "lifecycle", { phase: "end", aborted: true, status: "cancelled", stopReason: "superseded", startedAt: 1, endedAt: 2 });
    await settle();
    expect(session.getSnapshot()).toMatchObject({ liveRunId: first, pendingUser: "First" });
    expect(session.getSnapshot().ended?.runId).not.toBe(second);
  });

  it("a run that finishes plays Done and names itself for the cheer", async () => {
    const session = await connected();
    await session.send("Hello");
    const runId = fake.sent[0]!;
    fake.transcript = [
      { role: "user", content: "Hello", timestamp: 1_000, idempotencyKey: `${runId}:user` },
      { role: "assistant", content: [{ type: "text", text: "Hi" }], stopReason: "stop", timestamp: 2_000, __branch: { runId, recordTimestampMs: 9_000 } },
    ];
    await agent(runId, 1, "lifecycle", { phase: "end", startedAt: 1_000, endedAt: 9_000 });
    await settle();
    const snap = session.getSnapshot();
    expect(snap.ended).toMatchObject({ runId, outcome: "done" });
    expect(snap.doneAt).not.toBeNull();
    expect(snap.history.find((b) => b.kind === "done")).toMatchObject({ runId, durationMs: 8_000 });
  });

  it("shows the history when the approval ledger fails, with no notice left behind", async () => {
    fake.ledgerError = "approval not found";
    fake.transcript = [{ role: "user", content: "Hi", timestamp: 1 }];
    const session = await connected();
    expect(session.getSnapshot()).toMatchObject({ error: null });
    expect(session.getSnapshot().history.map((b) => b.kind)).toEqual(["user"]);
  });

  it("puts an approval card raised for the live run into that run, so it reads Waiting for you", async () => {
    const session = await connected();
    await session.send("Run a command");
    const runId = fake.sent[0]!;
    await agent(runId, 1, "lifecycle", { phase: "start", startedAt: 1 });
    await agent(runId, 2, "tool", { phase: "start", name: "exec", toolCallId: "t1", args: { command: "sleep 25; echo second" } });
    await emit("exec.approval.requested", { id: "a1", request: { command: "sleep 25; echo second", sessionKey: KEY, runId } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const live = session.getSnapshot().live;
    expect(live.filter((b) => b.kind === "approval")).toMatchObject([{ approval: { id: "a1", state: "pending" } }]);
    // The run's own waiting-approval event later puts the card in place; it is not drawn twice.
    await agent(runId, 3, "lifecycle", { phase: "waiting-approval", approvalId: "a1" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(session.getSnapshot().live.filter((b) => b.kind === "approval")).toHaveLength(1);
  });
});
