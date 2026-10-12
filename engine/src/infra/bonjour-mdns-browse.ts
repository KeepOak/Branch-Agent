// Bonjour browsing without an OS tool, for Windows: it has no `dns-sd` or `avahi-browse`, and its resolver
// (Resolve-DnsName) answers service-type PTR lookups with "DNS name does not exist", so `branch gateway discover`
// found nothing there. This sends one mDNS PTR query (RFC 6762, from an ephemeral port: a legacy unicast query, which
// responders answer straight back to the asker) on every IPv4 interface and reads the PTR, SRV, TXT and A records the
// gateways' advertisers send back.
import dgram from "node:dgram";
import os from "node:os";

const MDNS_ADDRESS = "224.0.0.251";
const MDNS_PORT = 5353;
const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33 } as const;

export type MdnsRecord =
  | { name: string; type: 1; address: string }
  | { name: string; type: 12; target: string }
  | { name: string; type: 16; strings: string[] }
  | { name: string; type: 33; port: number; target: string };

export type MdnsService = {
  instance: string;
  host?: string;
  port?: number;
  address?: string;
  txt: string[];
};

/** One standard query for `name` (PTR), as an mDNS legacy unicast query. */
export function encodePtrQuery(name: string): Buffer {
  const labels = name.replace(/\.$/, "").split(".");
  const parts = [Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0])];
  for (const label of labels) {
    const bytes = Buffer.from(label, "utf8");
    parts.push(Buffer.from([bytes.length]), bytes);
  }
  parts.push(Buffer.from([0, 0, TYPE.PTR, 0, 1]));
  return Buffer.concat(parts);
}

function readName(buf: Buffer, start: number): { name: string; next: number } {
  const labels: string[] = [];
  let offset = start;
  let next = -1;
  for (let jumps = 0; jumps < 64; jumps++) {
    const len = buf[offset];
    if (len === undefined) throw new Error("truncated name");
    if (len === 0) {
      return { name: labels.join("."), next: next === -1 ? offset + 1 : next };
    }
    if ((len & 0xc0) === 0xc0) {
      if (next === -1) next = offset + 2;
      offset = ((len & 0x3f) << 8) | buf[offset + 1]!;
      continue;
    }
    labels.push(buf.toString("utf8", offset + 1, offset + 1 + len));
    offset += 1 + len;
  }
  throw new Error("name pointer loop");
}

/** The answer, authority and additional records of an mDNS response (unknown types skipped). */
export function parseMdnsResponse(buf: Buffer): MdnsRecord[] {
  if (buf.length < 12 || (buf.readUInt16BE(2) & 0x8000) === 0) return [];
  const questions = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let offset = 12;
  for (let i = 0; i < questions; i++) offset = readName(buf, offset).next + 4;
  const records: MdnsRecord[] = [];
  for (let i = 0; i < total && offset < buf.length; i++) {
    const { name, next } = readName(buf, offset);
    const type = buf.readUInt16BE(next);
    const length = buf.readUInt16BE(next + 8);
    const data = next + 10;
    if (type === TYPE.A && length === 4) {
      records.push({ name, type, address: [...buf.subarray(data, data + 4)].join(".") });
    } else if (type === TYPE.PTR) {
      records.push({ name, type, target: readName(buf, data).name });
    } else if (type === TYPE.SRV) {
      records.push({
        name,
        type,
        port: buf.readUInt16BE(data + 4),
        target: readName(buf, data + 6).name,
      });
    } else if (type === TYPE.TXT) {
      const strings: string[] = [];
      for (let at = data; at < data + length;) {
        const len = buf[at]!;
        if (len) strings.push(buf.toString("utf8", at + 1, at + 1 + len));
        at += 1 + len;
      }
      records.push({ name, type, strings });
    }
    offset = data + length;
  }
  return records;
}

const lower = (value: string) => value.toLowerCase().replace(/\.$/, "");

/** Services of `serviceName` (e.g. `_branch-gw._tcp.local`) in the collected records. */
export function servicesFromRecords(
  serviceName: string,
  records: readonly MdnsRecord[],
): MdnsService[] {
  const service = lower(serviceName);
  const instances = new Set(
    records
      .filter((r) => r.type === TYPE.PTR && lower(r.name) === service)
      .map((r) => (r as { target: string }).target),
  );
  return [...instances].map((full) => {
    const srv = records.find((r) => r.type === TYPE.SRV && lower(r.name) === lower(full)) as
      | { port: number; target: string }
      | undefined;
    const txt = records.find((r) => r.type === TYPE.TXT && lower(r.name) === lower(full)) as
      | { strings: string[] }
      | undefined;
    const a = srv
      ? (records.find((r) => r.type === TYPE.A && lower(r.name) === lower(srv.target)) as
          | { address: string }
          | undefined)
      : undefined;
    return {
      instance: full.slice(0, full.length - service.length - 1) || full,
      ...(srv ? { host: srv.target.replace(/\.$/, ""), port: srv.port } : {}),
      ...(a ? { address: a.address } : {}),
      txt: txt?.strings ?? [],
    };
  });
}

/** IPv4 addresses to query from: every up interface, loopback included (a Branch on the same computer). */
function interfaceAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry): entry is os.NetworkInterfaceInfo => !!entry && entry.family === "IPv4")
    .map((entry) => entry.address);
}

/** Browse `serviceName` for `timeoutMs` and return what answered. */
export async function browseMdns(
  serviceName: string,
  timeoutMs: number,
  addresses: string[] = interfaceAddresses(),
): Promise<MdnsService[]> {
  const records: MdnsRecord[] = [];
  const query = encodePtrQuery(serviceName);
  const sockets = await Promise.all(
    addresses.map(
      (address) =>
        new Promise<dgram.Socket | undefined>((resolve) => {
          const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
          socket.on("message", (msg) => {
            try {
              records.push(...parseMdnsResponse(msg));
            } catch {
              // A malformed packet from some other responder.
            }
          });
          socket.once("error", () => {
            socket.close();
            resolve(undefined);
          });
          socket.bind(0, address, () => {
            try {
              socket.setMulticastInterface(address);
              socket.send(query, MDNS_PORT, MDNS_ADDRESS);
              resolve(socket);
            } catch {
              socket.close();
              resolve(undefined);
            }
          });
        }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  for (const socket of sockets) socket?.close();
  return servicesFromRecords(serviceName, records);
}
