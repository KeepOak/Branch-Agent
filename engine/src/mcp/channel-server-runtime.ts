import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BranchConfig } from "../config/types.branch.js";
import { VERSION } from "../version.js";
import { BranchChannelBridge } from "./channel-bridge.js";
import { ClaudePermissionRequestSchema, type ClaudeChannelMode } from "./channel-shared.js";
import { getChannelMcpCapabilities, registerChannelMcpTools } from "./channel-tools.js";
import { registerTrunkMcpTools, type OutsideAgentIdentity } from "./trunk-tools.js";

const HELLO_INTERVAL_MS = 60_000;

/** The connected MCP client as an outside agent: its clientInfo title or name, version and this computer. */
export function outsideAgentFromClient(
  client: { name?: string; title?: string; version?: string } | undefined,
  where: string = os.hostname(),
): OutsideAgentIdentity | undefined {
  const name = (client?.title || client?.name || "").trim().slice(0, 100);
  if (!name) return undefined;
  const id =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "outside-agent";
  return {
    id,
    name,
    ...(client?.version ? { version: client.version.slice(0, 64) } : {}),
    ...(where ? { where: where.slice(0, 255) } : {}),
  };
}

async function resolveMcpConfig(config: BranchConfig | undefined): Promise<BranchConfig> {
  if (config) {
    return config;
  }
  const { getRuntimeConfig } = await import("../config/config.js");
  return getRuntimeConfig();
}

export async function createChannelMcpRuntime(
  opts: {
    gatewayUrl?: string;
    gatewayToken?: string;
    gatewayPassword?: string;
    config?: BranchConfig;
    claudeChannelMode?: ClaudeChannelMode;
    verbose?: boolean;
  } = {},
): Promise<{
  server: McpServer;
  bridge: BranchChannelBridge;
  start: () => Promise<void>;
  close: () => Promise<void>;
}> {
  const cfg = await resolveMcpConfig(opts.config);
  const claudeChannelMode = opts.claudeChannelMode ?? "auto";
  const capabilities = getChannelMcpCapabilities(claudeChannelMode);
  const server = new McpServer(
    { name: "branch", version: VERSION },
    capabilities ? { capabilities } : undefined,
  );
  const bridge = new BranchChannelBridge(cfg, {
    gatewayUrl: opts.gatewayUrl,
    gatewayToken: opts.gatewayToken,
    gatewayPassword: opts.gatewayPassword,
    claudeChannelMode,
    verbose: opts.verbose ?? false,
  });
  bridge.setServer(server);

  server.server.setNotificationHandler(ClaudePermissionRequestSchema, async ({ params }) => {
    await bridge.handleClaudePermissionRequest({
      requestId: params.request_id,
      toolName: params.tool_name,
      description: params.description,
      inputPreview: params.input_preview,
    });
  });
  registerChannelMcpTools(server, bridge);

  // Part B: once the MCP client has said who it is, Branch shows it as an outside-agent contact and its
  // messages as its own. A gateway without contacts.outside.hello keeps plain (owner) messages.
  let outsideAgent: OutsideAgentIdentity | undefined;
  let helloTimer: NodeJS.Timeout | undefined;
  const hello = async (agent: OutsideAgentIdentity) => {
    try {
      await bridge.request("contacts.outside.hello", { agent });
      outsideAgent = agent;
    } catch (error) {
      if (opts.verbose)
        process.stderr.write(`branch mcp: outside-agent hello failed: ${String(error)}
`);
    }
  };
  server.server.oninitialized = () => {
    const agent = outsideAgentFromClient(server.server.getClientVersion());
    if (!agent) return;
    void hello(agent);
    helloTimer = setInterval(() => void hello(agent), HELLO_INTERVAL_MS);
    helloTimer.unref();
  };
  registerTrunkMcpTools(server, bridge, { outsideAgent: () => outsideAgent });

  return {
    server,
    bridge,
    start: async () => {
      await bridge.start();
    },
    close: async () => {
      if (helloTimer) clearInterval(helloTimer);
      // Both lifecycle owners must always close; one failure cannot strand the other.
      const results = await Promise.allSettled([bridge.close(), server.close()]);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length === 1) {
        throw errors[0];
      }
      if (errors.length > 1) {
        throw new AggregateError(errors, "Branch Agent channel MCP shutdown failed");
      }
    },
  };
}
