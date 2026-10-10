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
  STALE_CLAIM_MS,
  type TrunkQueueItem,
} from "../agents/trunk-queue.js";
import type { BranchConfig } from "../config/types.branch.js";
import { createBranchTestState } from "../test-utils/branch-test-state.js";
import { reserveTestPortListener } from "../test-utils/port-claims.js";
import { disconnectGatewayClient, startGatewayWithClient } from "./test-helpers.e2e.js";
import { acquireGatewayE2ePortBlock } from "./test-helpers.listener.js";
import { buildMockOpenAiResponsesProvider } from "./test-openai-responses-model.js";

const HOLD = "demo-hold-this-run";
const FINISHED_BRIEF = "demo-finished-brief";
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

/**
 * Answers every model request at once, except one carrying HOLD while the hold is armed; that one waits until
 * released. The hold disarms as soon as it catches a request, so the rest of that run is answered normally.
 */
async function startProvider(
  requests: string[],
  held: Array<() => void>,
  hold: { armed: boolean },
) {
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
          if (hold.armed && body.includes(HOLD)) {
            hold.armed = false;
            held.push(() => answer(response, "demo long run finished"));
            return;
          }
          // A finished job's final message links its PR; any other run ends without one.
          answer(
            response,
            body.includes(FINISHED_BRIEF)
              ? "Final message: PR https://github.com/example/demo/pull/1 | head 0000000"
              : "demo job finished",
          );
        })().catch((error: unknown) => response.writeHead(500).end(String(error)));
      }),
  });
}

type Listed = { items: Array<TrunkQueueItem & { status: string }> };
type Gateway = Awaited<ReturnType<typeof startGatewayWithClient>>;

describe("Trunk job queue on a real gateway", { timeout: 300_000 }, () => {
  const requests: string[] = [];
  const held: Array<() => void> = [];
  const hold = { armed: false };
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
    providerServer = await startProvider(requests, held, hold);
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
        entries: { main: {}, ash: {}, "builder-birch": {} },
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
        for (const agentId of ["main", "ash", "builder-birch"]) {
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
    hold.armed = true;
    await client().request("chat.send", {
      sessionKey: "agent:builder-birch:main",
      message: `${HOLD} demo long task`,
      idempotencyKey: holdRun,
    });
    await vi.waitFor(() => expect(held).toHaveLength(1), { timeout: RUN_WAIT_MS });
    try {
      // Both claims were last touched long ago; only builder-birch has a run going right now.
      const longAgo = Date.now() - STALE_CLAIM_MS - 60_000;
      const longJob = addQueueItem(
        { title: "Demo long job", brief_text: "demo long" },
        process.env,
        longAgo,
      );
      claimNextQueueItem("builder-birch", process.env, longAgo);
      const lostJob = addQueueItem(
        { title: "Demo lost job", brief_text: "demo lost" },
        process.env,
        longAgo,
      );
      claimNextQueueItem("ash", process.env, longAgo);

      const listed = await list();

      expect(listed.find((item) => item.id === longJob.id)).toMatchObject({
        status: "claimed",
        claimed_by: "builder-birch",
      });
      expect(listed.find((item) => item.id === lostJob.id)).toMatchObject({
        status: "released",
        released_from: "ash",
      });
      await client().request("trunks.queue.done", { id: longJob.id });
      await client().request("trunks.queue.done", { id: lostJob.id });
    } finally {
      // Later tests need builder-birch idle whatever this one found.
      held.shift()?.();
      expect((await waitRun(holdRun)).status).toBe("ok");
      await waitIdle("builder-birch");
    }
  });

  it("starts the queued job by itself in a new thread when a Trunk's run ends", async () => {
    await waitIdle("builder-birch");
    const holdRun = randomUUID();
    hold.armed = true;
    await client().request("chat.send", {
      sessionKey: "agent:builder-birch:main",
      message: `${HOLD} demo first task`,
      idempotencyKey: holdRun,
    });
    await vi.waitFor(() => expect(held).toHaveLength(1), { timeout: RUN_WAIT_MS });
    const queued = await client().request<{ item: TrunkQueueItem }>("trunks.queue.add", {
      title: "Demo queued job",
      brief_text: "demo-queued-brief",
      priority: 1,
    });
    // The Trunk is mid-run, so the card waits for the run to end.
    expect(requestsWith("demo-queued-brief")).toHaveLength(0);

    held.shift()?.();
    expect((await waitRun(holdRun)).status).toBe("ok");

    await vi.waitFor(() => expect(requestsWith("demo-queued-brief")).toHaveLength(1), {
      timeout: RUN_WAIT_MS,
    });
    const claim = (await list()).find((item) => item.id === queued.item.id);
    // A fast run may already have completed the job; either way the idle Trunk took it.
    expect(claim).toMatchObject({ claimed_by: "builder-birch" });
    const threads = await client().request<{ sessions: Array<{ key: string; label?: string }> }>(
      "sessions.list",
      { agentId: "builder-birch", limit: 50 },
    );
    expect(threads.sessions).toContainEqual(
      expect.objectContaining({
        key: claim?.thread_key,
        label: expect.stringMatching(/^Demo queued job \([0-9a-f]{8}\)$/),
      }),
    );
    await waitIdle("builder-birch");
    await client().request("trunks.queue.done", { id: queued.item.id });
  });

  it("starts a card added while a Trunk is idle, without waiting for a run to end", async () => {
    await waitIdle("builder-birch");
    const added = await client().request<{ item: TrunkQueueItem }>("trunks.queue.add", {
      title: "Demo added job",
      brief_text: "demo-added-brief",
      priority: 100,
    });

    await vi.waitFor(() => expect(requestsWith("demo-added-brief")).toHaveLength(1), {
      timeout: RUN_WAIT_MS,
    });
    // The run may already have ended, which completes the job; either way the idle Trunk took it.
    const claim = (await list()).find((item) => item.id === added.item.id);
    expect(claim).toMatchObject({ claimed_by: "builder-birch" });
    await waitIdle("builder-birch");
    await client().request("trunks.queue.done", { id: added.item.id });
  });

  it("completes a job when its run ends cleanly, and does not send it again", async () => {
    await waitIdle("builder-birch");
    const job = await client().request<{ item: TrunkQueueItem }>("trunks.queue.add", {
      title: "Demo finished job",
      brief_text: "demo-finished-brief",
      priority: 2,
    });
    await vi.waitFor(() => expect(requestsWith("demo-finished-brief")).toHaveLength(1), {
      timeout: RUN_WAIT_MS,
    });
    // The key stored on the claim is the session key the gateway reports for its run, so the run's end matches it.
    const storedThread = (await list()).find((item) => item.id === job.item.id)?.thread_key;
    const sessionKeys = (
      await client().request<{ sessions: Array<{ key: string }> }>("sessions.list", {
        agentId: "builder-birch",
        limit: 200,
      })
    ).sessions.map((session) => session.key);
    expect(storedThread).toBeDefined();
    expect(sessionKeys).toContain(storedThread);

    await waitIdle("builder-birch");

    // The clean end closes the claim: the job is done, so a release has nothing to put back.
    await vi.waitFor(
      async () =>
        expect((await list()).find((item) => item.id === job.item.id)).toMatchObject({
          status: "done",
        }),
      {
        timeout: RUN_WAIT_MS,
      },
    );
    expect(await client().request("trunks.queue.release", { id: job.item.id })).toMatchObject({
      released: false,
    });
    expect(requestsWith("demo-finished-brief")).toHaveLength(1);
  });

  it("puts a job back when its run ends without a PR link, instead of marking it done", async () => {
    await waitIdle("builder-birch");
    const job = await client().request<{ item: TrunkQueueItem }>("trunks.queue.add", {
      title: "Demo job without a PR",
      brief_text: "demo-no-pr-brief",
      priority: 2,
    });
    await vi.waitFor(
      async () => {
        const row = (await list()).find((item) => item.id === job.item.id);
        expect(row?.failures ?? 0).toBeGreaterThanOrEqual(1);
        expect(row?.done_at).toBeUndefined();
      },
      { timeout: RUN_WAIT_MS },
    );
    expect(requestsWith("demo-no-pr-brief").length).toBeGreaterThanOrEqual(1);
    await client().request("trunks.queue.done", { id: job.item.id });
    await waitIdle("builder-birch");
  });
});
