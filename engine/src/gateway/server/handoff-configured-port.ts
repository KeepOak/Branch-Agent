// After a desktop hand-over the successor serves on a spare port. Once the predecessor
// exits, also listen on the configured desktop port so tailscale serve, proxies and
// BRANCH_GATEWAY_PORT keep working. Never kill or steal a port another process holds.
import type { Server as HttpServer } from "node:http";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { DESKTOP_GATEWAY_PORT, desktopDataDirectory } from "../../mcp/desktop-gateway.js";

/** Wait as long as the desktop keeps a retiring predecessor (desktop/src/handoff-timeouts.json retireKillAfterMs). */
export const CONFIGURED_PORT_RECLAIM_GIVE_UP_MS = 345_000;
const POLL_MS = 250;
const BIND_RETRIES_AFTER_FREE = 3;

export type ConfiguredPortReclaimResult = "already" | "bound" | "busy" | "stopped";

export type ConfiguredPortLog = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

export type ReclaimConfiguredPortDeps = {
  isPortFree?: (port: number) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  giveUpMs?: number;
  pollMs?: number;
  attach?: (httpServer: HttpServer, port: number) => Promise<NetServer>;
};

function parsePort(value: unknown): number | undefined {
  const raw =
    typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : undefined;
}

/**
 * The loopback port the desktop config (or BRANCH_GATEWAY_PREFERRED_PORT) wants the engine on.
 * Undefined when this process is not a desktop-launched engine.
 */
export function resolveConfiguredDesktopGatewayPort(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const preferred = parsePort(env.BRANCH_GATEWAY_PREFERRED_PORT);
  if (preferred !== undefined) {
    return preferred;
  }
  // A promoted standby still has this set; a normal start must not probe the owner's desktop.json.
  if (env.BRANCH_GATEWAY_STANDBY !== "1") {
    return undefined;
  }
  const dataDir = desktopDataDirectory(env);
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "desktop.json"), "utf8")) as {
      gatewayPort?: unknown;
    };
    return parsePort(raw.gatewayPort) ?? DESKTOP_GATEWAY_PORT;
  } catch (error) {
    // No desktop.json: same default as a file that names no port. Keep other
    // read/parse failures from inventing a reclaim target.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DESKTOP_GATEWAY_PORT;
    }
    return undefined;
  }
}

/** Resolves true when nothing on 127.0.0.1 accepts this port. Never kills a listener. */
export function isLoopbackPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * Accepts TCP on `port` and hands each socket to the already-serving gateway HTTP server,
 * so /readyz and WebSocket on the configured port are the same engine.
 */
export async function attachGatewayPortAlias(
  httpServer: HttpServer,
  port: number,
  host = "127.0.0.1",
): Promise<NetServer> {
  const extra = createNetServer((socket) => {
    httpServer.emit("connection", socket);
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      extra.off("listening", onListening);
      extra.close();
      reject(error);
    };
    const onListening = () => {
      extra.off("error", onError);
      resolve();
    };
    extra.once("error", onError);
    extra.once("listening", onListening);
    extra.listen(port, host);
  });
  const stop = () => {
    extra.close();
  };
  httpServer.once("close", stop);
  return extra;
}

async function bindAfterFree(
  httpServer: HttpServer,
  port: number,
  deps: Required<Pick<ReclaimConfiguredPortDeps, "isPortFree" | "sleep" | "attach">>,
): Promise<boolean> {
  for (let attempt = 0; attempt < BIND_RETRIES_AFTER_FREE; attempt++) {
    if (!(await deps.isPortFree(port))) {
      return false;
    }
    try {
      await deps.attach(httpServer, port);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" || attempt === BIND_RETRIES_AFTER_FREE - 1) {
        return false;
      }
      await deps.sleep(POLL_MS);
    }
  }
  return false;
}

/**
 * Once `configuredPort` is free, also listen there. If another process holds it past the
 * predecessor's retire window, log that and keep serving on `currentPort`.
 */
export async function reclaimConfiguredGatewayPort(params: {
  httpServer: HttpServer;
  currentPort: number;
  configuredPort: number;
  log: ConfiguredPortLog;
  signal?: AbortSignal;
  deps?: ReclaimConfiguredPortDeps;
}): Promise<ConfiguredPortReclaimResult> {
  const log = params.log;
  const configuredPort = params.configuredPort;
  if (configuredPort === params.currentPort) {
    return "already";
  }
  const isPortFree = params.deps?.isPortFree ?? isLoopbackPortFree;
  const sleep =
    params.deps?.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const now = params.deps?.now ?? Date.now;
  const giveUpMs = params.deps?.giveUpMs ?? CONFIGURED_PORT_RECLAIM_GIVE_UP_MS;
  const pollMs = params.deps?.pollMs ?? POLL_MS;
  const attach = params.deps?.attach ?? attachGatewayPortAlias;
  const deadline = now() + giveUpMs;

  while (!params.signal?.aborted) {
    if (await bindAfterFree(params.httpServer, configuredPort, { isPortFree, sleep, attach })) {
      log.info(
        `gateway: also listening on the configured port ${configuredPort} after the previous engine exited`,
      );
      return "bound";
    }
    if (params.signal?.aborted) {
      break;
    }
    if (now() >= deadline) {
      log.warn(
        `gateway: configured port ${configuredPort} is held by another process; keeping the current port ${params.currentPort}`,
      );
      return "busy";
    }
    await sleep(pollMs);
  }
  return "stopped";
}

/** Fire-and-forget watch used once the successor is serving. Closing the HTTP server stops it. */
export function scheduleConfiguredPortReclaim(params: {
  httpServer: HttpServer;
  currentPort: number;
  env?: NodeJS.ProcessEnv;
  configuredPort?: number;
  log: ConfiguredPortLog;
  deps?: ReclaimConfiguredPortDeps;
}): { stop: () => void; done: Promise<ConfiguredPortReclaimResult> } {
  const configuredPort =
    params.configuredPort ?? resolveConfiguredDesktopGatewayPort(params.env ?? process.env);
  if (configuredPort === undefined || configuredPort === params.currentPort) {
    return { stop() {}, done: Promise.resolve("already") };
  }
  const ac = new AbortController();
  const onClose = () => ac.abort();
  params.httpServer.once("close", onClose);
  const done = reclaimConfiguredGatewayPort({
    httpServer: params.httpServer,
    currentPort: params.currentPort,
    configuredPort,
    log: params.log,
    signal: ac.signal,
    deps: params.deps,
  }).finally(() => {
    params.httpServer.off("close", onClose);
  });
  return {
    stop: () => ac.abort(),
    done,
  };
}
