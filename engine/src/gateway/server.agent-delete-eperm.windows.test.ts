import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import type { AgentsDeleteResult } from "../../packages/gateway-protocol/src/schema/agents-models-skills.js";
import { resolveAgentDir } from "../agents/agent-scope-config.js";
import {
  acquireAuthProfileReadDatabase,
  closeAuthProfileReadPool,
} from "../agents/auth-profiles/sqlite-read-pool.js";
import { loadConfig, writeConfigFile } from "../config/config.js";
import { resolveBranchAgentSqlitePath } from "../state/branch-agent-db.paths.js";
import { acquireTestPortBlock } from "../test-utils/port-claims.js";
import type { GatewayClient } from "./client.js";
import { connectGatewayClient, disconnectGatewayClient } from "./test-helpers.e2e.js";
import { installGatewayTestHooks, startTestGatewayServer } from "./test-helpers.js";

installGatewayTestHooks();

it.skipIf(process.platform !== "win32")(
  "moves an agent with an open database to Trash without failed paths",
  { timeout: 180_000 },
  async () => {
    const token = "agent-delete-open-database-test-token";
    const agentId = "delete-open-database";
    const workspace = path.join(process.env.BRANCH_STATE_DIR!, "workspace-delete-open-database");
    const config = loadConfig();
    await writeConfigFile({
      ...config,
      agents: {
        ...config.agents,
        entries: {
          ...config.agents?.entries,
          main: config.agents?.entries?.main ?? {},
          [agentId]: { workspace },
        },
      },
    });
    const portClaim = await acquireTestPortBlock({ offsets: [0, 1, 2, 3, 4] });
    const server = await startTestGatewayServer(portClaim, {
      bind: "loopback",
      auth: { mode: "token", token },
      controlUiEnabled: false,
    });
    let client: GatewayClient | undefined;
    let databasePath = "";
    try {
      client = await connectGatewayClient({
        url: `ws://127.0.0.1:${portClaim.port}`,
        token,
        role: "operator",
        scopes: ["operator.admin", "operator.read", "operator.write"],
      });
      const agentDir = resolveAgentDir(loadConfig(), agentId);
      await client.request("sessions.create", {
        agentId,
        key: `agent:${agentId}:main`,
      });
      databasePath = resolveBranchAgentSqlitePath({ agentId });
      await expect(fs.stat(databasePath)).resolves.toBeDefined();
      const reader = acquireAuthProfileReadDatabase(databasePath);
      expect(reader.status).toBe("readable");
      if (reader.status !== "readable") {
        throw new Error("the agent database did not open");
      }
      expect(reader.db.isOpen).toBe(true);

      const deleted = await client.request<AgentsDeleteResult>("agents.delete", {
        agentId,
        deleteFiles: true,
      });
      expect(deleted.failed).toEqual([]);
      expect(deleted.removed).toContainEqual({ path: agentDir, method: "trash" });
      expect(reader.db.isOpen).toBe(false);
      await expect(fs.stat(agentDir)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (databasePath) {
        closeAuthProfileReadPool({ kind: "database", databasePath });
      }
      if (client) {
        await disconnectGatewayClient(client);
      }
      await server.close({ reason: "agent delete open database test complete" });
    }
  },
);
