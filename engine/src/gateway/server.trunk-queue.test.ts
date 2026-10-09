// Real gateway proof for the Trunk job queue: the run-end hook, real sessions.create and chat.send admission,
// and claim expiry checked against the live run registry. Demo data only.
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { expect, it, vi } from "vitest";
import { runQaGatewayFixture } from "../../test/helpers/qa-gateway-cleanup.js";
import type { AgentWaitResult } from "../agents/run-wait.types.js";
import {
  addQueueItem,
  claimNextQueueItem,
  STALE_CLAIM_MS,
  type TrunkQueueItem,
} from "../agents/trunk-queue.js";
import type { BranchConfig } from "../config/types.branch.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
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

it(
  "runs queued jobs through the real gateway: run-end pickup, fresh reassignment, long runs keep claims",
  { timeout: 300_000 },
  async () => {
    await withBranchTestState(
      {
        label: "trunk-queue-e2e",
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
      },
      async (state) => {
        const portClaim = await acquireGatewayE2ePortBlock();
        state.envVars.BRANCH_BUNDLED_PLUGINS_DIR = state.path("no-plugins");
        // The queue hook reaches the gateway as a local client, the way trunk_send does.
        state.envVars.BRANCH_GATEWAY_PORT = String(portClaim.port);
        state.applyEnv();
        const requests: string[] = [];
        const held: Array<() => void> = [];
        let providerServer: Awaited<ReturnType<typeof startProvider>> | undefined;
        let gateway: Awaited<ReturnType<typeof startGatewayWithClient>> | undefined;
        await runQaGatewayFixture(
          async () => {
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
            const client = gateway.client;
            // Session storage can still be opening right after startup; wait until every Trunk answers.
            await vi.waitFor(
              async () => {
                for (const agentId of ["main", "ash", "birch"]) {
                  await client.request("sessions.list", { agentId, limit: 1 });
                }
              },
              { timeout: RUN_WAIT_MS, interval: 1_000 },
            );
            const list = async () => (await client.request<Listed>("trunks.queue.list", {})).items;
            const runToEnd = async (sessionKey: string, message: string) => {
              const runId = randomUUID();
              await client.request("chat.send", { sessionKey, message, idempotencyKey: runId });
              const done = await client.request<AgentWaitResult>(
                "agent.wait",
                { runId, timeoutMs: RUN_WAIT_MS },
                { timeoutMs: RUN_WAIT_MS + 5_000 },
              );
              expect(done.status).toBe("ok");
            };
            const requestsWith = (text: string) => requests.filter((body) => body.includes(text));

            // 1. A run lasting past the 2-hour mark keeps its claim; a claim with no run is released.
            const holdRun = randomUUID();
            await client.request("chat.send", {
              sessionKey: "agent:birch:main",
              message: `${HOLD} demo long task`,
              idempotencyKey: holdRun,
            });
            await vi.waitFor(() => expect(held).toHaveLength(1), { timeout: RUN_WAIT_MS });
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
            const afterExpiry = await list();
            expect(afterExpiry.find((item) => item.id === longJob.id)).toMatchObject({
              status: "claimed",
              claimed_by: "birch",
            });
            expect(afterExpiry.find((item) => item.id === lostJob.id)).toMatchObject({
              status: "released",
              released_from: "ash",
            });
            await client.request("trunks.queue.done", { id: longJob.id });
            await client.request("trunks.queue.done", { id: lostJob.id });
            held.shift()!();
            const holdDone = await client.request<AgentWaitResult>(
              "agent.wait",
              { runId: holdRun, timeoutMs: RUN_WAIT_MS },
              { timeoutMs: RUN_WAIT_MS + 5_000 },
            );
            expect(holdDone.status).toBe("ok");

            // 2. Birch's run ends and the queued job starts by itself in a new thread titled with the job.
            const queued = await client.request<{ item: TrunkQueueItem }>("trunks.queue.add", {
              title: "Demo queued job",
              brief_text: "demo-queued-brief",
              priority: 1,
            });
            expect(requestsWith("demo-queued-brief")).toHaveLength(0);
            await runToEnd("agent:birch:main", "demo first task");
            await vi.waitFor(() => expect(requestsWith("demo-queued-brief")).toHaveLength(1), {
              timeout: RUN_WAIT_MS,
            });
            const birchClaim = (await list()).find((item) => item.id === queued.item.id);
            expect(birchClaim).toMatchObject({ status: "claimed", claimed_by: "birch" });
            expect(birchClaim?.thread_key).toMatch(/^agent:birch:queue-/);
            const birchThreads = await client.request<{
              sessions: Array<{ key: string; label?: string }>;
            }>("sessions.list", { agentId: "birch", limit: 50 });
            expect(birchThreads.sessions).toContainEqual(
              expect.objectContaining({ key: birchClaim?.thread_key, label: "Demo queued job" }),
            );

            // 3. Released and reassigned to ash, the job is a fresh run in ash's own new thread, not a replay.
            await vi.waitFor(
              async () => {
                const rows = await client.request<{
                  sessions: Array<{ key: string; hasActiveRun?: boolean }>;
                }>("sessions.list", { agentId: "birch", limit: 50 });
                expect(rows.sessions.some((row) => row.hasActiveRun)).toBe(false);
              },
              { timeout: RUN_WAIT_MS },
            );
            expect(
              await client.request("trunks.queue.release", { id: queued.item.id }),
            ).toMatchObject({
              released: true,
              released_from: "birch",
            });
            await runToEnd("agent:ash:main", "demo ash task");
            await vi.waitFor(() => expect(requestsWith("demo-queued-brief")).toHaveLength(2), {
              timeout: RUN_WAIT_MS,
            });
            const ashClaim = (await list()).find((item) => item.id === queued.item.id);
            expect(ashClaim).toMatchObject({ status: "claimed", claimed_by: "ash" });
            expect(ashClaim?.thread_key).toMatch(/^agent:ash:queue-/);
            expect(ashClaim?.claim_id).not.toBe(birchClaim?.claim_id);
          },
          () => {
            for (const release of held.splice(0)) {
              release();
            }
          },
          () => (gateway ? disconnectGatewayClient(gateway.client) : undefined),
          () => gateway?.server.close({ reason: "trunk queue e2e complete" }),
          async () => {
            providerServer?.listener.closeAllConnections();
            await providerServer?.releaseListener();
          },
          () => providerServer?.claim.release(),
          () => portClaim.release(),
        );
      },
    );
  },
);
