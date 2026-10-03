// A real Gateway restart must remove interrupted Rings sessions from its public session list.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../src/config/types.branch.js";
import { connectGatewayClient, disconnectGatewayClient } from "../src/gateway/test-helpers.e2e.js";
import {
  getSessionEntry,
  listSessionEntries,
  upsertSessionEntry,
} from "../src/plugin-sdk/session-store-runtime.js";
import {
  appendSqliteSessionTranscriptEventForTest,
  closeBranchAgentDatabasesForTest,
} from "../src/plugin-sdk/sqlite-runtime-testing.js";
import {
  createBranchTestInstance,
  type BranchTestInstance,
} from "./helpers/branch-test-instance.js";

const STALE_AGE_MS = 600_000;
const WAIT_OPTIONS = { interval: 50, timeout: 15_000 } as const;
const instances: BranchTestInstance[] = [];

type GatewaySessionClient = Awaited<ReturnType<typeof connectGatewayClient>>;

afterEach(async () => {
  await Promise.all(instances.splice(0).map(async (instance) => await instance.cleanup()));
  closeBranchAgentDatabasesForTest();
});

async function seedSession(params: {
  agentId: string;
  suffix: string;
  updatedAt: number;
  pluginOwnerId?: string;
  transcript?: boolean;
}): Promise<string> {
  const sessionKey = `agent:${params.agentId}:${params.suffix}`;
  const sessionId = `${params.agentId}-${params.suffix}`;
  await upsertSessionEntry({
    agentId: params.agentId,
    sessionKey,
    entry: {
      sessionId,
      updatedAt: params.updatedAt,
      ...(params.pluginOwnerId ? { pluginOwnerId: params.pluginOwnerId } : {}),
    },
  });
  if (params.transcript) {
    await appendSqliteSessionTranscriptEventForTest({
      agentId: params.agentId,
      sessionId,
      sessionKey,
      event: {
        runId: `rings-narrative-${sessionId}`,
        timestamp: params.updatedAt,
        type: "metadata",
      },
    });
  }
  return sessionKey;
}

async function listSessionKeys(client: GatewaySessionClient): Promise<string[]> {
  const result = await client.request<{ sessions: Array<{ key: string }> }>("sessions.list", {
    includeGlobal: true,
    includeUnknown: true,
    limit: 100,
  });
  return result.sessions.map(({ key }) => key);
}

async function connect(instance: BranchTestInstance): Promise<GatewaySessionClient> {
  return await connectGatewayClient({
    url: instance.url,
    token: instance.gatewayToken,
    role: "operator",
    scopes: ["operator.admin", "operator.read", "operator.write"],
  });
}

describe("Gateway rings session restart cleanup", () => {
  it("removes stale child sessions after a real restart even when rings and cron are disabled", async () => {
    const config = {
      agents: { list: [{ id: "main", default: true }, { id: "worker" }] },
      plugins: {
        enabled: true,
        allow: ["memory-core"],
        slots: { memory: "memory-core" },
        entries: {
          "memory-core": {
            enabled: true,
            config: { rings: { enabled: false } },
          },
        },
      },
    } satisfies BranchConfig;
    const instance = await createBranchTestInstance({
      name: "rings-startup-cleanup",
      config,
      env: { BRANCH_TEST_MINIMAL_GATEWAY: undefined },
    });
    instances.push(instance);
    instance.state.applyEnv();
    expect(instance.env.BRANCH_SKIP_CRON).toBe("1");

    const sentinel = await seedSession({
      agentId: "main",
      suffix: "rings-narrative-startup-sentinel",
      updatedAt: Date.now() - STALE_AGE_MS,
      pluginOwnerId: "memory-core",
    });
    await instance.startGateway();
    let client = await connect(instance);

    try {
      // gateway_start fires after the listener opens; observe its first sweep.
      await vi.waitFor(() => {
        expect(getSessionEntry({ agentId: "main", sessionKey: sentinel }), instance.logs()).toBe(
          undefined,
        );
      }, WAIT_OPTIONS);

      // The serving Gateway owns its resident projection. Seed persisted rows only
      // after it stops, so the next process admits them through startup.
      await disconnectGatewayClient(client);
      await instance.stopGateway();

      const now = Date.now();
      const stale = await Promise.all([
        ...["light", "rem", "deep", "consolidation"].map(async (phase) =>
          seedSession({
            agentId: "main",
            suffix: `rings-narrative-${phase}-interrupted`,
            updatedAt: now - STALE_AGE_MS,
            transcript: true,
            ...(phase === "rem" ? {} : { pluginOwnerId: "memory-core" }),
          }),
        ),
        seedSession({
          agentId: "worker",
          suffix: "rings-narrative-worker-interrupted",
          updatedAt: now - STALE_AGE_MS,
          pluginOwnerId: "memory-core",
        }),
      ]);
      const preserved = await Promise.all([
        seedSession({
          agentId: "main",
          suffix: "rings-narrative-active-with-transcript",
          updatedAt: now,
          pluginOwnerId: "memory-core",
          transcript: true,
        }),
        seedSession({
          agentId: "main",
          suffix: "rings-narrative-active-before-transcript",
          updatedAt: now,
          pluginOwnerId: "memory-core",
        }),
        seedSession({
          agentId: "main",
          suffix: "rings-narrative-foreign",
          updatedAt: now - STALE_AGE_MS,
          pluginOwnerId: "other-plugin",
          transcript: true,
        }),
        seedSession({
          agentId: "main",
          suffix: "telegram:group:rings-narrative-conversation",
          updatedAt: now - STALE_AGE_MS,
        }),
      ]);

      const seededKeys = ["main", "worker"].flatMap((agentId) =>
        listSessionEntries({ agentId, readOnly: true }).map(({ sessionKey }) => sessionKey),
      );
      expect(seededKeys).toEqual(expect.arrayContaining([...stale, ...preserved]));

      await instance.startGateway();
      client = await connect(instance);

      await vi.waitFor(async () => {
        const keys = await listSessionKeys(client);
        expect(keys, instance.logs()).toEqual(expect.arrayContaining(preserved));
        for (const sessionKey of stale) {
          expect(keys, instance.logs()).not.toContain(sessionKey);
        }
      }, WAIT_OPTIONS);
    } finally {
      await disconnectGatewayClient(client).catch(() => undefined);
    }
  }, 180_000);
});
