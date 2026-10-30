// A graft link finds its host again by name when the router hands the host a new LAN address (#2100). The host's
// gateway advertises itself over mDNS (Bonjour) with its lanHost name (studio.local, extensions/bonjour). While the
// link is connected it learns that name once (the beacon on the link's port whose address is the link's own) and
// saves it with the link; when the saved address stops answering it looks the name up and moves to the host's new
// address, with no new setup code.
import dns from "node:dns";
import type { GatewayBonjourBeacon } from "../infra/bonjour-discovery.js";

/** A link that can't reach its host looks the host's name up at most once per this interval. */
export const HOST_LOOKUP_INTERVAL_MS = 30_000;

export type GraftHostLookupDeps = {
  /** The system resolver: macOS, Windows and Linux with nss-mdns answer .local names over mDNS. */
  resolve?: (hostName: string) => Promise<string[]>;
  /** The LAN's Branch gateway beacons. */
  discover?: () => Promise<GatewayBonjourBeacon[]>;
};

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function sameName(left: string, right: string): boolean {
  const normalize = (name: string) => name.trim().toLowerCase().replace(/\.$/, "");
  return normalize(left) === normalize(right);
}

async function systemResolve(hostName: string): Promise<string[]> {
  const rows = await dns.promises.lookup(hostName, { all: true, family: 4 });
  return rows.map((row) => row.address);
}

async function discoverBeacons(): Promise<GatewayBonjourBeacon[]> {
  const { discoverGatewayBeacons } = await import("../infra/bonjour-discovery.js");
  return await discoverGatewayBeacons({ domains: ["local."], timeoutMs: 2_000 });
}

function linkPort(url: URL): number {
  return Number(url.port) || (url.protocol === "wss:" ? 443 : 80);
}

/** A beacon's IPv4 addresses: its own when it carries one (Windows), else its lanHost name resolved. */
async function beaconAddresses(
  beacon: GatewayBonjourBeacon,
  resolve: (hostName: string) => Promise<string[]>,
): Promise<string[]> {
  if (beacon.host && IPV4.test(beacon.host)) {
    return [beacon.host];
  }
  return beacon.lanHost ? await resolve(beacon.lanHost).catch(() => []) : [];
}

/** The host's current IPv4 addresses by its mDNS name; the system resolver first, then the host's own beacon. */
export async function findGraftHostAddresses(
  hostName: string,
  port: number,
  deps: GraftHostLookupDeps = {},
): Promise<string[]> {
  const resolve = deps.resolve ?? systemResolve;
  const resolved = (await resolve(hostName).catch(() => [])).filter((address) =>
    IPV4.test(address),
  );
  if (resolved.length > 0) {
    return resolved;
  }
  const beacons = await (deps.discover ?? discoverBeacons)().catch(() => []);
  const found: string[] = [];
  for (const beacon of beacons) {
    if (
      beacon.lanHost &&
      sameName(beacon.lanHost, hostName) &&
      (beacon.gatewayPort ?? beacon.port) === port &&
      beacon.host &&
      IPV4.test(beacon.host)
    ) {
      found.push(beacon.host);
    }
  }
  return found;
}

/**
 * The host's mDNS name for a link connected at url: the beacon on the link's port whose address is the link's.
 * Undefined when the link's address is a name already (a tailnet name doesn't change with the router) or no beacon
 * matches (the host's mDNS is off).
 */
export async function learnGraftHostName(
  url: string,
  deps: GraftHostLookupDeps = {},
): Promise<string | undefined> {
  const parsed = new URL(url);
  if (!IPV4.test(parsed.hostname)) {
    return undefined;
  }
  const port = linkPort(parsed);
  const resolve = deps.resolve ?? systemResolve;
  for (const beacon of await (deps.discover ?? discoverBeacons)().catch(() => [])) {
    if (!beacon.lanHost || (beacon.gatewayPort ?? beacon.port) !== port) {
      continue;
    }
    if ((await beaconAddresses(beacon, resolve)).includes(parsed.hostname)) {
      return beacon.lanHost.trim().toLowerCase().replace(/\.$/, "");
    }
  }
  return undefined;
}

/** The link's address with the host's current one, or undefined when the host is still at the link's address. */
export function movedGraftUrl(url: string, addresses: string[]): string | undefined {
  const parsed = new URL(url);
  const next = addresses.find((address) => IPV4.test(address));
  if (!next || addresses.includes(parsed.hostname)) {
    return undefined;
  }
  return url.replace(parsed.host, parsed.port ? next + ":" + parsed.port : next);
}

/** The port a link's address names, for matching the host's beacon. */
export function graftLinkPort(url: string): number {
  return linkPort(new URL(url));
}
