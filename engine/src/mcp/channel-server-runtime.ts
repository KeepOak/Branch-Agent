import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BranchConfig } from "../config/types.branch.js";
import { VERSION } from "../version.js";
import { BranchChannelBridge } from "./channel-bridge.js";
import { ClaudePermissionRequestSchema, type ClaudeChannelMode } from "./channel-shared.js";
import { getChannelMcpCapabilities, registerChannelMcpTools } from "./channel-tools.js";
import { outsideAgentFromClient, OutsidePresence } from "./outside-presence.js";
import { registerTrunkMcpTools } from "./trunk-tools.js";
import { registerUiMcpTools, UiSession } from "./ui-tools.js";

/** Settings › Connected agents applies to every tool (channel, Trunk and window tools alike): each handler
 *  first asks whether Branch still lets this agent in. */
export function gateEveryTool(server: McpServer, gate: () => Promise<void>): void {
  const register = server.tool.bind(server) as (...args: unknown[]) => unknown;
  (server as { tool: unknown }).tool = (...args: unknown[]) => {
    const handler = args.at(-1);
    if (typeof handler === "function") {
      args[args.length - 1] = async (...input: unknown[]) => {
        await gate();
        return await (handler as (...a: unknown[]) => unknown)(...input);
      };
    }
    return register(...args);
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
  // Part B/D: once the MCP client has said who it is, Branch shows it as an outside-agent contact and its
  // messages as its own, unless Settings › Connected agents turned it away. A gateway without
  // contacts.outside.hello keeps plain (owner) messages.
  const presence = new OutsidePresence(
    (agent) => bridge.request("contacts.outside.hello", { agent }),
    (line) => opts.verbose && process.stderr.write(`branch mcp: ${line}${os.EOL}`),
  );
  server.server.oninitialized = () => {
    presence.start(outsideAgentFromClient(server.server.getClientVersion()));
  };
  gateEveryTool(server, () => presence.assertAllowed());
  registerChannelMcpTools(server, bridge);

  registerTrunkMcpTools(server, bridge, {
    outsideAgent: () => presence.identity(),
    activity: (text) => presence.activity(text),
  });
  // Part C: eyes and hands on the Branch window. A separate test Branch unless the owner allowed their own.
  const ui = new UiSession(async (kind, uiOpts) => {
    const { openOwnerWindow, openTestInstance } = await import("./ui-target.js");
    if (kind !== "owner") return await openTestInstance(process.env, uiOpts);
    await presence.identity();
    if (!presence.mayDriveWindow()) {
      throw new Error(
        "The owner has not let this agent drive their window (Settings › Connected agents). The test Branch is open to it.",
      );
    }
    return await openOwnerWindow();
  });
  registerUiMcpTools(server, ui);

  return {
    server,
    bridge,
    start: async () => {
      await bridge.start();
    },
    close: async () => {
      presence.stop();
      await ui.close().catch(() => undefined);
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
