// Native SQLite persistence proof for Goose session/new metadata through Branch's existing authorized route.
import fs from "node:fs/promises";
import path from "node:path";
import { createInMemorySessionStore } from "@branch/acp-core/session";
import { afterEach, expect, it, vi } from "vitest";
import { SESSION_TYPE_VALUES } from "../../packages/gateway-protocol/src/schema/sessions-row.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { loadSessionEntryReadOnly } from "../config/sessions/session-accessor.js";
import type { GatewayClient } from "../gateway/client.js";
import { handleGatewayRequest } from "../gateway/server-methods.js";
import { initializeRepository } from "../gateway/server.sessions.create.projects.test-support.js";
import { testState } from "../gateway/test-helpers.js";
import {
  directSessionReq,
  setupGatewaySessionsHandlerTestHarness,
} from "../gateway/test/server-sessions.test-helpers.js";
import { registerProjectRegistry } from "../projects/project-registry.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import {
  persistAcpSessionCreationMeta,
  readAcpSessionCreationMeta,
} from "./session-creation-meta.js";
import { AcpTranslatorSessionState } from "./translator.session-state.js";
import {
  createAcpConnection,
  createAcpGateway,
  createAcpGatewayAgent,
} from "./translator.test-helpers.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const { createSessionStoreDir } = setupGatewaySessionsHandlerTestHarness();
afterEach(() => {
  closeBranchStateDatabaseForTest();
  testState.agentConfig = undefined;
});

function nativeGateway(scopes = ["operator.write"]) {
  const request = async (method: string, params: Record<string, unknown>) => {
    expect(method).toBe("sessions.create");
    const result = await directSessionReq<{ key: string; ok: boolean }>("sessions.create", params, {
      client: { connect: { scopes } } as never,
    });
    if (!result.ok) {
      throw new Error(result.error?.message ?? "Session creation rejected");
    }
    return result.payload;
  };
  return { request: request as GatewayClient["request"] };
}

async function workspaceFixture() {
  const root = tempDirs.make("branch-acp-creation-meta-");
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  testState.agentConfig = { workspace };
  const { storePath } = await createSessionStoreDir();
  return { root, workspace, storePath };
}

it("persists ACP metadata in the actual native SQLite row and registered project placement", async () => {
  const f = await workspaceFixture();
  const repoRoot = await initializeRepository(f.workspace, "registered-project");
  const project = await registerProjectRegistry({ path: repoRoot });
  const { sessionKey: key, cwd } = await persistAcpSessionCreationMeta(
    nativeGateway(),
    "agent:main:dashboard:acp-meta",
    f.workspace,
    readAcpSessionCreationMeta({ projectId: project.id, sessionTitle: " Client-owned title " }),
  );
  expect(cwd).toBe(repoRoot);
  expect(loadSessionEntryReadOnly({ sessionKey: key, storePath: f.storePath })).toMatchObject({
    projectId: project.id,
    displayName: "Client-owned title",
    sessionRoot: repoRoot,
    spawnedCwd: repoRoot,
  });
});

it("persists the full source title beyond 500 characters and preserves it on adoption", async () => {
  const f = await workspaceFixture();
  const title = "Long client title ".repeat(80).trim();
  const { sessionKey: key } = await persistAcpSessionCreationMeta(
    nativeGateway(),
    "agent:main:dashboard:long-acp-meta",
    f.workspace,
    { projectId: "workspace:main", sessionTitle: title },
  );
  expect(loadSessionEntryReadOnly({ sessionKey: key, storePath: f.storePath })?.displayName).toBe(
    title,
  );
  await persistAcpSessionCreationMeta(nativeGateway(), key, f.workspace, {
    projectId: "workspace:main",
    sessionTitle: "Replacement must not rename an existing row",
  });
  expect(loadSessionEntryReadOnly({ sessionKey: key, storePath: f.storePath })?.displayName).toBe(
    title,
  );
});

function readOnlyGateway() {
  const request = async (method: string, params: Record<string, unknown>) => {
    let error: string | undefined;
    await handleGatewayRequest({
      req: { type: "req", id: "fixture-read-only", method, params },
      respond: (ok, _payload, failure) => {
        if (!ok) {
          error = failure?.message;
        }
      },
      client: {
        connId: "fixture-read-only",
        connect: {
          role: "operator",
          scopes: ["operator.read"],
          minProtocol: 1,
          maxProtocol: 1,
          client: { id: "test", version: "1", platform: "test", mode: "test" },
        },
      } as Parameters<typeof handleGatewayRequest>[0]["client"],
      isWebchatConnect: () => false,
      context: { logGateway: { warn: vi.fn() } } as unknown as Parameters<
        typeof handleGatewayRequest
      >[0]["context"],
    });
    if (error) {
      throw new Error(error);
    }
    throw new Error("Read-only request was not rejected by the RPC scope gate");
  };
  return { request: request as GatewayClient["request"] };
}

it("preserves native write authority and never creates a row for a read-only client", async () => {
  const f = await workspaceFixture();
  const key = "agent:main:dashboard:denied-acp-meta";
  await expect(
    persistAcpSessionCreationMeta(readOnlyGateway(), key, f.workspace, {
      projectId: "workspace:main",
      sessionTitle: "Denied",
    }),
  ).rejects.toThrow("missing scope: operator.write");
  expect(loadSessionEntryReadOnly({ sessionKey: key, storePath: f.storePath })).toBeUndefined();
});

it.each([
  { meta: undefined, type: "acp" },
  { meta: { hidden: true, client: 7 }, type: "hidden" },
  { meta: { client: "" }, type: "user" },
])(
  "persists the source creation type, survives cold reload and preserves adoption: $type",
  async ({ meta, type }) => {
    const f = await workspaceFixture();
    const created = await persistAcpSessionCreationMeta(
      nativeGateway(),
      `agent:main:dashboard:typed-${type}`,
      f.workspace,
      readAcpSessionCreationMeta(meta),
    );
    expect(
      loadSessionEntryReadOnly({ sessionKey: created.sessionKey, storePath: f.storePath })
        ?.sessionType,
    ).toBe(type);
    await persistAcpSessionCreationMeta(nativeGateway(), created.sessionKey, f.workspace, {
      sessionType: type === "hidden" ? "user" : "hidden",
    });
    expect(
      loadSessionEntryReadOnly({ sessionKey: created.sessionKey, storePath: f.storePath })
        ?.sessionType,
    ).toBe(type);
    const reset = await directSessionReq("sessions.reset", { key: created.sessionKey });
    expect(reset.ok).toBe(true);
    closeBranchStateDatabaseForTest();
    expect(
      loadSessionEntryReadOnly({ sessionKey: created.sessionKey, storePath: f.storePath })
        ?.sessionType,
    ).toBe(type);
  },
);

it("retrieves a Hidden snapshot through the actual native list route by its known key", async () => {
  const f = await workspaceFixture();
  const created = await persistAcpSessionCreationMeta(
    nativeGateway(),
    "agent:main:dashboard:hidden-snapshot",
    f.workspace,
    readAcpSessionCreationMeta({ hidden: true, sessionTitle: "Hidden title" }),
  );
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    expect(method).toBe("sessions.list");
    const result = await directSessionReq("sessions.list", params);
    expect(result.ok).toBe(true);
    return result.payload;
  });
  const state = new AcpTranslatorSessionState(
    { request: request as GatewayClient["request"] } as GatewayClient,
    {} as never,
    vi.fn(),
  );
  const snapshot = await state.getExistingSnapshot(created.sessionKey);
  expect(snapshot.metadata?.title).toBe("Hidden title");
  expect(request).toHaveBeenCalledWith(
    "sessions.list",
    expect.objectContaining({ search: created.sessionKey, sessionTypes: [...SESSION_TYPE_VALUES] }),
  );
  const normal = await directSessionReq<{ sessions: Array<{ key: string }> }>("sessions.list", {});
  expect(normal.payload?.sessions.some((row) => row.key === created.sessionKey)).toBe(false);
});

it("creates an actual ACP bridge fallback key through the native gateway and binds the durable Hidden row", async () => {
  const f = await workspaceFixture();
  const store = createInMemorySessionStore();
  const request = async (method: string, params: Record<string, unknown>) => {
    if (method !== "sessions.create" && method !== "sessions.list") {
      throw new Error(`Unexpected fixture request: ${method}`);
    }
    const response = await directSessionReq(method, params);
    if (!response.ok) {
      throw new Error(response.error?.message ?? "Native fixture request rejected");
    }
    return response.payload;
  };
  const agent = createAcpGatewayAgent(
    createAcpConnection(),
    createAcpGateway(request as GatewayClient["request"]),
    { sessionStore: store },
  );
  const result = await agent.newSession({
    cwd: f.workspace,
    mcpServers: [],
    _meta: { hidden: true, client: 42, sessionTitle: "Private bridge" },
  });
  const bridge = store.getSession(result.sessionId);
  expect(bridge?.sessionKey).toMatch(/^agent:main:acp-bridge:/);
  expect(bridge?.cwd).toBe(f.workspace);
  expect(
    loadSessionEntryReadOnly({ sessionKey: bridge!.sessionKey, storePath: f.storePath }),
  ).toMatchObject({ sessionType: "hidden", displayName: "Private bridge" });
});
