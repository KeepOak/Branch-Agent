import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { listenPairingRelay } from "./pairing-relay.js";
import {
  PAIRING_UNREACHABLE_ERROR,
  openPairingReachability,
  resolveConfiguredPairingRelayUrl,
} from "./pairing-reachability.js";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (opened.length > 0) {
    await opened.pop()?.close();
  }
});

describe("pairing reachability", () => {
  it("reads a relay URL from plugin config or the environment", () => {
    expect(
      resolveConfiguredPairingRelayUrl({
        configRelayUrl: " https://relay.example ",
        env: { BRANCH_PAIRING_RELAY_URL: "https://env.example" },
      }),
    ).toBe("https://relay.example");
    expect(
      resolveConfiguredPairingRelayUrl({
        env: { BRANCH_PAIRING_RELAY_URL: " https://env.example " },
      }),
    ).toBe("https://env.example");
    expect(resolveConfiguredPairingRelayUrl({})).toBeUndefined();
  });

  it("opens an outbound relay session and never mentions loopback", async () => {
    const relay = await listenPairingRelay();
    opened.push(relay);
    const gatewayHttp = createServer();
    const gatewayWss = new WebSocketServer({ server: gatewayHttp });
    gatewayHttp.listen(0, "127.0.0.1");
    await once(gatewayHttp, "listening");
    const gatewayPort = (gatewayHttp.address() as { port: number }).port;
    opened.push({
      close: async () => {
        gatewayWss.close();
        gatewayHttp.close();
        await once(gatewayHttp, "close").catch(() => undefined);
      },
    });
    const reached = await openPairingReachability({
      localGatewayUrl: `ws://127.0.0.1:${gatewayPort}`,
      relayUrl: relay.baseUrl,
    });
    if ("error" in reached) {
      throw new Error(reached.error);
    }
    opened.push(reached);
    expect(reached.source).toBe("pairing.relay");
    expect(reached.url).toContain("/v1/pair/");
    expect(reached.relayKey).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(JSON.stringify(reached)).not.toMatch(/loopback|restart/i);
  });

  it("falls back to a LAN pairing listener when no relay is set", async () => {
    const reached = await openPairingReachability({
      localGatewayUrl: "ws://127.0.0.1:9",
      networkInterfaces: () => ({
        en0: [
          {
            address: "192.168.1.20",
            family: "IPv4",
            internal: false,
            netmask: "255.255.255.0",
            mac: "00:00:00:00:00:00",
            cidr: "192.168.1.20/24",
          },
        ],
      }),
      runCommandWithTimeout: async () => ({ code: 1, stdout: "", stderr: "" }),
    });
    if ("error" in reached) {
      throw new Error(reached.error);
    }
    opened.push(reached);
    expect(reached.source).toBe("pairing.lan-fallback");
    expect(reached.url).toMatch(/^ws:\/\/192\.168\.1\.20:\d+$/u);
  });

  it("says the phone cannot reach this computer, not loopback or restart", async () => {
    const reached = await openPairingReachability({
      localGatewayUrl: "ws://127.0.0.1:9",
      networkInterfaces: () => ({}),
      runCommandWithTimeout: async () => ({ code: 1, stdout: "", stderr: "" }),
    });
    expect(reached).toEqual({ error: PAIRING_UNREACHABLE_ERROR });
    expect(PAIRING_UNREACHABLE_ERROR).not.toMatch(/loopback|restart/i);
  });
});
