/** Shared test harness for CLI runner bundle-MCP config preparation tests. */
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import {
  createBundleMcpTempHarness,
  createBundleProbePlugin,
} from "../../plugins/bundle-mcp.test-support.js";
import {
  captureEnv,
  createPathResolutionEnv,
  setTestEnvValue,
  withEnvAsync,
} from "../../test-utils/env.js";
import { disposeAllSessionMcpRuntimes } from "../agent-bundle-mcp-manager-api.js";
import { resolveConversationCapabilityProfile } from "../conversation-capability-profile.js";
import { prepareCliBundleMcpConfig } from "./bundle-mcp.js";

const tempHarness = createBundleMcpTempHarness();
let bundleProbeHomeDir = "";
let bundleProbeWorkspaceDir = "";
let bundleProbeServerPath = "";
let envSnapshot: ReturnType<typeof captureEnv> | undefined;

export const cliBundleMcpHarness = {
  tempHarness,
  get bundleProbeHomeDir() {
    return bundleProbeHomeDir;
  },
  get bundleProbeWorkspaceDir() {
    return bundleProbeWorkspaceDir;
  },
  get bundleProbeServerPath() {
    return bundleProbeServerPath;
  },
};

export function requireMcpConfigPath(args: readonly string[] | undefined): string {
  // Claude-style bundle MCP mode appends --mcp-config; callers need the generated path.
  const configFlagIndex = args?.indexOf("--mcp-config") ?? -1;
  if (configFlagIndex < 0) {
    throw new Error("expected --mcp-config arg");
  }
  const generatedConfigPath = args?.[configFlagIndex + 1];
  if (typeof generatedConfigPath !== "string" || generatedConfigPath.length === 0) {
    throw new Error("expected --mcp-config path arg");
  }
  return generatedConfigPath;
}

export function setupCliBundleMcpTestHarness(): void {
  beforeEach(async () => {
    // MCP stdio startup and catalog probes use real timers. The shared test
    // scheduler defaults to a manual clock that never fires those waits.
    const { createTestGatewayScheduler } = await import("../../test-utils/gateway-scheduler-clock.js");
    const { setSessionMcpRuntimeScheduler } = await import("../agent-bundle-mcp-manager-api.js");
    const { onTestFinished } = await import("vitest");
    const scheduler = createTestGatewayScheduler("fake-timers");
    onTestFinished(() => scheduler.stop());
    await setSessionMcpRuntimeScheduler(scheduler);
  });
  afterEach(disposeAllSessionMcpRuntimes);

  beforeAll(async () => {
    // Use an empty bundled-dir override so only temp fixture plugins participate.
    envSnapshot = captureEnv(["BRANCH_BUNDLED_PLUGINS_DIR"]);
    bundleProbeHomeDir = await tempHarness.createTempDir("branch-cli-bundle-mcp-home-");
    bundleProbeWorkspaceDir = await tempHarness.createTempDir("branch-cli-bundle-mcp-workspace-");
    const emptyBundledDir = await tempHarness.createTempDir("branch-cli-bundle-mcp-bundled-");
    setTestEnvValue("BRANCH_BUNDLED_PLUGINS_DIR", emptyBundledDir);
    ({ serverPath: bundleProbeServerPath } = await createBundleProbePlugin(bundleProbeHomeDir));
  });

  afterAll(async () => {
    envSnapshot?.restore();
    await tempHarness.cleanup();
  });
}

export async function writeCliMcpPolicyProbeServer(): Promise<string> {
  const filePath = `${cliBundleMcpHarness.bundleProbeWorkspaceDir}/policy-probe.mjs`;
  const { writeExecutable } = await import("../bundle-mcp-shared.test-harness.js");
  await writeExecutable(
    filePath,
    `#!/usr/bin/env node
let buffer = "";
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
function handle(message) {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "policy-probe", version: "1" },
      },
    });
    return;
  }
  if (message.method === "notifications/initialized") {
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          { name: "read_docs", description: "read", inputSchema: { type: "object" } },
          { name: "delete_docs", description: "delete", inputSchema: { type: "object" } },
          { name: "task_docs", description: "task", inputSchema: { type: "object" }, execution: { taskSupport: "required" } },
          { name: "app_docs", description: "app", inputSchema: { type: "object" }, _meta: { ui: { visibility: ["app"] } } }
        ],
      },
    });
  }
}
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf("\\n");
    if (newline < 0) {
      return;
    }
    const line = buffer.slice(0, newline).replace(/\\r$/, "");
    buffer = buffer.slice(newline + 1);
    if (line.trim()) {
      try {
        handle(JSON.parse(line));
      } catch {}
    }
  }
});
`,
  );
  return filePath;
}

export function cliNativeMcpPolicyContext(config: BranchConfig, sessionId: string) {
  return {
    sessionId,
    sessionKey: `agent:main:${sessionId}`,
    capabilityProfile: resolveConversationCapabilityProfile({
      config,
      sessionKey: `agent:main:${sessionId}`,
      sessionId,
      agentId: "main",
      modelProvider: "openai",
      modelId: "gpt-5.4-codex",
      workspaceDir: cliBundleMcpHarness.bundleProbeWorkspaceDir,
    }),
  };
}

function createEnabledBundleProbeConfig(): BranchConfig {
  return {
    plugins: {
      entries: {
        "bundle-probe": { enabled: true },
      },
    },
  };
}

export async function prepareBundleProbeCliConfig(params?: {
  additionalConfig?: Parameters<typeof prepareCliBundleMcpConfig>[0]["additionalConfig"];
  env?: Parameters<typeof prepareCliBundleMcpConfig>[0]["env"];
}) {
  // Bundle discovery reads HOME / USERPROFILE for per-user plugin roots.
  return await withEnvAsync(createPathResolutionEnv(bundleProbeHomeDir), async () => {
    return await prepareCliBundleMcpConfig({
      enabled: true,
      mode: "claude-config-file",
      backend: {
        command: "node",
        args: ["./fake-claude.mjs"],
      },
      workspaceDir: bundleProbeWorkspaceDir,
      config: createEnabledBundleProbeConfig(),
      additionalConfig: params?.additionalConfig,
      env: params?.env,
    });
  });
}
