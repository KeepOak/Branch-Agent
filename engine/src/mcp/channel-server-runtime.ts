// From openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/mcp/channel-server-runtime.ts (atlas INTEGRATIONS-0020). Changed for Branch: retain Graft conversation tools and device-auth preparation before startup and the MCP handshake ordering; preserve bridge policy assertions (shared safety layer 41 and owner included-features rule 03 A1.4).
import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BranchConfig } from "../config/types.branch.js";
import { VERSION } from "../version.js";
import { BranchChannelBridge } from "./channel-bridge.js";
import { ClaudePermissionRequestSchema, type ClaudeChannelMode } from "./channel-shared.js";
import { getChannelMcpCapabilities, registerChannelMcpTools } from "./channel-tools.js";
import {
  GRAFT_DEVICE_SCOPES,
  graftBranchIdentity,
  graftTrunkIdentity,
  type GraftLink,
} from "./graft-join.js";
import { registerHubMcpTools } from "./hub-tools.js";
import { outsideAgentFromClient, OutsidePresence } from "./outside-presence.js";
import { registerTrunkMcpTools, type OutsideAgentIdentity } from "./trunk-tools.js";
import { registerUiMcpTools, UiSession } from "./ui-tools.js";

/** Settings › Grafts applies to every tool (channel, Trunk and window tools alike): each handler
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
    /** Branch-to-Branch: work with a host Branch this Branch joined, as its paired device. Its own Trunks
     *  appear on the host as contacts, and what its tools send is attributed to this Branch. */
    graftHost?: { link: GraftLink; trunks: { id: string; name?: string }[] };
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
    { name: "branch", title: "Graft: work with Branch", version: VERSION },
    capabilities ? { capabilities } : undefined,
  );
  const bridge = new BranchChannelBridge(cfg, {
    gatewayUrl: opts.gatewayUrl,
    gatewayToken: opts.gatewayToken,
    gatewayPassword: opts.gatewayPassword,
    ...(opts.graftHost
      ? {
          graftDevice: {
            url: opts.graftHost.link.url,
            tlsFingerprint: opts.graftHost.link.tlsFingerprint,
            scopes: GRAFT_DEVICE_SCOPES,
          },
        }
      : {}),
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
  // messages as its own, unless Settings › Grafts turned it away. A gateway without
  // contacts.outside.hello keeps plain (owner) messages.
  const presence = new OutsidePresence(
    (agent) => bridge.request("contacts.outside.hello", { agent }),
    (line) => opts.verbose && process.stderr.write(`branch mcp: ${line}${os.EOL}`),
    (agent) => bridge.request("contacts.outside.hello", { agent, leaving: true }),
  );
  const hello = (agent: OutsideAgentIdentity) =>
    bridge.request("contacts.outside.hello", { agent });
  const trunkPresences: OutsidePresence[] = [];
  const graftBranch = opts.graftHost ? graftBranchIdentity(opts.graftHost.link.name) : undefined;
  // A grafted Branch speaks as itself, whatever MCP client drives it (its hello starts once connected).
  if (!graftBranch) {
    server.server.oninitialized = () => {
      presence.start(outsideAgentFromClient(server.server.getClientVersion()));
    };
  }
  gateEveryTool(server, () => presence.assertAllowed());
  registerChannelMcpTools(server, bridge);

  const agentTools = {
    outsideAgent: () => presence.identity(),
    activity: (text: string) => presence.activity(text),
  };
  registerTrunkMcpTools(server, bridge, agentTools);
  // The hub: shared documents, memory, board cards and an activity feed inside the owner's Branch.
  registerHubMcpTools(server, bridge, agentTools);
  // Part C: eyes and hands on the Branch window. A separate test Branch unless the owner allowed their own.
  const ui = new UiSession(async (kind, uiOpts) => {
    const { openOwnerWindow, openTestInstance } = await import("./ui-target.js");
    if (kind !== "owner") return await openTestInstance(process.env, uiOpts);
    await presence.identity();
    if (!presence.mayDriveWindow()) {
      throw new Error(
        "The owner has not let this agent drive their window (Settings › Grafts). The test Branch is open to it.",
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
      if (!graftBranch || !opts.graftHost) return;
      presence.start(graftBranch);
      // Its Trunks say hello once the host knows the Branch they live on.
      await presence.identity();
      for (const trunk of opts.graftHost.trunks) {
        const trunkPresence = new OutsidePresence(hello);
        trunkPresence.start(graftTrunkIdentity(graftBranch, trunk));
        trunkPresences.push(trunkPresence);
      }
    },
    close: async () => {
      // A grafted Branch's presence belongs to its gateway's link, which keeps saying hello; no goodbye here.
      if (graftBranch) presence.stop();
      else await presence.leave();
      for (const trunkPresence of trunkPresences) trunkPresence.stop();
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
