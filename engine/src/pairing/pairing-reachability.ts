import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import os from "node:os";
import { WebSocket, WebSocketServer } from "ws";
import { isRfc1918Ipv4Address } from "@branch/net-policy/ip";
import { resolveAdvertisedLanHostCore } from "../infra/advertised-lan-host.js";
import { safeNetworkInterfaces } from "../infra/network-interfaces.js";
import {
  createPairingRelaySession,
  startPairingRelayHost,
} from "./pairing-relay.js";

export const PAIRING_UNREACHABLE_ERROR =
  "This computer has no network the phone can reach yet. Connect it to Wi-Fi, or set a pairing relay.";

export type PairingReachability = {
  url: string;
  source: "pairing.relay" | "pairing.lan-fallback";
  relayKey?: string;
  close: () => Promise<void>;
};

const live = new Map<string, PairingReachability>();

function pipeSockets(left: WebSocket, right: WebSocket): void {
  const send = (from: WebSocket, to: WebSocket) => {
    from.on("message", (data, isBinary) => {
      if (to.readyState === WebSocket.OPEN) {
        to.send(data, { binary: isBinary });
      }
    });
    from.on("close", () => {
      if (to.readyState === WebSocket.OPEN || to.readyState === WebSocket.CONNECTING) {
        to.close();
      }
    });
    from.on("error", () => {
      if (to.readyState === WebSocket.OPEN || to.readyState === WebSocket.CONNECTING) {
        to.close();
      }
    });
  };
  send(left, right);
  send(right, left);
}

async function listenLanPairingProxy(localGatewayUrl: string): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (client, req) => {
    const remote = req.socket.remoteAddress?.trim() || "0.0.0.0";
    const local = new WebSocket(localGatewayUrl, {
      headers: { "x-branch-pairing-remote": remote },
    });
    const start = () => pipeSockets(client, local);
    if (local.readyState === WebSocket.OPEN) {
      start();
    } else {
      local.once("open", start);
    }
    local.once("error", () => client.close());
  });
  httpServer.listen(0, "0.0.0.0");
  await once(httpServer, "listening");
  const address = httpServer.address() as AddressInfo;
  return {
    port: address.port,
    close: async () => {
      for (const socket of wss.clients) {
        socket.close();
      }
      wss.close();
      httpServer.close();
      await once(httpServer, "close").catch(() => undefined);
    },
  };
}

export function resolveConfiguredPairingRelayUrl(params: {
  configRelayUrl?: unknown;
  env?: NodeJS.ProcessEnv;
}): string | undefined {
  const fromConfig =
    typeof params.configRelayUrl === "string" && params.configRelayUrl.trim()
      ? params.configRelayUrl.trim()
      : undefined;
  const fromEnv = params.env?.BRANCH_PAIRING_RELAY_URL?.trim();
  return fromConfig || fromEnv || undefined;
}

type PairingLanCommandRunner = (
  argv: string[],
  opts: { timeoutMs: number; maxOutputBytes?: number },
) => Promise<{ code: number | null; stdout: string; stderr?: string }>;

export async function openPairingReachability(params: {
  localGatewayUrl: string;
  relayUrl?: string;
  networkInterfaces?: () => ReturnType<typeof os.networkInterfaces>;
  runCommandWithTimeout?: PairingLanCommandRunner;
}): Promise<PairingReachability | { error: string }> {
  if (params.relayUrl?.trim()) {
    try {
      const session = await createPairingRelaySession({ relayUrl: params.relayUrl.trim() });
      const host = await startPairingRelayHost({
        relayWsUrl: session.wsUrl,
        localGatewayUrl: params.localGatewayUrl,
        hostToken: session.hostToken,
        key: session.key,
      });
      return {
        url: session.peerUrl,
        source: "pairing.relay",
        relayKey: session.key.toString("base64url"),
        close: host.close,
      };
    } catch {
      // Fall through to a same-network listener so Pair a phone still gets a code.
    }
  }

  const lanHost = await resolveAdvertisedLanHostCore({
    networkInterfaces: params.networkInterfaces,
    runCommandWithTimeout: params.runCommandWithTimeout,
  });
  const snapshot = safeNetworkInterfaces(params.networkInterfaces ?? os.networkInterfaces);
  const fallbackLan =
    lanHost ??
    Object.values(snapshot ?? {})
      .flat()
      .find((entry) => entry && !entry.internal && isRfc1918Ipv4Address(entry.address))?.address;
  if (!fallbackLan) {
    return { error: PAIRING_UNREACHABLE_ERROR };
  }
  const proxy = await listenLanPairingProxy(params.localGatewayUrl);
  return {
    url: `ws://${fallbackLan}:${proxy.port}`,
    source: "pairing.lan-fallback",
    close: proxy.close,
  };
}

export async function rememberPairingReachability(
  setupId: string,
  reachability: PairingReachability,
  expiresAtMs: number,
): Promise<void> {
  await live.get(setupId)?.close().catch(() => undefined);
  const timer = setTimeout(() => {
    void reachability.close();
    live.delete(setupId);
  }, Math.max(0, expiresAtMs - Date.now()));
  timer.unref?.();
  live.set(setupId, {
    ...reachability,
    close: async () => {
      clearTimeout(timer);
      await reachability.close();
      live.delete(setupId);
    },
  });
}

export async function closePairingReachability(setupId: string): Promise<void> {
  const current = live.get(setupId);
  if (current) {
    await current.close();
  }
}
