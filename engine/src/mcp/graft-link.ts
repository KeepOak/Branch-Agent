// The joined Branch's own link to its host Branch (Branch-to-Branch). A background service of the joined Branch's
// gateway, started with it when a saved host exists (state/graft/hosts.json, written by `branch graft join`): one
// long-lived gateway client per host, as the node host keeps its link. The client reconnects by itself with
// upstream's jittered backoff; on every hello-ok the link says hello as this Branch and its Trunks, and again every
// minute so the host shows them online. When the host disconnects this Branch (Settings › Grafts removes its
// pairing), the link stops and forgets the host; a new `branch graft join` brings it back.
import { readConnectErrorDetailCode } from "../../packages/gateway-protocol/src/connect-error-details.js";
import { listAgentEntries } from "../agents/agent-scope.js";
import {
  GRAFT_DEVICE_SCOPES,
  graftBranchIdentity,
  graftTrunkIdentity,
  readGraftLinks,
  type GraftLink,
} from "./graft-join.js";
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
  if (code) return code === "PAIRING_REQUIRED" || code.startsWith("AUTH_");
  return /pairing required|unauthorized|device token|was disconnected/i.test(
    String((error as Error)?.message),
  );
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
    },
  ) {}

  /** The link's saved addresses, starting with its own `url`, without repeats. */
  addresses(): string[] {
    return [...new Set([this.deps.link.url, ...(this.deps.link.urls ?? [])])];
  }

  private activeUrl(): string {
    const addresses = this.addresses();
    return addresses[this.addressIndex % addresses.length] ?? this.deps.link.url;
  }

  private readonly handlers: LinkHandlers = {
    onHello: () => {
      this.state = "connected";
      this.deps.log(`graft link: connected to ${this.activeUrl()}`);
      void this.sayHello();
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
    if (this.state !== "disconnected") this.state = "stopped";
    this.clearTimer();
    this.client?.stop();
  }

  /** This Branch, then each of its Trunks (the host binds the Trunks to the Branch row). */
  async sayHello(): Promise<void> {
    const client = this.client;
    if (!client || this.state !== "connected") return;
    try {
      const branch = graftBranchIdentity(this.deps.link.name);
      await client.request("contacts.outside.hello", { agent: branch });
      for (const trunk of await this.deps.trunks()) {
        await client.request("contacts.outside.hello", {
          agent: graftTrunkIdentity(branch, trunk),
        });
      }
    } catch (error) {
      if (isHostRefusal(error)) this.disconnected(String((error as Error).message));
      else this.deps.log(`graft link: hello failed: ${String((error as Error)?.message ?? error)}`);
    }
  }

  private disconnected(reason: string): void {
    if (this.state === "disconnected" || this.state === "stopped") return;
    this.state = "disconnected";
    this.deps.log(`graft link: ${this.deps.link.url} disconnected this Branch (${reason})`);
    this.clearTimer();
    this.client?.stop();
    this.deps.forget(this.deps.link);
  }

  private connectFailed(error: Error): void {
    if (this.state === "connected" || this.state === "disconnected" || this.state === "stopped") return;
    const now = Date.now();
    if (now - this.lastConnectFailureLogAt >= CONNECT_FAILURE_LOG_INTERVAL_MS) {
      this.lastConnectFailureLogAt = now;
      const reason = String(error?.message ?? error);
      this.deps.log(
        `graft link: can't reach ${this.activeUrl()} (${reason}); retrying. If this host's address changed, rejoin it with a new setup code.`,
      );
    }
    this.switchAddress(now);
  }

  /** Moves to the next saved address; the host's other addresses are how a link recovers when one changes. */
  private switchAddress(now: number): void {
    if (!FALLBACK_ADDRESSES_VERIFIED || this.addresses().length < 2) return;
    if (now - this.lastAddressSwitchAt < ADDRESS_SWITCH_INTERVAL_MS) return;
    this.lastAddressSwitchAt = now;
    this.addressIndex += 1;
    this.client?.stop();
    this.client = this.deps.createClient(this.handlers, this.activeUrl());
    this.deps.log(`graft link: trying ${this.activeUrl()} next`);
    this.client.start();
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.workTimer) clearInterval(this.workTimer);
    this.timer = undefined;
    this.workTimer = undefined;
  }

  private async pollWork(): Promise<void> {
    const client = this.client;
    if (!client || this.polling || this.state !== "connected" || !this.deps.handleWork) return;
    this.polling = true;
    try {
      const response = await client.request("graft.work.poll", {}) as { job?: GraftWorkJob | null };
      const job = response.job;
      if (!job) return;
      let result: { reply?: string; error?: string };
      try {
        result = await this.deps.handleWork(job);
      } catch (error) {
        result = { error: String((error as Error)?.message ?? error) };
      }
      await client.request("graft.work.complete", { id: job.id, ...result });
    } catch (error) {
      if (this.state === "connected") this.deps.log(`graft link: work poll failed: ${String((error as Error)?.message ?? error)}`);
    } finally {
      this.polling = false;
    }
  }
}

/**
 * Keep one link per saved host; a host saved later (`branch graft join` while the gateway runs) starts within a
 * poll, and a link whose host disconnected this Branch is dropped.
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
    const saved = new Map(this.deps.links().map((link) => [link.url, link]));
    for (const [url, runner] of this.runners) {
      const link = saved.get(url);
      if (!link || runner.state === "disconnected" || runner.state === "stopped") {
        runner.stop();
        this.runners.delete(url);
      }
    }
    for (const [url, link] of saved) {
      if (this.runners.has(url)) continue;
      const runner = this.deps.createRunner(link);
      this.runners.set(url, runner);
      runner.start();
    }
  }

  states(): Record<string, LinkState> {
    return Object.fromEntries([...this.runners].map(([url, runner]) => [url, runner.state]));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    for (const runner of this.runners.values()) runner.stop();
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
      if (isHostRefusal(error)) handlers.onRefused(error.message);
      else handlers.onConnectError?.(error);
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
    createRunner: (link) => {
      let client: LinkClient | undefined;
      let stopped = false;
      return new GraftLinkRunner({
        link,
        log,
        handleWork: async (job) => {
          const [{ callGateway }, { waitForAgentRunReply }] = await Promise.all([
            import("../gateway/call.js"),
            import("../agents/run-wait.js"),
          ]);
          const key = `agent:${job.trunkId}:graft:${job.id}`;
          try {
            await callGateway({ method: "sessions.create", params: { key, agentId: job.trunkId, label: job.text.slice(0, 60) } });
          } catch (error) {
            // A reclaimed job may already have made its thread before the link dropped.
            await callGateway({ method: "sessions.describe", params: { key } }).catch(() => { throw error; });
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
          if (!sent.runId) return { error: "The joined Trunk did not accept the message." };
          const result = await waitForAgentRunReply({
            runId: sent.runId,
            timeoutMs: 10 * 60_000,
            callGateway: (request) => callGateway(request),
            untilTerminal: true,
          });
          return result.status === "ok"
            ? { reply: result.replyText?.trim() || "The joined Trunk finished without a visible reply." }
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
          return roster.agents.filter((agent) => agent.kind !== "system").map((agent) => ({
            ...agent,
            avatar: entries.get(agent.id)?.identity?.avatar,
          }));
        },
        forget: (gone) => {
          void import("./graft-join.js").then(({ forgetGraftLink }) => forgetGraftLink(gone.url));
        },
        // The device client is created asynchronously (identity + store); calls before it exists are no-ops.
        createClient: (handlers, url) => {
          const ready = createDeviceLinkClient({ ...link, url }, handlers).then((created) => {
            client = created;
            if (stopped) created.stop();
            return created;
          });
          ready.catch((error: unknown) =>
            log(`graft link: ${String((error as Error)?.message ?? error)}`),
          );
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
      });
    },
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
