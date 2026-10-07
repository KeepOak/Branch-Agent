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
});

async function startScenario(signal: AbortSignal): Promise<Scenario> {
  const provider = await startHandoffModelProvider();
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
      plugins: { entries: { browser: { enabled: false } } },
    },
    env: {
      BRANCH_TEST_MINIMAL_GATEWAY: undefined,
      BRANCH_SKIP_PROVIDERS: undefined,
      BRANCH_NO_RESPAWN: "1",
      OPENAI_API_KEY: "synthetic-desktop-handoff",
    },
  });
  scenario = { provider, instance, engines: [], clients: [] };
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

/**
 * A runs on its port with a turn on S held at the model; B is a warm standby on its own port; A has stepped down
 * (deactivate-result ok) and B has taken over on the desktop's word. Returns both engines and a client on B.
 */
async function handOverWithRunInFlight(current: Scenario, signal: AbortSignal) {
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

  const deactivated = await sendDesktopRequest(a, DESKTOP_DEACTIVATE, DESKTOP_REQUEST_MS);
  expect(deactivated.ok, engineLog(a)).toBe(true);
  // A keeps exactly the session with its run in flight.
  expect(listLeasedLanes(a.env)).toEqual([{ lane: `session:${SESSION_S}`, pid: a.child.pid }]);
  // A released the state, but B waits for the desktop's word.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  expect(b.messages.some((message) => message.type === ENGINE_TAKING_OVER)).toBe(false);
  expect(await probeReadyz(portB)).toBe(503);

  step("A stepped down and keeps S; telling B to take over");
  sendTakeOver(b);
  const taking = await waitForEngineMessage(b, ENGINE_TAKING_OVER, 30_000);
  expect(taking).toMatchObject({ pid: b.child.pid, port: portB });
  await waitForReadyz(portB, 200, ENGINE_START_MS, b);
  await waitForStateOwner(b.env, b.child.pid!, 10_000);
  // Never zero engines: A is still up, finishing its run.
  expect(a.hasExited(), engineLog(a)).toBe(false);

  step("B owns the state and is ready");
  const clientB = await connect(current, portB, signal);
  return { a, b, portA, portB, clientB };
}

describe("in-place engine handoff between real engines", () => {
  it(
    "hands the state to the standby with a run in flight; the old engine finishes it, releases it and exits",
    { timeout: 420_000 },
    async ({ signal }) => {
      const current = await startScenario(signal);
      const { a, portB, clientB } = await handOverWithRunInFlight(current, signal);

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
      const history = await clientB.request("chat.history", { sessionKey: SESSION_S });
      expect(JSON.stringify(history)).toContain("REPLY_A");

      // The desktop stops A; it exits and leaves no lease behind. B serves on.
      await sendDesktopRequest(a, DESKTOP_DRAIN_STOP, DESKTOP_REQUEST_MS);
      await withTimeout(a.exited, 60_000, `A exits after drain-stop\n${engineLog(a)}`);
      expect(listLeasedLanes(a.env)).toEqual([]);
      expect(await probeReadyz(portB)).toBe(200);
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
    "finishes and stops the old engine when the desktop goes away after the take-over",
    { timeout: 420_000 },
    async ({ signal }) => {
      const current = await startScenario(signal);
      const { a, b, portB } = await handOverWithRunInFlight(current, signal);
      step("the desktop crashes after take-over");
      a.child.disconnect();
      b.child.disconnect();
      // A is not left fenced on its port: it finishes S and stops by itself. B serves on.
      current.provider.release("A");
      await withTimeout(a.exited, 120_000, `A stops after its run\n${engineLog(a)}`);
      expect(listLeasedLanes(b.env)).toEqual([]);
      expect(b.hasExited()).toBe(false);
      expect(await probeReadyz(portB)).toBe(200);
    },
  );

  // #419 gates session writes outside the lane. This branch does not have it yet, so the assertion fails here and
  // `it.fails` keeps CI green; once #419 is in the stack this turns red and the marker must go.
  it.fails(
    "makes a session RPC on a session the old engine still finishes wait for it (#419)",
    { timeout: 420_000 },
    async ({ signal }) => {
      let clientB: GatewayClient;
      try {
        const current = await startScenario(signal);
        ({ clientB } = await handOverWithRunInFlight(current, signal));
      } catch (setupError) {
        // A broken setup must not pass as the expected failure: returning normally turns `it.fails` red.
        console.error("handoff setup failed before the #419 check", setupError);
        return;
      }
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
    },
  );
});
