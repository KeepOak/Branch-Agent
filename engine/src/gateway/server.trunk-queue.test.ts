// Real gateway proof for the Trunk job queue: the run-end hook, real sessions.create and chat.send admission,
// and claim expiry checked against the live run registry. Demo data only.
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runQaGatewayFixture } from "../../test/helpers/qa-gateway-cleanup.js";
import type { AgentWaitResult } from "../agents/run-wait.types.js";
import {
  addQueueItem,
  claimNextQueueItem,
  pickUpQueuedWork,
  STALE_CLAIM_MS,
  type TrunkQueueGateway,
  type TrunkQueueItem,
} from "../agents/trunk-queue.js";
import type { BranchConfig } from "../config/types.branch.js";
import { createBranchTestState } from "../test-utils/branch-test-state.js";
import { reserveTestPortListener } from "../test-utils/port-claims.js";
import { disconnectGatewayClient, startGatewayWithClient } from "./test-helpers.e2e.js";
import { acquireGatewayE2ePortBlock } from "./test-helpers.listener.js";
import { buildMockOpenAiResponsesProvider } from "./test-openai-responses-model.js";

const HOLD = "demo-hold-this-run";
// A model turn on a loaded host can take tens of seconds to reach the provider.
const RUN_WAIT_MS = 120_000;

function answer(response: ServerResponse, text: string) {
  const message = {
    type: "message",
    id: randomUUID(),
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of [
    {
      type: "response.output_item.added",
      item: { ...message, status: "in_progress", content: [] },
    },
    { type: "response.output_item.done", item: message },
    {
      type: "response.completed",
      response: {
        id: randomUUID(),
        status: "completed",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ]) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  response.end("data: [DONE]\n\n");
}

/** Answers every model request at once, except the first one carrying HOLD, which waits until released. */
async function startProvider(requests: string[], held: Array<() => void>) {
  let heldOnce = false;
  return await reserveTestPortListener({
    offsets: [0],
    createListener: () =>
      createServer((request, response) => {
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of request) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const body = Buffer.concat(chunks).toString("utf8");
          requests.push(body);
          // Later turns in the same thread carry HOLD in their history; only the first is held.
          if (body.includes(HOLD) && !heldOnce) {
            heldOnce = true;
            held.push(() => answer(response, "demo long run finished"));
            return;
          }
          answer(response, "demo job finished");
        })().catch((error: unknown) => response.writeHead(500).end(String(error)));
      }),
  });
}

type Listed = { items: Array<TrunkQueueItem & { status: string }> };
type Gateway = Awaited<ReturnType<typeof startGatewayWithClient>>;

describe("Trunk job queue on a real gateway", { timeout: 300_000 }, () => {
  const requests: string[] = [];
  const held: Array<() => void> = [];
  let state: Awaited<ReturnType<typeof createBranchTestState>> | undefined;
  let portClaim: Awaited<ReturnType<typeof acquireGatewayE2ePortBlock>> | undefined;
  let providerServer: Awaited<ReturnType<typeof startProvider>> | undefined;
  let gateway: Gateway | undefined;
  const client = () => gateway!.client;
  const list = async () => (await client().request<Listed>("trunks.queue.list", {})).items;
  const requestsWith = (text: string) => requests.filter((body) => body.includes(text));
  const waitRun = async (runId: string) =>
    await client().request<AgentWaitResult>(
      "agent.wait",
      { runId, timeoutMs: RUN_WAIT_MS },
      { timeoutMs: RUN_WAIT_MS + 5_000 },
    );
  const runToEnd = async (sessionKey: string, message: string) => {
    const runId = randomUUID();
    await client().request("chat.send", { sessionKey, message, idempotencyKey: runId });
    expect((await waitRun(runId)).status).toBe("ok");
  };
  const waitIdle = async (agentId: string) =>
    await vi.waitFor(
      async () => {
        const rows = await client().request<{ sessions: Array<{ hasActiveRun?: boolean }> }>(
          "sessions.list",
          { agentId, limit: 50 },
        );
        expect(rows.sessions.some((row) => row.hasActiveRun)).toBe(false);
      },
      { timeout: RUN_WAIT_MS },
    );

  beforeAll(async () => {
    state = await createBranchTestState({
      label: "trunk-queue-gateway",
      env: {
        BRANCH_GATEWAY_TOKEN: undefined,
        BRANCH_GATEWAY_PASSWORD: undefined,
        BRANCH_GATEWAY_URL: undefined,
        BRANCH_TEST_MINIMAL_GATEWAY: undefined,
        BRANCH_SKIP_CHANNELS: "1",
        BRANCH_SKIP_GMAIL_WATCHER: "1",
        BRANCH_SKIP_CRON: "1",
        BRANCH_SKIP_CANVAS_HOST: "1",
        BRANCH_SKIP_BROWSER_CONTROL_SERVER: "1",
        BRANCH_SKIP_PROVIDERS: "1",
        BRANCH_DISABLE_BUNDLED_PLUGINS: "1",
      },
    });
    portClaim = await acquireGatewayE2ePortBlock();
    state.envVars.BRANCH_BUNDLED_PLUGINS_DIR = state.path("no-plugins");
    // The queue hook reaches the gateway as a local client, the way trunk_send does.
    state.envVars.BRANCH_GATEWAY_PORT = String(portClaim.port);
    state.applyEnv();
    providerServer = await startProvider(requests, held);
    const provider = buildMockOpenAiResponsesProvider(
      `http://127.0.0.1:${providerServer.claim.port}/v1`,
      "trunk-queue-demo",
    );
    const token = "synthetic-trunk-queue-token";
    const cfg = {
      agents: {
        defaults: {
          workspace: state.workspaceDir,
          skipBootstrap: true,
          heartbeat: { every: "0m" },
          model: { primary: provider.modelRef },
          models: {
            [provider.modelRef]: { params: { transport: "sse", openaiWsWarmup: false } },
          },
        },
        defaultId: "main",
        entries: { main: {}, ash: {}, birch: {} },
      },
      gateway: { auth: { mode: "token", token } },
      models: { mode: "replace", providers: { [provider.providerId]: provider.config } },
      plugins: { slots: { memory: "none" } },
      tools: { profile: "minimal" },
    } satisfies BranchConfig;
    gateway = await startGatewayWithClient({
      cfg,
      configPath: state.configPath,
      token,
      portClaim,
      scopes: ["operator.admin", "operator.read", "operator.write"],
    });
    await gateway.server.startupSettled;
    // Session storage can still be opening right after startup; wait until every Trunk answers.
    await vi.waitFor(
      async () => {
        for (const agentId of ["main", "ash", "birch"]) {
          await client().request("sessions.list", { agentId, limit: 1 });
        }
      },
      { timeout: RUN_WAIT_MS, interval: 1_000 },
    );
  });

  afterAll(async () => {
    await runQaGatewayFixture(
      async () => {
        for (const release of held.splice(0)) {
          release();
        }
      },
      () => (gateway ? disconnectGatewayClient(gateway.client) : undefined),
      () => gateway?.server.close({ reason: "trunk queue gateway test complete" }),
      async () => {
        providerServer?.listener.closeAllConnections();
        await providerServer?.releaseListener();
      },
      () => providerServer?.claim.release(),
      () => portClaim?.release(),
      () => state?.cleanup(),
    );
  });

  it("keeps the claim of a run lasting past 2 hours and releases a claim with no run", async () => {
    const holdRun = randomUUID();
    await client().request("chat.send", {
      sessionKey: "agent:birch:main",
      message: `${HOLD} demo long task`,
      idempotencyKey: holdRun,
    });
    await vi.waitFor(() => expect(held).toHaveLength(1), { timeout: RUN_WAIT_MS });
    try {
      // Both claims were last touched long ago; only birch has a run going right now.
      const longAgo = Date.now() - STALE_CLAIM_MS - 60_000;
      const longJob = addQueueItem(
        { title: "Demo long job", brief_text: "demo long" },
        process.env,
        longAgo,
      );
      claimNextQueueItem("birch", process.env, longAgo);
      const lostJob = addQueueItem(
        { title: "Demo lost job", brief_text: "demo lost" },
        process.env,
        longAgo,
      );
      claimNextQueueItem("ash", process.env, longAgo);

      const listed = await list();

      expect(listed.find((item) => item.id === longJob.id)).toMatchObject({
        status: "claimed",
        claimed_by: "birch",
      });
      expect(listed.find((item) => item.id === lostJob.id)).toMatchObject({
        status: "released",
        released_from: "ash",
      });
      await client().request("trunks.queue.done", { id: longJob.id });
      await client().request("trunks.queue.done", { id: lostJob.id });
    } finally {
      // Later tests need birch idle whatever this one found.
      held.shift()?.();
      expect((await waitRun(holdRun)).status).toBe("ok");
      await waitIdle("birch");
    }
  });

  it("starts the queued job by itself in a new thread when a Trunk's run ends", async () => {
    const queued = await client().request<{ item: TrunkQueueItem }>("trunks.queue.add", {
      title: "Demo queued job",
      brief_text: "demo-queued-brief",
      priority: 1,
    });
    expect(requestsWith("demo-queued-brief")).toHaveLength(0);

    await runToEnd("agent:birch:main", "demo first task");

    await vi.waitFor(() => expect(requestsWith("demo-queued-brief")).toHaveLength(1), {
      timeout: RUN_WAIT_MS,
    });
    const claim = (await list()).find((item) => item.id === queued.item.id);
    expect(claim).toMatchObject({ status: "claimed", claimed_by: "birch" });
    const threads = await client().request<{ sessions: Array<{ key: string; label?: string }> }>(
      "sessions.list",
      { agentId: "birch", limit: 50 },
    );
    expect(threads.sessions).toContainEqual(
      expect.objectContaining({ key: claim?.thread_key, label: "Demo queued job" }),
    );
    await waitIdle("birch");
    await client().request("trunks.queue.done", { id: queued.item.id });
  });

  it("sends a released job to the next Trunk as a fresh run through real chat admission", async () => {
    const job = await client().request<{ item: TrunkQueueItem }>("trunks.queue.add", {
      title: "Demo reassigned job",
      brief_text: "demo-reassigned-brief",
      priority: 2,
    });
    const realGateway: TrunkQueueGateway = {
      request: async <T>(method: string, params: Record<string, unknown>) =>
        await client().request<T>(method, params),
    };
    const first = await pickUpQueuedWork({ agentId: "ash", gateway: realGateway });
    expect(first?.item.id).toBe(job.item.id);
    await vi.waitFor(() => expect(requestsWith("demo-reassigned-brief")).toHaveLength(1), {
      timeout: RUN_WAIT_MS,
    });
    await waitIdle("ash");
    expect(await client().request("trunks.queue.release", { id: job.item.id })).toMatchObject({
      released: true,
      released_from: "ash",
    });

    const second = await pickUpQueuedWork({ agentId: "birch", gateway: realGateway });

    expect(second?.item.id).toBe(job.item.id);
    expect(second?.threadKey).not.toBe(first?.threadKey);
    // A new model request means chat.send admitted a new run, not a replay of ash's attempt.
    await vi.waitFor(() => expect(requestsWith("demo-reassigned-brief")).toHaveLength(2), {
      timeout: RUN_WAIT_MS,
    });
    expect((await list()).find((item) => item.id === job.item.id)).toMatchObject({
      status: "claimed",
      claimed_by: "birch",
    });
  });
});
