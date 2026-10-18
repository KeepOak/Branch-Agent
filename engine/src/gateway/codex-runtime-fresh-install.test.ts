// Fresh-install guard for #1848: an engine started on an empty data folder must
// load the bundled Codex plugin, so the window's Get Codex can ask
// codex.runtime instead of getting "unknown method".
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetConfigRuntimeState } from "../config/runtime-snapshot.js";
import { resetLogger } from "../logging/logger.js";
import { clearPluginMetadataLifecycleCaches } from "../plugins/plugin-metadata-lifecycle.js";
import { createBranchTestState } from "../test-utils/branch-test-state.js";
import { getFreePort } from "../test-utils/ports.js";
import { connectGatewayClient, disconnectGatewayClient } from "./test-helpers.e2e.js";

// A full boot loads every default plugin from source; loaded CI runners need headroom.
const BOOT_BUDGET_MS = 180_000;

afterEach(() => {
  resetLogger();
  vi.unstubAllEnvs();
  resetConfigRuntimeState();
  clearPluginMetadataLifecycleCaches();
});

describe("fresh install codex runtime", () => {
  it(
    "answers codex.runtime on an engine started with an empty data folder",
    { timeout: BOOT_BUDGET_MS * 2 },
    async () => {
      const port = await getFreePort();
      // The "empty" scenario writes no config file: the data folder a new install starts with.
      const state = await createBranchTestState({
        label: "codex-runtime-fresh-install",
        layout: "home",
        scenario: "empty",
        env: {
          BRANCH_GATEWAY_PASSWORD: undefined,
          BRANCH_GATEWAY_TOKEN: undefined,
          BRANCH_SKIP_BROWSER_CONTROL_SERVER: "1",
          BRANCH_SKIP_CANVAS_HOST: "1",
          BRANCH_SKIP_CHANNELS: "1",
          BRANCH_SKIP_CRON: "1",
          BRANCH_SKIP_GMAIL_WATCHER: "1",
          BRANCH_SKIP_PROVIDERS: "1",
          // A minimal test gateway loads no plugins, and VITEST=1 turns every plugin off
          // when the config names none; either hides exactly this bug. The Vitest
          // worker id still marks a test runtime.
          BRANCH_TEST_MINIMAL_GATEWAY: undefined,
          VITEST: undefined,
        },
      });
      const token = "codex-runtime-fresh-install-token";
      state.applyEnv();
      try {
        const { startGatewayServer } = await import("./server.js");
        const server = await startGatewayServer(port, {
          auth: { mode: "token", token },
          bind: "loopback",
          controlUiEnabled: false,
          sidecarStartup: "defer",
        });
        try {
          const client = await connectGatewayClient({
            url: `ws://127.0.0.1:${port}`,
            token,
            // The window's operator scopes, so a missing plugin shows as "unknown method".
            scopes: ["operator.admin"],
          });
          try {
            const status = await client.request<{ state?: unknown }>("codex.runtime", {});
            // Without codex on PATH this is "download"; a source checkout may find the bundled package.
            expect(["ready", "download", "unavailable"]).toContain(status.state);
          } finally {
            await disconnectGatewayClient(client);
          }
        } finally {
          await server.close({ reason: "codex runtime fresh install check complete" });
        }
      } finally {
        await state.cleanup();
      }
    },
  );
});
