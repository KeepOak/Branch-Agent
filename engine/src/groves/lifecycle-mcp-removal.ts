import { coerceErrorMessage } from "@branch/normalization-core/error-coercion";
import { unsetConfiguredMcpServer } from "../agents/mcp-config-mutation.js";
import { withGroveMcpLifecycleLease } from "../agents/mcp-lifecycle-lease.js";
import { normalizeConfiguredMcpServers } from "../config/mcp-config-normalize.js";
import { listConfiguredMcpServers } from "../config/mcp-config.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { GroveRemoveError } from "./lifecycle-delete-support.js";
import type { RemovedMcpServer } from "./lifecycle-remove-contract.js";
import type { GroveStatusRecord } from "./lifecycle-status.js";
import {
  deleteGroveMcpServerRef,
  digestGroveMcpServer,
  planGroveMcpServerRemoval,
  readGroveMcpServerRefsByName,
} from "./mcp.js";
import type { GroveReferencedCleanup } from "./package-remove.js";

type RemoveMcpServerOptions = BranchStateDatabaseOptions & {
  config?: BranchConfig;
  sourceMcpServers?: Record<string, Record<string, unknown>>;
  listMcpServers?: typeof listConfiguredMcpServers;
  referencedCleanup?: GroveReferencedCleanup;
  unsetMcpServer?: typeof unsetConfiguredMcpServer;
};

export async function removeGroveMcpServers(params: {
  agentId: string;
  servers: GroveStatusRecord["mcpServers"];
  options: RemoveMcpServerOptions;
  assertCurrent: () => void;
}): Promise<{ mcpServers: RemovedMcpServer[]; error?: string }> {
  const listed = params.options.sourceMcpServers
    ? undefined
    : params.options.listMcpServers
      ? await params.options.listMcpServers()
      : params.options.config
        ? undefined
        : await listConfiguredMcpServers();
  params.assertCurrent();
  if (listed && !listed.ok) {
    throw new GroveRemoveError("mcp_config_unavailable", listed.error);
  }
  const configured = listed?.ok
    ? listed.mcpServers
    : normalizeConfiguredMcpServers(
        params.options.sourceMcpServers ?? params.options.config?.mcp?.servers,
      );
  const unsetMcpServer = params.options.unsetMcpServer ?? unsetConfiguredMcpServer;
  const mcpServers: RemovedMcpServer[] = [];
  for (const server of params.servers) {
    let removalError: string | undefined;
    params.assertCurrent();
    await withGroveMcpLifecycleLease(server.name, params.options, async (assertMcpCurrent) => {
      const assertCurrent = () => {
        params.assertCurrent();
        assertMcpCurrent();
      };
      assertCurrent();
      const currentRef = readGroveMcpServerRefsByName(server.name, params.options).find(
        (candidate) => candidate.agentId === params.agentId,
      );
      if (!currentRef) {
        throw new GroveRemoveError(
          "mcp_cleanup_changed",
          `MCP ownership for ${JSON.stringify(server.name)} changed during removal.`,
        );
      }
      const ownerAction = planGroveMcpServerRemoval(currentRef, params.options).action;
      if (ownerAction === "release") {
        assertCurrent();
        deleteGroveMcpServerRef(params.agentId, server.name, params.options);
        mcpServers.push({
          name: server.name,
          action: server.state === "missing" ? "missing" : "released",
        });
        return;
      }
      const expectedServer = configured[server.name];
      if (!expectedServer) {
        if (server.state === "present") {
          throw new GroveRemoveError(
            "mcp_cleanup_changed",
            `MCP server ${JSON.stringify(server.name)} disappeared during removal.`,
          );
        }
        assertCurrent();
        deleteGroveMcpServerRef(params.agentId, server.name, params.options);
        mcpServers.push({ name: server.name, action: "missing" });
        return;
      }
      if (digestGroveMcpServer(expectedServer) !== currentRef.configDigest) {
        throw new GroveRemoveError(
          "mcp_cleanup_changed",
          `MCP server ${JSON.stringify(server.name)} changed during removal.`,
        );
      }
      try {
        const result = await unsetMcpServer({
          name: server.name,
          expectedServer,
          recordIndependentOwner: false,
          assertCurrent,
        });
        if (!result.ok) {
          throw new Error(result.error);
        }
        assertCurrent();
        deleteGroveMcpServerRef(params.agentId, server.name, params.options);
        mcpServers.push({ name: server.name, action: result.removed ? "removed" : "missing" });
      } catch (cause) {
        const message = coerceErrorMessage(cause);
        mcpServers.push({ name: server.name, action: "error", message });
        removalError = message;
      }
    });
    params.assertCurrent();
    if (removalError) {
      return { mcpServers, error: removalError };
    }
  }
  return { mcpServers };
}
