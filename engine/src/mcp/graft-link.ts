// The joined Branch's own link to its host Branch (Branch-to-Branch). A background service of the joined Branch's
// gateway, started with it when a saved host exists (state/graft/hosts.json, written by `branch graft join`): one
// long-lived gateway client per host, as the node host keeps its link. The client reconnects by itself with
// upstream's jittered backoff; on every hello-ok the link says hello as this Branch and its Trunks, and again every
// minute so the host shows them online. When the host disconnects this Branch (Settings › Grafts removes its
// pairing), the link stops and forgets the host; a new `branch graft join` brings it back. When the host gets a new
// LAN address, the link finds it again by its mDNS name and saves the new address (graft-host-lookup.ts, #2100).
import { readConnectErrorDetailCode } from "../../packages/gateway-protocol/src/connect-error-details.js";
import { listAgentEntries } from "../agents/agent-scope.js";
import {
  findGraftHostAddresses,
  graftLinkPort,
  HOST_LOOKUP_INTERVAL_MS,
  learnGraftHostName,
  movedGraftUrl,
} from "./graft-host-lookup.js";
import {
  GRAFT_DEVICE_SCOPES,
  graftBranchIdentity,
  graftLinkKey,
  graftTrunkIdentity,
  readGraftLinks,
  replaceGraftLink,
  type GraftLink,
} from "./graft-join.js";
import { GraftLinkResults } from "./graft-link-results.js";
import { HELLO_INTERVAL_MS } from "./outside-presence.js";

/** Pre-hello failures move the link to the next saved address, at most once per this interval. */
export const ADDRESS_SWITCH_INTERVAL_MS = 60_000;
/**
 * Off until verified. The link sends its stored operator device token to whatever answers at an address, so a
 * fallback address (a reassigned LAN IP, or another Branch on the same port) would receive that token. Only the
 * primary address is used while this is false.
 */
export const FALLBACK_ADDRESSES_VERIFIED = false;

export type LinkClient = {
  start: () => void;
  stop: () => void;
  request: (method: string, params: unknown) => Promise<unknown>;
};
export type LinkHandlers = {
  /** A connection is up (first connect and every reconnect). */
  onHello: () => void;
  /** The connection dropped; the client reconnects with backoff. */
  onClose: () => void;
  /** The host refused this device (pairing removed or token revoked): reconnecting cannot help. */
  onRefused: (reason: string) => void;
  /** A connection attempt failed before the host said hello (unreachable address, refused socket, timeout). */
  onConnectError?: (error: Error) => void;
};
export type LinkState = "connecting" | "connected" | "disconnected" | "stopped";
type GraftWorkJob = { id: string; trunkId: string; text: string; sourceAgentId: string };

/** A host refusal that only the owner can undo (a new setup code), as opposed to a dropped connection. */
export function isHostRefusal(error: unknown): boolean {
  const code = readConnectErrorDetailCode((error as { details?: unknown } | undefined)?.details);
  if (code) {
    return code === "PAIRING_REQUIRED" || code.startsWith("AUTH_");
  }
  return /pairing required|unauthorized|device token|was disconnected/i.test(
    (error as Error)?.message ?? "",
  );
}

/** Longest pause after the host says it is briefly unavailable (restarting or suspending). */
export const HOST_BUSY_MAX_BACKOFF_MS = 30_000;

/**
 * The host answered but can't take work right now (its gateway is restarting or suspending): a retryable
 * UNAVAILABLE. Retrying on the normal 2-second timer only floods both logs (#1922), so the link waits instead.
 */
export function hostBusyRetryAfterMs(error: unknown): number | undefined {
  const e = error as { code?: unknown; retryable?: unknown; retryAfterMs?: unknown } | undefined;
  if (!e || e.code !== "UNAVAILABLE" || e.retryable !== true) {
    return undefined;
  }
  return typeof e.retryAfterMs === "number" && Number.isFinite(e.retryAfterMs) && e.retryAfterMs > 0
    ? e.retryAfterMs
    : 1_000;
}

/** Pre-hello failures repeat every backoff step; one line per window says why the host is unreachable. */
export const CONNECT_FAILURE_LOG_INTERVAL_MS = 5 * 60_000;

export class GraftLinkRunner {
  state: LinkState = "connecting";
  private lastConnectFailureLogAt = Number.NEGATIVE_INFINITY;
  private lastAddressSwitchAt = Number.NEGATIVE_INFINITY;
  private addressIndex = 0;
  private client: LinkClient | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private workTimer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  /** While the host is restarting, no work polls or hellos before this time; doubles per refusal up to the max. */
  private busyUntil = 0;
  private busyBackoffMs = 0;
  /** The saved link as this runner knows it: its learned host name and its address after the host moved. */
  private link: GraftLink;
  private learnTried = false;
  private looking = false;
  private lastLookupAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly deps: {
      link: GraftLink;
      trunks: () => Promise<{ id: string; name?: string; avatar?: string }[]>;
      createClient: (handlers: LinkHandlers, url: string) => LinkClient;
      /** Forget the saved host (it disconnected this Branch). */
      forget: (link: GraftLink) => void;
      log: (line: string) => void;
      helloIntervalMs?: number;
      handleWork?: (job: GraftWorkJob) => Promise<{ reply?: string; error?: string }>;
      workPollMs?: number;
      /** The host's current addresses by its mDNS name (graft-host-lookup.ts). */
      findHost?: (hostName: string, port: number) => Promise<string[]>;
      /** The host's mDNS name, learned while connected, for a link saved without one. */
      learnHostName?: (url: string) => Promise<string | undefined>;
      /** Save the link (a learned name or the host's new address) in place of the row saved at fromUrl. */
      save?: (fromUrl: string, link: GraftLink) => void;
    },
  ) {
    this.link = deps.link;
  }

  /** The link's current address (the host's new one once it moved). */
  get url(): string {
    return this.link.url;
  }

  /** The link's saved addresses, starting with its own `url`, without repeats. */
  addresses(): string[] {
    return [...new Set([this.link.url, ...(this.link.urls ?? [])])];
  }

  private activeUrl(): string {
    const addresses = this.addresses();
    return addresses[this.addressIndex % addresses.length] ?? this.link.url;
  }

  private readonly handlers: LinkHandlers = {
    onHello: () => {
      this.state = "connected";
      this.hostReady();
      this.deps.log(`graft link: connected to ${this.activeUrl()}`);
      void this.sayHello();
      void this.learnHostName();
      this.clearTimer();
      this.timer = setInterval(
        () => void this.sayHello(),
        this.deps.helloIntervalMs ?? HELLO_INTERVAL_MS,
      );
      this.timer.unref?.();
      if (this.deps.handleWork) {
        void this.pollWork();
        this.workTimer = setInterval(() => void this.pollWork(), this.deps.workPollMs ?? 2_000);
        this.workTimer.unref?.();
      }
    },
    onClose: () => {
      this.clearTimer();
      if (this.state === "connected") {
        this.state = "connecting";
        this.deps.log(`graft link: lost ${this.activeUrl()}; reconnecting`);
      }
    },
    onRefused: (reason) => this.disconnected(reason),
    onConnectError: (error) => this.connectFailed(error),
  };

  start(): void {
    this.client = this.deps.createClient(this.handlers, this.activeUrl());
    this.client.start();
  }

  stop(): void {
    if (this.state !== "disconnected") {
      this.state = "stopped";
    }
    this.clearTimer();
    this.client?.stop();
  }

  /** This Branch, then each of its Trunks (the host binds the Trunks to the Branch row). */
  async sayHello(): Promise<void> {
    const client = this.client;
    if (!client || this.state !== "connected" || this.hostBusy()) {
      return;
    }
    try {
      const branch = graftBranchIdentity(this.link.name);
      await client.request("contacts.outside.hello", { agent: branch });
      for (const trunk of await this.deps.trunks()) {
        await client.request("contacts.outside.hello", {
          agent: graftTrunkIdentity(branch, trunk),
        });
      }
    } catch (error) {
      if (isHostRefusal(error)) {
        this.disconnected((error as Error).message);
      } else if (!this.markHostBusy(error)) {
        this.deps.log(`graft link: hello failed: ${(error as Error)?.message ?? error}`);
      }
    }
  }

  private disconnected(reason: string): void {
    if (this.state === "disconnected" || this.state === "stopped") {
      return;
    }
    this.state = "disconnected";
    this.deps.log(`graft link: ${this.link.url} disconnected this Branch (${reason})`);
    this.clearTimer();
    this.client?.stop();
    this.deps.forget(this.link);
  }

  private update(next: GraftLink): void {
    const fromUrl = this.link.url;
    this.link = next;
    this.deps.save?.(fromUrl, next);
  }

  /** A link saved without its host's name learns it once connected, so it can find the host after a move. */
  private async learnHostName(): Promise<void> {
    if (this.link.hostName || this.learnTried || !this.deps.learnHostName) {
      return;
    }
    this.learnTried = true;
    const hostName = await this.deps.learnHostName(this.link.url).catch(() => undefined);
    if (hostName && !this.link.hostName && this.state === "connected") {
      this.update({ ...this.link, hostName });
      this.deps.log(
        `graft link: ${this.link.url} is ${hostName}; the link finds it by that name if its address changes`,
      );
    }
  }

  /** The saved address stopped answering: look the host's name up and move the link to where the host is now. */
  private async findMovedHost(now: number): Promise<void> {
    const hostName = this.link.hostName;
    if (
      !hostName ||
      !this.deps.findHost ||
      this.looking ||
      now - this.lastLookupAt < HOST_LOOKUP_INTERVAL_MS
    ) {
      return;
    }
    this.looking = true;
    this.lastLookupAt = now;
    const from = this.link;
    try {
      const addresses = await this.deps.findHost(hostName, graftLinkPort(from.url)).catch(() => []);
      const next = movedGraftUrl(from.url, addresses);
      if (!next || this.state !== "connecting" || this.link !== from) {
        return;
      }
      this.update({ ...from, url: next, joinedUrl: graftLinkKey(from) });
      this.addressIndex = 0;
      this.lastConnectFailureLogAt = Number.NEGATIVE_INFINITY;
      this.client?.stop();
      this.deps.log(`graft link: ${hostName} moved to ${next}; saved the new address`);
      this.client = this.deps.createClient(this.handlers, next);
      this.client.start();
    } finally {
      this.looking = false;
    }
  }

  private connectFailed(error: Error): void {
    if (this.state === "connected" || this.state === "disconnected" || this.state === "stopped") {
      return;
    }
    const now = Date.now();
    if (now - this.lastConnectFailureLogAt >= CONNECT_FAILURE_LOG_INTERVAL_MS) {
      this.lastConnectFailureLogAt = now;
      const reason = error.message;
      this.deps.log(
        this.link.hostName && this.deps.findHost
          ? `graft link: can't reach ${this.activeUrl()} (${reason}); retrying and looking for ${this.link.hostName} on the network.`
          : `graft link: can't reach ${this.activeUrl()} (${reason}); retrying. If this host's address changed, rejoin it with a new setup code.`,
      );
    }
    this.switchAddress(now);
    void this.findMovedHost(now);
  }

  /** Moves to the next saved address; the host's other addresses are how a link recovers when one changes. */
  private switchAddress(now: number): void {
    if (!FALLBACK_ADDRESSES_VERIFIED || this.addresses().length < 2) {
      return;
    }
    if (now - this.lastAddressSwitchAt < ADDRESS_SWITCH_INTERVAL_MS) {
      return;
    }
    this.lastAddressSwitchAt = now;
    this.addressIndex += 1;
    this.client?.stop();
    this.client = this.deps.createClient(this.handlers, this.activeUrl());
    this.deps.log(`graft link: trying ${this.activeUrl()} next`);
    this.client.start();
  }

  private hostBusy(): boolean {
    return Date.now() < this.busyUntil;
  }

  private hostReady(): void {
    this.busyUntil = 0;
    this.busyBackoffMs = 0;
  }

  /** True (and quiet) when the host is briefly unavailable; the next poll waits out a growing pause. */
  private markHostBusy(error: unknown): boolean {
    const retryAfterMs = hostBusyRetryAfterMs(error);
    if (retryAfterMs === undefined) {
      return false;
    }
    this.busyBackoffMs = Math.min(
      HOST_BUSY_MAX_BACKOFF_MS,
      Math.max(retryAfterMs, this.busyBackoffMs * 2),
    );
    this.busyUntil = Date.now() + this.busyBackoffMs;
    return true;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    if (this.workTimer) {
      clearInterval(this.workTimer);
    }
    this.timer = undefined;
    this.workTimer = undefined;
  }

  private async pollWork(): Promise<void> {
    const client = this.client;
    if (
      !client ||
      this.polling ||
      this.state !== "connected" ||
      !this.deps.handleWork ||
      this.hostBusy()
    ) {
      return;
    }
    this.polling = true;
    try {
      const results = new GraftLinkResults(this.link);
      const pending = results.pending();
      if (pending) {
        await client.request("graft.work.complete", { id: pending.id, ...pending.result });
        results.acknowledge(pending.id);
        this.hostReady();
        return;
      }
      const response = (await client.request("graft.work.poll", {})) as {
        job?: GraftWorkJob | null;
      };
      this.hostReady();
      const job = response.job;
      if (!job) {
        return;
      }
      let result = results.get(job.id);
      if (!result) {
        try {
          result = await this.deps.handleWork(job);
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) };
        }
        results.save(job.id, result);
      }
      await client.request("graft.work.complete", { id: job.id, ...result });
      results.acknowledge(job.id);
    } catch (error) {
      if (this.markHostBusy(error)) {
        return;
      }
      if (this.state === "connected") {
        this.deps.log(`graft link: work poll failed: ${(error as Error)?.message ?? error}`);
      }
    } finally {
      this.polling = false;
    }
  }
}

/**
 * Keep one link per saved host; a host saved later (`branch graft join` while the gateway runs) starts within a
 * poll, and a link whose host disconnected this Branch is dropped. Links are keyed by graftLinkKey, so a link that
 * followed its host to a new address keeps running.
 */
export class GraftLinkSupervisor {
  private readonly runners = new Map<string, GraftLinkRunner>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly deps: {
      links: () => GraftLink[];
      createRunner: (link: GraftLink) => GraftLinkRunner;
      pollMs?: number;
    },
  ) {}

  start(): void {
    this.sync();
    this.timer = setInterval(() => this.sync(), this.deps.pollMs ?? 5_000);
    this.timer.unref?.();
  }

  sync(): void {
    const saved = new Map(this.deps.links().map((link) => [graftLinkKey(link), link]));
    for (const [key, runner] of this.runners) {
      const link = saved.get(key);
      if (!link || runner.state === "disconnected" || runner.state === "stopped") {
        runner.stop();
        this.runners.delete(key);
      }
    }
    for (const [key, link] of saved) {
      if (this.runners.has(key)) {
        continue;
      }
      const runner = this.deps.createRunner(link);
      this.runners.set(key, runner);
      runner.start();
    }
  }

  /** Each link's state by its current address. */
  states(): Record<string, LinkState> {
    return Object.fromEntries(
      [...this.runners.values()].map((runner) => [runner.url, runner.state]),
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    for (const runner of this.runners.values()) {
      runner.stop();
    }
    this.runners.clear();
  }
}

/** The real link client: this Branch's own device identity and stored device token, read + write only. */
export async function createDeviceLinkClient(
  link: GraftLink,
  handlers: LinkHandlers,
): Promise<LinkClient> {
  const [{ GatewayClient, prepareGatewayClientDeviceAuth }, { loadOrCreateDeviceIdentity }, names] =
    await Promise.all([
      import("../gateway/client.js"),
      import("../infra/device-identity.js"),
      import("../../packages/gateway-protocol/src/client-info.js"),
    ]);
  const deviceIdentity = loadOrCreateDeviceIdentity();
  const base = { url: link.url, tlsFingerprint: link.tlsFingerprint, deviceIdentity };
  // Prepared before the socket opens, so the first store read never runs inside the host's pre-connect budget.
  await prepareGatewayClientDeviceAuth(base);
  const client = new GatewayClient({
    ...base,
    clientName: names.GATEWAY_CLIENT_NAMES.CLI,
    clientDisplayName: link.name,
    mode: names.GATEWAY_CLIENT_MODES.CLI,
    role: "operator",
    scopes: GRAFT_DEVICE_SCOPES,
    onHelloOk: () => handlers.onHello(),
    onClose: () => handlers.onClose(),
    onConnectError: (error) => {
      if (isHostRefusal(error)) {
        handlers.onRefused(error.message);
      } else {
        handlers.onConnectError?.(error);
      }
    },
    onReconnectPaused: (info) =>
      handlers.onRefused(`${info.reason} (${info.detailCode ?? info.code})`),
  });
  return {
    start: () => client.start(),
    stop: () => client.stop(),
    request: (m, p) => client.request(m, p),
  };
}

/** Start the joined Branch's links to its saved hosts (the gateway's graft-link service). */
export function startGraftLinks(log: (line: string) => void): GraftLinkSupervisor {
  const supervisor: GraftLinkSupervisor = new GraftLinkSupervisor({
    links: () => readGraftLinks(),
    createRunner: (link) =>
      new GraftLinkRunner({
        link,
        log,
        findHost: (hostName, port) => findGraftHostAddresses(hostName, port),
        learnHostName: (url) => learnGraftHostName(url),
        save: (fromUrl, next) => replaceGraftLink(fromUrl, next),
        handleWork: async (job) => {
          const [{ callGateway }, { waitForAgentRunReply }] = await Promise.all([
            import("../gateway/call.js"),
            import("../agents/run-wait.js"),
          ]);
          const key = `agent:${job.trunkId}:graft:${job.id}`;
          try {
            await callGateway({
              method: "sessions.create",
              params: { key, agentId: job.trunkId, label: job.text.slice(0, 60) },
            });
          } catch (error) {
            // A reclaimed job may already have made its thread before the link dropped.
            await callGateway({ method: "sessions.describe", params: { key } }).catch(() => {
              throw error;
            });
          }
          const sent = await callGateway<{ runId?: string }>({
            method: "chat.send",
            params: {
              sessionKey: key,
              agentId: job.trunkId,
              message: job.text,
              deliver: false,
              idempotencyKey: `graft-work:${job.id}`,
              outsideAgent: { id: "branch-host", name: "Host Branch" },
            },
          });
          if (!sent.runId) {
            return { error: "The joined Trunk did not accept the message." };
          }
          const result = await waitForAgentRunReply({
            runId: sent.runId,
            timeoutMs: 10 * 60_000,
            callGateway: (request) => callGateway(request),
            untilTerminal: true,
          });
          return result.status === "ok"
            ? {
                reply:
                  result.replyText?.trim() || "The joined Trunk finished without a visible reply.",
              }
            : { error: result.error || `The joined Trunk ended with ${result.status}.` };
        },
        trunks: async () => {
          const [{ getRuntimeConfig }, { listGatewayAgentsBasic }] = await Promise.all([
            import("../config/config.js"),
            import("../gateway/agent-list.js"),
          ]);
          const cfg = getRuntimeConfig();
          const roster = await listGatewayAgentsBasic(cfg);
          const entries = new Map(listAgentEntries(cfg).map((entry) => [entry.id, entry]));
          return roster.agents
            .filter((agent) => agent.kind !== "system")
            .map((agent) =>
              Object.assign({}, agent, {
                avatar: entries.get(agent.id)?.identity?.avatar,
              }),
            );
        },
        forget: (gone) => {
          void import("./graft-join.js").then(({ forgetGraftLink }) => forgetGraftLink(gone.url));
        },
        // The device client is created asynchronously (identity + store); calls before it exists are no-ops.
        // Each client has its own stopped flag: a link that moves to a new address stops one and starts the next.
        createClient: (handlers, url) => {
          let client: LinkClient | undefined;
          let stopped = false;
          const ready = createDeviceLinkClient({ ...link, url }, handlers).then((created) => {
            client = created;
            if (stopped) {
              created.stop();
            }
            return created;
          });
          ready.catch((error: unknown) => log(`graft link: ${(error as Error)?.message ?? error}`));
          return {
            start: () =>
              void ready.then(
                (created) => !stopped && created.start(),
                () => undefined,
              ),
            stop: () => {
              stopped = true;
              client?.stop();
            },
            request: async (method, params) => await (await ready).request(method, params),
          };
        },
      }),
  });
  supervisor.start();
  return supervisor;
}

let running: GraftLinkSupervisor | undefined;

/** The gateway's one graft-link service: started at gateway start when a saved host exists, or when
 *  `branch graft join` tells the running gateway it saved one (graft.links.sync). */
export function ensureGraftLinks(log: (line: string) => void): GraftLinkSupervisor {
  if (running) {
    running.sync();
    return running;
  }
  running = startGraftLinks(log);
  return running;
}

export function stopGraftLinks(): void {
  running?.stop();
  running = undefined;
}
