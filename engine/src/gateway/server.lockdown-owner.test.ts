// Real connections through connect-session: the window (shared token, or its stored device token) is the owner
// and can switch Lockdown off; the switch is still refused for writes otherwise.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
} from "../../packages/gateway-protocol/src/client-info.js";
import { resetLogger } from "../logging/logger.js";
import { clearPluginMetadataLifecycleCaches } from "../plugins/plugin-metadata-lifecycle.js";
import { createBranchTestState } from "../test-utils/branch-test-state.js";
import { getFreePort } from "../test-utils/ports.js";
import { startGatewayServerCore as startGatewayServer } from "./server-start.js";
import { connectGatewayClient, disconnectGatewayClient } from "./test-helpers.e2e.js";

const TOKEN = "synthetic-lockdown-owner-token";

describe("Lockdown owner over real gateway connections", () => {
  let state: Awaited<ReturnType<typeof createBranchTestState>>;
  let server: Awaited<ReturnType<typeof startGatewayServer>> | undefined;
  const clients: Awaited<ReturnType<typeof connectGatewayClient>>[] = [];
  let url = "";
  let origin = "";

  beforeEach(async () => {
    state = await createBranchTestState({
      label: "gateway-lockdown-owner",
      env: {
        BRANCH_GATEWAY_TOKEN: undefined,
        BRANCH_GATEWAY_PASSWORD: undefined,
        BRANCH_SKIP_BROWSER_CONTROL_SERVER: "1",
        BRANCH_SKIP_CANVAS_HOST: "1",
        BRANCH_SKIP_CHANNELS: "1",
        BRANCH_SKIP_CRON: "1",
        BRANCH_SKIP_GMAIL_WATCHER: "1",
        BRANCH_SKIP_PROVIDERS: "1",
        BRANCH_DISABLE_BUNDLED_PLUGINS: "1",
      },
    });
    const port = await getFreePort();
    url = `ws://127.0.0.1:${port}`;
    origin = `http://127.0.0.1:${port}`;
    await state.writeConfig({
      agents: { defaults: { workspace: state.workspaceDir } },
      logging: { level: "silent", consoleLevel: "silent" },
      gateway: {
        mode: "local",
        auth: { mode: "token", token: TOKEN },
        controlUi: { enabled: false, allowedOrigins: [origin] },
      },
      security: { lockdown: true },
    });
    server = await startGatewayServer(port);
    await server.startupSettled;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) await disconnectGatewayClient(client);
    await server?.close();
    server = undefined;
    await state.cleanup();
    resetLogger();
    clearPluginMetadataLifecycleCaches();
  });

  const switchOff = async (client: Awaited<ReturnType<typeof connectGatewayClient>>) => {
    const { hash } = await client.request<{ hash: string }>("config.get", {});
    return await client.request("config.patch", {
      raw: '{"security":{"lockdown":false}}',
      baseHash: hash,
    });
  };

  const windowClient = async (auth: { token?: string; deviceToken?: string }) => {
    let deviceToken: string | undefined;
    const client = await connectGatewayClient({
      url,
      origin,
      ...auth,
      clientName: GATEWAY_CLIENT_NAMES.CONTROL_UI,
      mode: GATEWAY_CLIENT_MODES.UI,
      scopes: ["operator.admin"],
      onHelloOk: (hello) => {
        deviceToken = hello.auth?.deviceToken;
      },
    });
    clients.push(client);
    return { client, deviceToken };
  };

  it("lets the window on the gateway token switch Lockdown off, and refuses other writes first", async () => {
    const { client } = await windowClient({ token: TOKEN });
    await expect(client.request("config.patch", { raw: '{"tools":{}}' })).rejects.toThrow(
      "Lockdown is on: this action is unavailable.",
    );
    await expect(switchOff(client)).resolves.toBeDefined();
  });

  it("lets the window reconnecting on its stored device token switch Lockdown off", async () => {
    const first = await windowClient({ token: TOKEN });
    expect(first.deviceToken).toBeTypeOf("string");
    await disconnectGatewayClient(clients.pop()!);
    const { client } = await windowClient({ deviceToken: first.deviceToken });
    await expect(switchOff(client)).resolves.toBeDefined();
  });
});
