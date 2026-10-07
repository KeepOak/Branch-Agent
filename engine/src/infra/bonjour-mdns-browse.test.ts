import { describe, expect, it } from "vitest";
import { encodePtrQuery, parseMdnsResponse, servicesFromRecords } from "./bonjour-mdns-browse.js";

const name = (value: string) =>
  Buffer.concat([
    ...value.split(".").map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])),
    Buffer.from([0]),
  ]);
const record = (owner: Buffer, type: number, data: Buffer) => {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(1, 2);
  head.writeUInt32BE(120, 4);
  head.writeUInt16BE(data.length, 8);
  return Buffer.concat([owner, head, data]);
};

/** A response like the gateway's ciao advertiser sends: PTR answer, SRV/TXT/A additionals, with a name pointer. */
function gatewayResponse(): Buffer {
  const header = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 3]);
  const service = name("_branch-gw._tcp.local");
  const instance = name("Studio (Branch Agent)._branch-gw._tcp.local");
  const ptr = record(service, 12, instance);
  const srvData = Buffer.concat([Buffer.from([0, 0, 0, 0, 0xc8, 0x3a]), name("studio.local")]);
  // The SRV owner points back at the PTR's instance name (offset 12 + service + 10-byte record head).
  const pointer = Buffer.from([0xc0, 12 + service.length + 10]);
  const srv = record(pointer, 33, srvData);
  const txtStrings = [
    "role=gateway",
    "gatewayPort=51258",
    "lanHost=studio.local",
    "displayName=Studio",
  ];
  const txt = record(
    pointer,
    16,
    Buffer.concat(txtStrings.map((t) => Buffer.concat([Buffer.from([t.length]), Buffer.from(t)]))),
  );
  const a = record(name("studio.local"), 1, Buffer.from([192, 168, 1, 20]));
  return Buffer.concat([header, ptr, srv, txt, a]);
}

describe("Bonjour browsing without an OS tool (Windows)", () => {
  it("asks one PTR question for the service type", () => {
    const query = encodePtrQuery("_branch-gw._tcp.local");
    expect(query.readUInt16BE(4)).toBe(1);
    expect(query.subarray(12).toString("latin1")).toContain("_branch-gw");
    expect(query.readUInt16BE(query.length - 4)).toBe(12);
  });

  it("reads the gateway's PTR, SRV, TXT and A records into a service", () => {
    const records = parseMdnsResponse(gatewayResponse());
    expect(records.map((r) => r.type)).toEqual([12, 33, 16, 1]);
    expect(servicesFromRecords("_branch-gw._tcp.local", records)).toEqual([
      {
        instance: "Studio (Branch Agent)",
        host: "studio.local",
        port: 51258,
        address: "192.168.1.20",
        txt: ["role=gateway", "gatewayPort=51258", "lanHost=studio.local", "displayName=Studio"],
      },
    ]);
  });

  it("ignores queries and other services", () => {
    expect(parseMdnsResponse(encodePtrQuery("_branch-gw._tcp.local"))).toEqual([]);
    expect(servicesFromRecords("_other._tcp.local", parseMdnsResponse(gatewayResponse()))).toEqual(
      [],
    );
  });
});
