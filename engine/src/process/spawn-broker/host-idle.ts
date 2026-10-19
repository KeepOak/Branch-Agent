import type { ChildProcess } from "node:child_process";
import { createDeferredCore, type Deferred } from "../../shared/deferred.js";
import { GRACEFUL_CANCEL_TIMEOUT_MS } from "../supervisor/cancellation-policy.js";
import type { BrokerRequest } from "./protocol.js";
import type { BrokerResourceRequest } from "./resource-protocol.js";

export type SpawnBrokerIdleHost = {
  closing: boolean;
  available: boolean;
  process: ChildProcess | undefined;
  sendMessage:
    | ((
        message: BrokerRequest | Exclude<BrokerResourceRequest, { type: "resource-attach" }>,
      ) => Promise<void>)
    | undefined;
  idleTimeoutMs: number;
  restartTimer: NodeJS.Timeout | undefined;
  resourceClaims?: { hasOpenClaims: boolean };
  requests: { size: number };
  brokerClosed: Promise<void> | undefined;
  idleTimer: NodeJS.Timeout | undefined;
  parking: boolean;
  parked: boolean;
  parkPromise: Promise<void> | undefined;
  start(): void;
  onParked(): void;
};

export function isSpawnBrokerIdle(host: SpawnBrokerIdleHost): boolean {
  return host.requests.size === 0 && !host.resourceClaims?.hasOpenClaims;
}

export function clearSpawnBrokerIdlePark(host: SpawnBrokerIdleHost): void {
  if (host.idleTimer) {
    clearTimeout(host.idleTimer);
    host.idleTimer = undefined;
  }
}

export function scheduleSpawnBrokerIdlePark(host: SpawnBrokerIdleHost): void {
  clearSpawnBrokerIdlePark(host);
  if (
    host.closing ||
    host.parking ||
    host.parked ||
    host.idleTimeoutMs <= 0 ||
    !host.available ||
    !isSpawnBrokerIdle(host)
  ) {
    return;
  }
  host.idleTimer = setTimeout(() => {
    host.idleTimer = undefined;
    void parkSpawnBrokerIfIdle(host);
  }, host.idleTimeoutMs);
  host.idleTimer.unref();
}

export function ensureSpawnBrokerStarted(host: SpawnBrokerIdleHost): void {
  if (host.closing || host.parking || host.process || host.restartTimer) {
    return;
  }
  host.parked = false;
  host.start();
}

export async function parkSpawnBrokerIfIdle(host: SpawnBrokerIdleHost): Promise<void> {
  if (host.closing || host.parking || !host.available || !host.process || !isSpawnBrokerIdle(host)) {
    return;
  }
  host.parking = true;
  host.parked = true;
  const child = host.process;
  const send = host.sendMessage;
  host.available = false;
  host.sendMessage = undefined;
  const parked = (host.parkPromise = (async () => {
    try {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      const exited =
        host.brokerClosed ??
        new Promise<void>((resolve) => {
          child.once("exit", () => resolve());
        });
      const timer = setTimeout(() => child.kill("SIGKILL"), GRACEFUL_CANCEL_TIMEOUT_MS + 2000);
      try {
        if (host.resourceClaims && send) {
          void send({ type: "shutdown" }).catch(() => child.kill("SIGTERM"));
        } else if (child.connected) {
          child.disconnect();
        } else {
          child.kill("SIGTERM");
        }
        await exited;
      } finally {
        clearTimeout(timer);
      }
    } finally {
      host.onParked();
    }
  })());
  await parked;
}

export function refreshSpawnBrokerIdle(host: SpawnBrokerIdleHost): void {
  if (host.closing || !isSpawnBrokerIdle(host)) {
    clearSpawnBrokerIdlePark(host);
  } else {
    scheduleSpawnBrokerIdlePark(host);
  }
}

export function replaceParkedReadiness(): Deferred {
  const readiness = createDeferredCore();
  void readiness.promise.catch(() => {});
  return readiness;
}
