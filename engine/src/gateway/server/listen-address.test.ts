// Starts the real Gateway listeners with the default (loopback) bind and checks the address each
// socket actually bound, not just the config value.
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Server as NetServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginRegistry } from "../../plugins/registry-types.js";
import { resolveGatewayBindHost, resolveGatewayListenHosts } from "../net.js";
import { createPortalIngress } from "../portals/portal-ingress.js";
import { attachGatewayPortAlias } from "./handoff-configured-port.js";
import { listenGatewayHttpServer } from "./http-listen.js";
import { resolveLegacyListenerHost, startPluginLegacyListeners } from "./plugin-legacy-listeners.js";

const LOOPBACK = new Set(["127.0.0.1", "::1"]);
const servers: Array<Server | NetServer> = [];
const stops: Array<() => void> = [];

function boundAddress(server: Server | NetServer): string {
  const address = server.address() as AddressInfo | null;
  expect(address).not.toBeNull();
  return address!.address;
}

async function untilListening(server: Server): Promise<void> {
  if (!server.listening) {
    await once(server, "listening");
  }
}

afterEach(async () => {
  for (const stop of stops.splice(0)) {
    stop();
  }
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => (server.listening ? server.close(() => resolve()) : resolve())),
    ),
  );
});

describe("gateway listeners honor the loopback bind", () => {
  it("defaults to loopback when gateway.bind is unset", async () => {
    expect(await resolveGatewayBindHost(undefined)).toBe("127.0.0.1");
    expect(await resolveGatewayBindHost("loopback")).toBe("127.0.0.1");
  });

  it("binds every main gateway listener to loopback", async () => {
    const bindHost = await resolveGatewayBindHost("loopback");
    for (const host of await resolveGatewayListenHosts(bindHost)) {
      const server = createServer();
      servers.push(server);
      await listenGatewayHttpServer({ httpServer: server, bindHost: host, port: 0, retryEaddrinuse: false });
      expect(LOOPBACK.has(boundAddress(server))).toBe(true);
    }
  });

  it("binds the configured-port alias to loopback", async () => {
    const gateway = createServer();
    servers.push(gateway);
    await listenGatewayHttpServer({ httpServer: gateway, bindHost: "127.0.0.1", port: 0, retryEaddrinuse: false });
    const alias = await attachGatewayPortAlias(gateway, 0);
    servers.push(alias);
    expect(boundAddress(alias)).toBe("127.0.0.1");
  });

  it("binds the portal ingress to loopback", async () => {
    const httpServers: Server[] = [];
    const ingress = createPortalIngress({
      port: 0,
      httpServers,
      request: (_req, res) => res.end(),
      upgrade: (_req, socket) => socket.destroy(),
    });
    await ingress.start();
    stops.push(() => void ingress.close());
    expect(httpServers).toHaveLength(1);
    expect(boundAddress(httpServers[0]!)).toBe("127.0.0.1");
  });

  it.each([
    ["no host", undefined],
    ["a wildcard host", "0.0.0.0"],
    ["an IPv6 wildcard host", "::"],
  ])("binds a plugin legacy listener with %s to loopback", async (_label, host) => {
    const gatewayServer = createServer();
    servers.push(gatewayServer);
    const httpServers: Server[] = [];
    const registry = {
      httpRoutes: [{ path: "/legacy", legacyListeners: [{ port: 0, ...(host ? { host } : {}) }] }],
    } as unknown as PluginRegistry;
    stops.push(
      startPluginLegacyListeners({
        gatewayServer,
        httpServers,
        bindHost: "127.0.0.1",
        getRegistry: () => registry,
        warn: () => {},
      }),
    );
    expect(httpServers).toHaveLength(1);
    servers.push(httpServers[0]!);
    await untilListening(httpServers[0]!);
    expect(boundAddress(httpServers[0]!)).toBe("127.0.0.1");
  });
});

describe("resolveLegacyListenerHost", () => {
  it("never widens a loopback gateway", () => {
    expect(resolveLegacyListenerHost(undefined, "127.0.0.1")).toBe("127.0.0.1");
    expect(resolveLegacyListenerHost("0.0.0.0", "127.0.0.1")).toBe("127.0.0.1");
    expect(resolveLegacyListenerHost("192.0.2.10", "127.0.0.1")).toBe("127.0.0.1");
  });

  it("uses the gateway host when the endpoint names none", () => {
    expect(resolveLegacyListenerHost(undefined, "192.0.2.10")).toBe("192.0.2.10");
    expect(resolveLegacyListenerHost("192.0.2.20", "192.0.2.10")).toBe("192.0.2.20");
  });
});
