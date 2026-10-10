// Branch-to-Branch: this Branch grafts into another Branch (the host) as a scoped device, with upstream's setup-code
// pairing. The host issues a setup code (`branch graft invite`, the same device.pair.setupCode a phone pairs with);
// `branch graft join` (stdin prompt or `--code-file`) connects with this Branch's own device identity and the
// code's one-time bootstrap token, asking only for read + write. The host approves it like any device (silently
// for a Branch on the same computer unless gateway.nodes.pairing.autoApproveLocal is false; otherwise
// `branch devices approve <id>`), and hands back a device token this Branch keeps. `branch graft --host <url>`
// then works with the host as that device.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPairingConnectErrorDetails } from "../../packages/gateway-protocol/src/connect-error-details.js";
import { resolveStateDir } from "../config/paths.js";
import type { OutsideAgentIdentity } from "./trunk-tools.js";
import { listAgentEntries } from "../agents/agent-scope.js";

/** What a grafted Branch may do on its host: read and write, never admin, approvals or pairing. */
export const GRAFT_DEVICE_SCOPES = ["operator.read", "operator.write"];
/** Upstream's setup codes live 10 minutes; a pending approval is waited on no longer than that. */
const APPROVAL_WAIT_MS = 10 * 60_000;
const RETRY_MS = 3_000;

/** An outside identity a grafted Branch says hello as (contacts.outside.hello accepts kind and via). */
export type GraftIdentity = OutsideAgentIdentity & { kind?: "branch" | "trunk"; via?: string };
/** `url` is the address the link starts with; `urls` are the host's other addresses, tried in order when it fails. */
export type GraftLink = { url: string; urls?: string[]; tlsFingerprint?: string; name: string; joinedAt: number };
export type ConnectOutcome =
  | { ok: true; deviceId?: string; scopes: string[] }
  | { ok: false; pendingRequestId?: string; message: string };

const slug = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** This Branch as its host sees it: an outside agent of kind "branch" named after this Branch. */
export function graftBranchIdentity(name: string, where = os.hostname()): GraftIdentity {
  // "Studio Laptop" -> branch-studio-laptop; "Branch B" -> branch-b (never "branch-branch-b").
  const rest = slug(name)
    .replace(/^branch(?:-|$)/, "")
    .slice(0, 56)
    .replace(/-+$/, "");
  return {
    id: rest ? `branch-${rest}` : "branch",
    name: name.slice(0, 100),
    kind: "branch",
    ...(where ? { where: where.slice(0, 255) } : {}),
  };
}

/** One of this Branch's Trunks as a contact on the host, bound to this Branch. */
export function graftTrunkIdentity(
  branch: GraftIdentity,
  trunk: { id: string; name?: string; avatar?: string },
): GraftIdentity {
  const id = `${branch.id}--${slug(trunk.id)}`.slice(0, 64).replace(/-+$/, "");
  return {
    id,
    name: (trunk.name?.trim() || trunk.id).slice(0, 100),
    kind: "trunk",
    via: branch.id,
    trunkId: trunk.id,
    where: branch.name.slice(0, 255),
    ...(trunk.avatar?.match(/^branch:[a-z0-9-]{1,32}$/) ? { avatar: trunk.avatar } : {}),
  };
}

/** The pending pairing request id in a host's NOT_PAIRED refusal, when there is one. */
export function pendingPairingRequestId(error: unknown): string | undefined {
  const details = (error as { details?: unknown } | undefined)?.details;
  const requestId = readPairingConnectErrorDetails(details)?.requestId;
  if (requestId) return requestId;
  return /requestId: ([\w-]+)/.exec(String((error as Error)?.message ?? ""))?.[1];
}

/**
 * Pair with the host: connect with the bootstrap token until the host approves (or refuses, or the code expires).
 * `connect` is one connection attempt; the first pending request is reported once through `onPending`.
 */
export async function joinHost(params: {
  connect: () => Promise<ConnectOutcome>;
  onPending: (requestId: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  waitMs?: number;
}): Promise<{ deviceId?: string; scopes: string[] }> {
  const sleep = params.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = params.now ?? Date.now;
  const deadline = now() + (params.waitMs ?? APPROVAL_WAIT_MS);
  let reported: string | undefined;
  for (;;) {
    const outcome = await params.connect();
    if (outcome.ok) return { deviceId: outcome.deviceId, scopes: outcome.scopes };
    if (!outcome.pendingRequestId) throw new Error(outcome.message);
    if (outcome.pendingRequestId !== reported) {
      reported = outcome.pendingRequestId;
      params.onPending(outcome.pendingRequestId);
    }
    if (now() >= deadline) {
      throw new Error(`The host did not approve this Branch in time (request ${reported}).`);
    }
    await sleep(RETRY_MS);
  }
}

function linksFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "graft", "hosts.json");
}

export function readGraftLinks(env?: NodeJS.ProcessEnv): GraftLink[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(linksFile(env), "utf8")) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (row): row is GraftLink =>
            !!row && typeof row.url === "string" && typeof row.name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

/** Remember the host (its address only; the device token stays in the device-auth store). */
export function saveGraftLink(link: GraftLink, env?: NodeJS.ProcessEnv): void {
  const file = linksFile(env);
  const rows = [link, ...readGraftLinks(env).filter((row) => row.url !== link.url)];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(rows, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** The saved host to connect to: the one named (by URL), else the only one. */
export function resolveGraftLink(host: string, env?: NodeJS.ProcessEnv): GraftLink {
  const links = readGraftLinks(env);
  const match =
    links.find((row) => row.url === host) ??
    (host === "" && links.length === 1 ? links[0] : undefined);
  if (!match) {
    throw new Error(
      links.length
        ? `This Branch has not joined ${host || "a single host"}; joined: ${links.map((row) => row.url).join(", ")}`
        : "This Branch has not joined another Branch yet; run `branch graft join` (stdin prompt) or `branch graft join --code-file` first.",
    );
  }
  return match;
}

type DeviceConnection = {
  request: (method: string, params: unknown) => Promise<unknown>;
  stop: () => void;
};

/**
 * One connection to the host as this Branch's own device: read + write only, the bootstrap token while pairing and
 * the stored device token after. The device-auth store is prepared before the socket opens (a first read inside
 * the host's 15 s pre-connect budget is what timed out). Resolves on hello-ok or on the host's refusal.
 */
export async function connectAsDevice(params: {
  url: string;
  tlsFingerprint?: string;
  bootstrapToken?: string;
  displayName: string;
}): Promise<{ outcome: ConnectOutcome; connection?: DeviceConnection }> {
  const [{ GatewayClient, prepareGatewayClientDeviceAuth }, { loadOrCreateDeviceIdentity }, names] =
    await Promise.all([
      import("../gateway/client.js"),
      import("../infra/device-identity.js"),
      import("../../packages/gateway-protocol/src/client-info.js"),
    ]);
  const deviceIdentity = loadOrCreateDeviceIdentity();
  const base = {
    url: params.url,
    tlsFingerprint: params.tlsFingerprint,
    ...(params.bootstrapToken
      ? { bootstrapToken: params.bootstrapToken, preferBootstrapToken: true }
      : {}),
    deviceIdentity,
  };
  await prepareGatewayClientDeviceAuth(base);
  return await new Promise((resolveOnce) => {
    // Settle once, before stopping: stopping the client reports "gateway client stopped" re-entrantly.
    let settled = false;
    const resolve = (value: { outcome: ConnectOutcome; connection?: DeviceConnection }) => {
      if (settled) return;
      settled = true;
      resolveOnce(value);
      if (!value.connection) client.stop();
    };
    const client = new GatewayClient({
      ...base,
      clientName: names.GATEWAY_CLIENT_NAMES.CLI,
      clientDisplayName: params.displayName,
      mode: names.GATEWAY_CLIENT_MODES.CLI,
      role: "operator",
      scopes: GRAFT_DEVICE_SCOPES,
      onHelloOk: (hello) => {
        const auth = (hello as { auth?: { scopes?: string[] } }).auth;
        resolve({
          outcome: { ok: true, deviceId: deviceIdentity.deviceId, scopes: auth?.scopes ?? [] },
          connection: {
            request: (method, body) => client.request(method, body),
            stop: () => client.stop(),
          },
        });
      },
      onConnectError: (error) => {
        resolve({
          outcome: {
            ok: false,
            pendingRequestId: pendingPairingRequestId(error),
            message: error.message,
          },
        });
      },
      // A refusal can arrive as the close reason alone ("pairing required (requestId: ...)").
      onClose: (code, reason) => {
        const message = `The host closed the connection (${code}): ${reason}`;
        resolve({
          outcome: { ok: false, pendingRequestId: pendingPairingRequestId({ message }), message },
        });
      },
    });
    client.start();
  });
}

/** What `branch graft --host` serves: the saved host and this Branch's own Trunks (from its config). */
export async function graftHostOptions(
  host: string,
): Promise<{ link: GraftLink; trunks: { id: string; name?: string; avatar?: string }[] }> {
  const [{ getRuntimeConfig }, { listGatewayAgentsBasic }] = await Promise.all([
    import("../config/config.js"),
    import("../gateway/agent-list.js"),
  ]);
  const link = resolveGraftLink(host);
  const cfg = getRuntimeConfig();
  const roster = await listGatewayAgentsBasic(cfg);
  const entries = new Map(listAgentEntries(cfg).map((entry) => [entry.id, entry]));
  return { link, trunks: roster.agents.filter((agent) => agent.kind !== "system").map((agent) => ({
    ...agent,
    avatar: entries.get(agent.id)?.identity?.avatar,
  })) };
}

/** Forget a host that disconnected this Branch (its pairing is gone there). */
export function forgetGraftLink(url: string, env?: NodeJS.ProcessEnv): void {
  const file = linksFile(env);
  const rows = readGraftLinks(env).filter((row) => row.url !== url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(rows, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
