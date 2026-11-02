import type { SendHandle } from "node:child_process";
import { createDeferredCore } from "../../shared/deferred.js";
import type { SpawnInitiation } from "../spawn-initiation.js";
import { BrokerChild } from "./child.js";
import type { BrokerExecaResult } from "./execa-protocol.js";
import { SpawnBrokerError, type BrokerRequest } from "./protocol.js";
import type { BrokerResourceRequest } from "./resource-protocol.js";

export const SPAWN_BROKER_MAX_REQUESTS = 256;

export type SpawnBrokerRequest = {
  child: BrokerChild;
  initiateSpawn?: SpawnInitiation;
  nativeInitiated?: ReturnType<typeof createDeferredCore<void>>;
  pid?: number;
  detached: boolean;
  result?: ReturnType<typeof createDeferredCore<BrokerExecaResult>>;
  childClosed: boolean;
  resultSettled: boolean;
};

export type SpawnBrokerAdmitHost = {
  closing: boolean;
  available: boolean;
  parked: boolean;
  parking: boolean;
  lazyStart: boolean;
  process: { pid?: number } | undefined;
  maxConcurrent: number;
  requests: Map<number, SpawnBrokerRequest>;
  resourceClaims?: { size: number };
  ready(): Promise<void>;
  refreshNativeReference(): void;
  retire(id: number, request: SpawnBrokerRequest): void;
  transmit(
    message: BrokerRequest | Exclude<BrokerResourceRequest, { type: "resource-attach" }>,
    handle?: SendHandle,
    initiateSpawn?: SpawnInitiation,
  ): Promise<void>;
};

export function admitSpawnBrokerRequest(
  host: SpawnBrokerAdmitHost,
  message: Extract<BrokerRequest, { type: "spawn" | "prepare-spawn" | "spawn-execa" }>,
  initiateSpawn?: SpawnInitiation,
): SpawnBrokerRequest {
  const child = new BrokerChild(message.id, message.argv, (value, handle, initiate) =>
    host.transmit(value, handle, initiate),
  );
  const result =
    message.type === "spawn-execa" ? createDeferredCore<BrokerExecaResult>() : undefined;
  if (result) {
    void result.promise.catch(() => {});
  }
  const request: SpawnBrokerRequest = {
    child,
    initiateSpawn,
    result,
    childClosed: false,
    resultSettled: !result,
    detached:
      message.options.detached === true ||
      (message.type === "spawn-execa" && message.options.killDescendants === true),
  };
  const fail = (error: Error) => {
    result?.reject(error);
    child.fail(error);
  };
  if (host.closing) {
    child.markNotStarted();
    queueMicrotask(() => fail(new SpawnBrokerError("Spawn broker is unavailable")));
    return request;
  }
  if (
    host.requests.size + (host.resourceClaims?.size ?? 0) >= SPAWN_BROKER_MAX_REQUESTS ||
    host.requests.size >= host.maxConcurrent
  ) {
    child.markNotStarted();
    queueMicrotask(() => fail(new SpawnBrokerError("Spawn broker request capacity exceeded")));
    return request;
  }
  if (!host.available) {
    if (host.parked || host.parking || (host.lazyStart && !host.process)) {
      enqueueUntilReady(host, message, request, child, fail);
      return request;
    }
    child.markNotStarted();
    queueMicrotask(() => fail(new SpawnBrokerError("Spawn broker is unavailable")));
    return request;
  }
  enqueueReady(host, message, request, child, fail);
  return request;
}

function enqueueUntilReady(
  host: SpawnBrokerAdmitHost,
  message: Extract<BrokerRequest, { type: "spawn" | "prepare-spawn" | "spawn-execa" }>,
  request: SpawnBrokerRequest,
  child: BrokerChild,
  fail: (error: Error) => void,
): void {
  host.requests.set(message.id, request);
  host.refreshNativeReference();
  void child.waitForClose().then(() => {
    request.childClosed = true;
    host.retire(message.id, request);
  });
  let transmitted = false;
  void host
    .ready()
    .then(() => {
      if (host.requests.get(message.id) !== request || !host.available) {
        throw new SpawnBrokerError("Spawn broker is unavailable");
      }
      transmitted = true;
      return host.transmit(message);
    })
    .catch((error: unknown) => {
      if (!request.nativeInitiated) {
        // A failed wake-up never sent the request, so callers may use their native fallback.
        if (!transmitted || message.type === "prepare-spawn") {
          child.markNotStarted();
        }
        host.requests.delete(message.id);
        host.refreshNativeReference();
      }
      fail(new SpawnBrokerError("Spawn broker request delivery failed", { cause: error }));
    });
}

function enqueueReady(
  host: SpawnBrokerAdmitHost,
  message: Extract<BrokerRequest, { type: "spawn" | "prepare-spawn" | "spawn-execa" }>,
  request: SpawnBrokerRequest,
  child: BrokerChild,
  fail: (error: Error) => void,
): void {
  host.requests.set(message.id, request);
  host.refreshNativeReference();
  void child.waitForClose().then(() => {
    request.childClosed = true;
    host.retire(message.id, request);
  });
  void host.transmit(message).catch((error: unknown) => {
    if (!request.nativeInitiated) {
      if (message.type === "prepare-spawn") {
        child.markNotStarted();
      }
      host.requests.delete(message.id);
      host.refreshNativeReference();
    }
    fail(new SpawnBrokerError("Spawn broker request delivery failed", { cause: error }));
  });
}
