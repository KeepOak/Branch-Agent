// P45: an in-place engine handoff between two real engines on one state directory, with the test playing the
// desktop (desktop/src/main.ts): A runs, a standby B warms on its own port, A steps down, B takes over on the
// desktop's word, A finishes the run it had in flight and exits. Everything asserted is what the engines really
// did: the state lock, /readyz on both ports, the lease files, the model calls and the transcript.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayClient } from "../src/gateway/client.js";
import { buildMockOpenAiResponsesProvider } from "../src/gateway/test-openai-responses-model.js";
import { loadOrCreateDeviceIdentity } from "../src/infra/device-identity.js";
import { getFreePort } from "../src/test-utils/ports.js";
import {
  createBranchTestInstance,
  type BranchTestInstance,
} from "./helpers/branch-test-instance.js";
import {
  DESKTOP_DEACTIVATE,
  DESKTOP_DRAIN_STOP,
  DESKTOP_ROLLBACK,
  ENGINE_STANDBY_READY,
  ENGINE_TAKING_OVER,
  type HandoffEngine,
  engineLog,
  listLeasedLanes,
  probeReadyz,
  readStateOwner,
  sendDesktopRequest,
  sendTakeOver,
  spawnHandoffEngine,
  stopHandoffEngine,
  waitForEngineMessage,
  waitForReadyz,
  waitForStateOwner,
} from "./helpers/desktop-handoff-harness.js";
import { acquireGatewayTestClient } from "./helpers/gateway-client.js";
import {
  createHandoffChannelPlugin,
  HANDOFF_CHANNEL_ID,
} from "./helpers/handoff-channel-plugin.js";
import {
  HOLD_MARKER,
  type HandoffModelProvider,
  startHandoffModelProvider,
} from "./helpers/handoff-model-provider.js";

// The desktop's own bounds for each step (desktop/src/main.ts): a request answers within 20 s.
const DESKTOP_REQUEST_MS = 20_000;
const ENGINE_START_MS = 150_000;
const SESSION_S = "agent:main:handoff-s";
const SESSION_T = "agent:main:handoff-t";

/** Progress on stdout: each step of a slow scenario is visible in CI, and keeps the runner's no-output watchdog fed. */
function step(text: string): void {
  console.info(`[handoff ${new Date().toISOString()}] ${text}`);
}

type Scenario = {
  provider: HandoffModelProvider;
  instance: BranchTestInstance;
  engines: HandoffEngine[];
  clients: GatewayClient[];
  channel?: Awaited<ReturnType<typeof createHandoffChannelPlugin>>;
};

let scenario: Scenario | undefined;

afterEach(async () => {
  const current = scenario;
  scenario = undefined;
  if (!current) return;
  for (const client of current.clients)
    await client.stopAndWait({ timeoutMs: 1_000 }).catch(() => {});
  for (const engine of current.engines) await stopHandoffEngine(engine);
  await current.instance.cleanup().catch(() => {});
  await current.provider.close();
  await current.channel?.cleanup();
});

async function startScenario(signal: AbortSignal, withServices = false): Promise<Scenario> {
  const provider = await startHandoffModelProvider();
  const channel = withServices ? await createHandoffChannelPlugin() : undefined;
  const model = buildMockOpenAiResponsesProvider(provider.baseUrl, "gpt-5.6-luna");
  const modelRef = `openai/${model.modelId}`;
  const instance = await createBranchTestInstance({
    name: "desktop-handoff",
    signal,
    reserveIdlePort: false,
    config: {
      update: { checkOnStart: false },
      browser: { enabled: false },
      discovery: { mdns: { mode: "off" } },
      agents: {
        defaults: {
          timeoutSeconds: 600,
          heartbeat: { every: "0m" },
          model: { primary: modelRef },
          models: {
            [modelRef]: {
              agentRuntime: { id: "branch" },
              params: { transport: "sse", openaiWsWarmup: false },
            },
          },
        },
      },
      models: {
        mode: "merge",
        providers: {
          openai: {
            ...model.config,
            agentRuntime: { id: "branch" },
            request: { allowPrivateNetwork: true },
          },
        },
      },
      plugins: {
        entries: {
          browser: { enabled: false },
          ...(channel ? { [HANDOFF_CHANNEL_ID]: { enabled: true } } : {}),
        },
        ...(channel ? { load: { paths: [channel.pluginDir] } } : {}),
      },
    },
    env: {
      BRANCH_TEST_MINIMAL_GATEWAY: undefined,
      BRANCH_SKIP_PROVIDERS: undefined,
      BRANCH_SKIP_CHANNELS: withServices ? undefined : "1",
      BRANCH_SKIP_CRON: withServices ? undefined : "1",
      BRANCH_NO_RESPAWN: "1",
      OPENAI_API_KEY: "synthetic-desktop-handoff",
    },
  });
  scenario = { provider, instance, engines: [], clients: [], channel };
  return scenario;
}

async function spawnEngine(
  current: Scenario,
  name: string,
  port: number,
  standby = false,
): Promise<HandoffEngine> {
  const engine = await spawnHandoffEngine({ name, instance: current.instance, port, standby });
  current.engines.push(engine);
  return engine;
}

async function connect(
  current: Scenario,
  port: number,
  signal: AbortSignal,
): Promise<GatewayClient> {
  const client = await acquireGatewayTestClient(
    {
      url: `ws://127.0.0.1:${port}`,
      token: current.instance.gatewayToken,
      clientName: "gateway-client",
      mode: "backend",
      clientDisplayName: "desktop-handoff-proof",
      clientVersion: "test",
      platform: process.platform,
      role: "operator",
      scopes: ["operator.admin", "operator.read", "operator.write"],
      deviceIdentity: loadOrCreateDeviceIdentity({
        path: current.instance.state.path(`client-device-${port}.sqlite`),
      }),
    },
    {
      timeoutMs: 30_000,
      timeoutMessage: `handoff client did not connect on ${port}`,
      closeMessage: `handoff client on ${port} closed`,
      signal,
    },
  );
  current.clients.push(client);
  return client;
}

/**
 * A ready engine still prepares its agent databases in the background ("has not completed startup inspection and
 * preparation"); session work answers a retryable UNAVAILABLE until then.
 */
async function whenAgentsReady<T>(work: () => Promise<T>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await work();
    } catch (error) {
      const unavailable = (error as { gatewayCode?: unknown })?.gatewayCode === "UNAVAILABLE";
      if (!unavailable || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

async function sendTurn(client: GatewayClient, sessionKey: string, message: string) {
  return await client.request<{ runId: string }>(
    "chat.send",
    { sessionKey, idempotencyKey: randomUUID(), message, deliver: false },
    { expectFinal: false },
  );
}

async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs: number, what: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out after ${timeoutMs}ms: ${what}`);
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${timeoutMs}ms: ${what}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function freePortOtherThan(port: number): Promise<number> {
  for (;;) {
    const candidate = await getFreePort();
    if (candidate !== port) return candidate;
  }
}

/** After the old engine has exited, the successor must also answer /readyz on the configured port. */
async function expectConfiguredPortReady(
  configuredPort: number,
  livePort: number,
  successor: HandoffEngine,
): Promise<void> {
  expect(await probeReadyz(livePort), `successor still serves on ${livePort}`).toBe(200);
  await waitForReadyz(configuredPort, 200, 30_000, successor);
}

/**
 * A runs on its port with a turn on S held at the model; B is a warm standby on its own port; A has stepped down
 * (deactivate-result ok) and B has taken over on the desktop's word. Returns both engines and a client on B.
 */
async function handOverWithRunInFlight(
  current: Scenario,
  signal: AbortSignal,
  beforeDeactivate?: (clientA: GatewayClient, a: HandoffEngine, b: HandoffEngine) => Promise<void>,
  afterDeactivate?: (a: HandoffEngine, b: HandoffEngine) => Promise<void>,
) {
  const portA = current.instance.port;
  const portB = await freePortOtherThan(portA);
  step(`starting A on ${portA}`);
  const a = await spawnEngine(current, "A", portA);
  await waitForReadyz(portA, 200, ENGINE_START_MS, a);
  await waitForStateOwner(a.env, a.child.pid!, 10_000);
  step("A owns the state and is ready");

  const clientA = await connect(current, portA, signal);
  await whenAgentsReady(() =>
    clientA.request("sessions.create", { agentId: "main", key: SESSION_S }),
  );
  await sendTurn(clientA, SESSION_S, `MARK_A ${HOLD_MARKER}: keep this run in flight.`);
  await current.provider.waitForHeld("A", 60_000);
  step("A's run on S is in flight; starting standby B");

  const b = await spawnEngine(current, "B", portB, true);
  const ready = await waitForEngineMessage(b, ENGINE_STANDBY_READY, ENGINE_START_MS);
  expect(ready).toMatchObject({ pid: b.child.pid, port: portB });
  // B holds its port but is not ready, and A still owns the state.
  expect(await probeReadyz(portB)).toBe(503);
  expect((await readStateOwner(a.env))?.pid).toBe(a.child.pid);
  await beforeDeactivate?.(clientA, a, b);

  const noAdmissionStarted = performance.now();
  const deactivated = await sendDesktopRequest(a, DESKTOP_DEACTIVATE, DESKTOP_REQUEST_MS);
  expect(deactivated.ok, engineLog(a)).toBe(true);
  // A keeps exactly the session with its run in flight.
  expect(listLeasedLanes(a.env)).toEqual([{ lane: `session:${SESSION_S}`, pid: a.child.pid }]);
  await afterDeactivate?.(a, b);
  // A released the state, but B waits for the desktop's word.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  expect(b.messages.some((message) => message.type === ENGINE_TAKING_OVER)).toBe(false);
  expect(await probeReadyz(portB)).toBe(503);

  step("A stepped down and keeps S; telling B to take over");
  sendTakeOver(b);
  const taking = await waitForEngineMessage(b, ENGINE_TAKING_OVER, 30_000);
  expect(taking).toMatchObject({ pid: b.child.pid, port: portB });
  await waitForReadyz(portB, 200, ENGINE_START_MS, b);
  const noAdmissionGapMs = performance.now() - noAdmissionStarted;
  step(`measured no-admission gap: ${Math.round(noAdmissionGapMs)}ms`);
  expect(noAdmissionGapMs).toBeLessThan(DESKTOP_REQUEST_MS + ENGINE_START_MS);
  await waitForStateOwner(b.env, b.child.pid!, 10_000);
  // Never zero engines: A is still up, finishing its run.
  expect(a.hasExited(), engineLog(a)).toBe(false);

  step("B owns the state and is ready");
  const clientB = await connect(current, portB, signal);
  // /readyz can precede agent-database inspection. Every case below exercises
  // session behavior, so wait for that separate admission boundary once here.
  await whenAgentsReady(() => clientB.request("sessions.create", {
    agentId: "main",
    key: "agent:main:handoff-successor-ready",
  }));
  return { a, b, portA, portB, clientA, clientB, noAdmissionGapMs };
}

describe("in-place engine handoff between real engines", () => {
  it(
    "hands the state to the standby with a run in flight; the old engine finishes it, releases it and exits",
    { timeout: 420_000 },
    async ({ signal }) => {
      const current = await startScenario(signal);
      const { a, b, portA, portB, clientA, clientB, noAdmissionGapMs } = await handOverWithRunInFlight(current, signal);
      expect(noAdmissionGapMs).toBeGreaterThan(0);

      // Another session runs on B at once, while A still holds S.
      await whenAgentsReady(() =>
        clientB.request("sessions.create", { agentId: "main", key: SESSION_T }),
      );
      const t = await sendTurn(clientB, SESSION_T, "MARK_T: run now.");
      await clientB.request("agent.wait", { runId: t.runId, timeoutMs: 60_000 });
      expect(current.provider.answered).toContain("T");
      expect(current.provider.answered).not.toContain("A");
      expect(listLeasedLanes(a.env)).toEqual([{ lane: `session:${SESSION_S}`, pid: a.child.pid }]);

      // A finishes its run on S and lets the session go.
      current.provider.release("A");
      await waitUntil(() => listLeasedLanes(a.env).length === 0, 60_000, "A releases S");
      step(`A released S; model answers: ${JSON.stringify(current.provider.answered)}`);
      const oldHistory = await clientA
        .request("chat.history", { sessionKey: SESSION_S })
        .catch((error: unknown) => ({ error: String(error) }));
      step(
        `A reply markers: ${JSON.stringify(JSON.stringify(oldHistory).match(/REPLY_[A-Za-z0-9]+/g))}`,
      );
      let transcript = "";
      try {
        await waitUntil(
          async () => {
            let history: unknown;
            try {
              history = await clientB.request("chat.history", { sessionKey: SESSION_S });
            } catch (error) {
              // The released session changes placement while B adopts it; retry the read.
              if (String(error).includes("placement authority changed")) return false;
              throw error;
            }
            transcript = JSON.stringify(history);
            return transcript.includes("REPLY_A");
          },
          150_000,
          "A's final reply appears on B",
        );
      } catch (error) {
        throw new Error(
          `${String(error)}; model answers=${JSON.stringify(current.provider.answered)}; B reply markers=${JSON.stringify(transcript.match(/REPLY_[A-Za-z0-9]+/g))}`,
        );
      }
      const successor = await sendTurn(clientB, SESSION_S, "MARK_S: run after A releases S.");
      await clientB.request("agent.wait", { runId: successor.runId, timeoutMs: 60_000 });
      await waitUntil(
        async () => {
          transcript = JSON.stringify(
            await clientB.request("chat.history", { sessionKey: SESSION_S }),
          );
          return transcript.includes("REPLY_S");
        },
        90_000,
        "B's next reply appears after A's final reply",
      );
      expect(transcript).toContain("REPLY_S");
      expect(transcript.indexOf("REPLY_A")).toBeLessThan(transcript.indexOf("REPLY_S"));
      const answersOnS = current.provider.answered.filter(
        (marker) => marker === "A" || marker === "S",
      );
      expect(answersOnS.at(-1)).toBe("S");
      expect(answersOnS.slice(0, -1).every((marker) => marker === "A")).toBe(true);

      // The desktop stops A; it exits and leaves no lease behind. B serves on.
      await sendDesktopRequest(a, DESKTOP_DRAIN_STOP, DESKTOP_REQUEST_MS);
      await withTimeout(a.exited, 60_000, `A exits after drain-stop\n${engineLog(a)}`);
      expect(listLeasedLanes(a.env)).toEqual([]);
      await expectConfiguredPortReady(portA, portB, b);
    },
  );

  it(
    "queues B's turn on S while A holds S and preserves reply order",
    { timeout: 420_000 },
    async ({ signal }) => {
      const current = await startScenario(signal);
      const { a, clientB } = await handOverWithRunInFlight(current, signal);
      const pending = sendTurn(clientB, SESSION_S, "MARK_S: queued while A holds S.");
      void pending.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(current.provider.answered).not.toContain("S");
      expect(listLeasedLanes(a.env)).toEqual([{ lane: `session:${SESSION_S}`, pid: a.child.pid }]);
      current.provider.release("A");
      const successor = await withTimeout(pending, 90_000, "B admits queued turn on S");
      await clientB.request("agent.wait", { runId: successor.runId, timeoutMs: 60_000 });
      await waitUntil(() => listLeasedLanes(a.env).length === 0, 60_000, "A releases S");
      let history = "";
      await waitUntil(async () => {
        history = JSON.stringify(await clientB.request("chat.history", { sessionKey: SESSION_S }));
        return history.includes("REPLY_A") && history.includes("REPLY_S");
      }, 90_000, "both replies on B after the queued turn");
      expect(history.indexOf("REPLY_A")).toBeGreaterThanOrEqual(0);
      expect(history.indexOf("REPLY_S")).toBeGreaterThan(history.indexOf("REPLY_A"));
    },
  );

  it(
    "keeps A alive on drain-stop while it holds S, then stops after its reply",
    { timeout: 420_000 },
    async ({ signal }) => {
      const current = await startScenario(signal);
      const { a, b, portA, portB, clientB } = await handOverWithRunInFlight(current, signal);
      await sendDesktopRequest(a, DESKTOP_DRAIN_STOP, DESKTOP_REQUEST_MS);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(a.hasExited()).toBe(false);
      expect(listLeasedLanes(a.env)).toEqual([{ lane: `session:${SESSION_S}`, pid: a.child.pid }]);
      current.provider.release("A");
      await withTimeout(a.exited, 90_000, `A exits after held turn finishes\n${engineLog(a)}`);
      await waitUntil(async () =>
        JSON.stringify(await clientB.request("chat.history", { sessionKey: SESSION_S })).includes("REPLY_A"),
      90_000, "A's reply is visible from B");
      await expectConfiguredPortReady(portA, portB, b);
    },
  );

  it(
    "rolls back before the standby takes over: the old engine takes the state back and serves again",
    { timeout: 300_000 },
    async ({ signal }) => {
      const current = await startScenario(signal);
      const portA = current.instance.port;
      const portB = await freePortOtherThan(portA);
      const a = await spawnEngine(current, "A", portA);
      await waitForReadyz(portA, 200, ENGINE_START_MS, a);
      const b = await spawnEngine(current, "B", portB, true);
      await waitForEngineMessage(b, ENGINE_STANDBY_READY, ENGINE_START_MS);

      expect((await sendDesktopRequest(a, DESKTOP_DEACTIVATE, DESKTOP_REQUEST_MS)).ok).toBe(true);
      // The standby fails before it was told to take over: the desktop kills it and rolls A back.
      await stopHandoffEngine(b);
      const rolledBack = await sendDesktopRequest(a, DESKTOP_ROLLBACK, DESKTOP_REQUEST_MS);
      expect(rolledBack.ok, engineLog(a)).toBe(true);
      await waitForReadyz(portA, 200, ENGINE_START_MS, a);
      await waitForStateOwner(a.env, a.child.pid!, 10_000);
      expect(a.hasExited()).toBe(false);

      // A serves turns again.
      const client = await connect(current, portA, signal);
      await whenAgentsReady(() =>
        client.request("sessions.create", { agentId: "main", key: SESSION_T }),
      );
      const t = await sendTurn(client, SESSION_T, "MARK_R: run after rollback.");
      await client.request("agent.wait", { runId: t.runId, timeoutMs: 60_000 });
      expect(current.provider.answered).toContain("R");
    },
  );

  it(
    "starts the successor channel and fires a due cron job exactly once across handoff",
    { timeout: 420_000 },
    async ({ signal }) => {
      const current = await startScenario(signal, true);
      const channel = current.channel!;
      let jobId = "";
      let cronDueAt = 0;
      const { a, b, portA, portB, clientB } = await handOverWithRunInFlight(
        current,
        signal,
        async (clientA, oldEngine) => {
          await waitUntil(
            async () => (await channel.starts()).length === 1,
            30_000,
            "only A's channel starts before take-over",
          );
          expect(await channel.starts()).toEqual([oldEngine.child.pid]);
          cronDueAt = Date.now() + 45_000;
          const job = await clientA.request<{ id: string }>("cron.add", {
            name: "P45 handoff once",
            agentId: "main",
            enabled: true,
            schedule: { kind: "at", at: new Date(cronDueAt).toISOString() },
            sessionTarget: "isolated",
            wakeMode: "now",
            payload: { kind: "agentTurn", message: "MARK_C: due during handoff." },
            delivery: { mode: "none" },
          });
          jobId = job.id;
        },
        async () => {
          // The job becomes due while A is deactivated and B has not been
          // told to take over. B must claim the overdue job exactly once.
          expect(Date.now(), "cron was already due before A deactivated").toBeLessThan(cronDueAt);
          await new Promise((resolve) => setTimeout(resolve, cronDueAt - Date.now() + 1_000));
        },
      );
      await waitUntil(
        async () => (await channel.starts()).includes(b.child.pid!),
        60_000,
        "B's channel starts after take-over",
      );
      expect(await channel.starts()).toEqual([a.child.pid, b.child.pid]);
      await whenAgentsReady(() =>
        clientB.request("sessions.create", { agentId: "main", key: "agent:main:handoff-cron-ready" }),
      );
      let runs: { entries: Array<{ status: string }> } = { entries: [] };
      try {
        await waitUntil(
          async () => {
            try {
              runs = await clientB.request<{ entries: Array<{ status: string }> }>("cron.runs", {
                id: jobId,
                limit: 10,
              });
            } catch (error) {
              // /readyz can lead cron receipt-authority settlement after a take-over.
              if ((error as { gatewayCode?: unknown }).gatewayCode === "UNAVAILABLE") return false;
              throw error;
            }
            return runs.entries.length > 0;
          },
          240_000,
          "the due cron job has a run receipt",
        );
      } catch (error) {
        throw new Error(
          `${String(error)}; runs=${JSON.stringify(runs)}; answers=${JSON.stringify(current.provider.answered)}; A=${engineLog(a)}; B=${engineLog(b)}`,
        );
      }
      step(`cron runs: ${JSON.stringify(runs)}; answers: ${JSON.stringify(current.provider.answered)}`);
      expect(runs.entries).toHaveLength(1);
      expect(runs.entries[0]?.status).toBe("ok");
      expect(current.provider.answered).toContain("C");
      expect(await channel.starts()).toEqual([a.child.pid, b.child.pid]);

      current.provider.release("A");
      await waitUntil(() => listLeasedLanes(a.env).length === 0, 60_000, "A releases S");
      await sendDesktopRequest(a, DESKTOP_DRAIN_STOP, DESKTOP_REQUEST_MS);
      await withTimeout(a.exited, 60_000, `A exits after channel/cron handoff\n${engineLog(a)}`);
      await expectConfiguredPortReady(portA, portB, b);
    },
  );

  it(
    "takes the state back when the desktop goes away before the standby took over",
    { timeout: 300_000 },
    async ({ signal }) => {
      const current = await startScenario(signal);
      const portA = current.instance.port;
      const portB = await freePortOtherThan(portA);
      const a = await spawnEngine(current, "A", portA);
      await waitForReadyz(portA, 200, ENGINE_START_MS, a);
      const b = await spawnEngine(current, "B", portB, true);
      await waitForEngineMessage(b, ENGINE_STANDBY_READY, ENGINE_START_MS);
      expect((await sendDesktopRequest(a, DESKTOP_DEACTIVATE, DESKTOP_REQUEST_MS)).ok).toBe(true);
      step("A stepped down; the desktop crashes before take-over");
      // Both engines lose their channel to the desktop at once.
      a.child.disconnect();
      b.child.disconnect();
      // The standby never starts on its own, and A serves again: never zero engines for long.
      await withTimeout(b.exited, 60_000, `B exits without its launcher\n${engineLog(b)}`);
      await waitForStateOwner(a.env, a.child.pid!, 60_000);
      await waitForReadyz(portA, 200, ENGINE_START_MS, a);
      expect(a.hasExited()).toBe(false);
    },
  );

  it(
    "does not roll the old engine back after the standby has taken the state",
    { timeout: 420_000 },
    async ({ signal }) => {
      const current = await startScenario(signal);
      const { a, b, portA, portB, clientB } = await handOverWithRunInFlight(current, signal);

      const rolledBack = await sendDesktopRequest(a, DESKTOP_ROLLBACK, DESKTOP_REQUEST_MS);
      expect(rolledBack.ok, engineLog(a)).toBe(false);
      expect((await readStateOwner(b.env))?.pid).toBe(b.child.pid);
      expect(await probeReadyz(portB)).toBe(200);

      current.provider.release("A");
      await waitUntil(() => listLeasedLanes(a.env).length === 0, 60_000, "A releases S");
      await sendDesktopRequest(a, DESKTOP_DRAIN_STOP, DESKTOP_REQUEST_MS);
      await withTimeout(a.exited, 60_000, `A exits after failed rollback\n${engineLog(a)}`);

      await whenAgentsReady(() =>
        clientB.request("sessions.create", { agentId: "main", key: SESSION_T }),
      );
      const t = await sendTurn(clientB, SESSION_T, "MARK_R: run on B after failed rollback.");
      await clientB.request("agent.wait", { runId: t.runId, timeoutMs: 60_000 });
      expect(current.provider.answered).toContain("R");
      await expectConfiguredPortReady(portA, portB, b);
    },
  );

  it(
    "finishes and stops the old engine when the desktop goes away after the take-over",
    { timeout: 420_000 },
    async ({ signal }) => {
      const current = await startScenario(signal);
      const { a, b, portA, portB } = await handOverWithRunInFlight(current, signal);
      step("the desktop crashes after take-over");
      a.child.disconnect();
      b.child.disconnect();
      // A is not left fenced on its port: it finishes S and stops by itself. B serves on.
      current.provider.release("A");
      await withTimeout(a.exited, 120_000, `A stops after its run\n${engineLog(a)}`);
      expect(listLeasedLanes(b.env)).toEqual([]);
      expect(b.hasExited()).toBe(false);
      await expectConfiguredPortReady(portA, portB, b);
    },
  );

  it(
    "makes a session RPC on a session the old engine still finishes wait for it",
    { timeout: 420_000 },
    async ({ signal }) => {
      const current = await startScenario(signal);
      const { clientB } = await handOverWithRunInFlight(current, signal);
      const patched = clientB.request("sessions.patch", {
        key: SESSION_S,
        label: "renamed during handoff",
      });
      void patched.catch(() => {});
      const outcome = await Promise.race([
        patched.then(
          () => "answered",
          () => "answered",
        ),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 3_000)),
      ]);
      expect(outcome).toBe("waiting");
      current.provider.release("A");
      await withTimeout(patched, 90_000, "session patch after A releases S");
    },
  );
});
