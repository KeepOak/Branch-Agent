// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_aio_sandbox_network_proxy.py (atlas SAFETY-0044)
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Duplex, PassThrough, Readable } from "node:stream";
import tls from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ByteReader,
  copyChunkedRequestBody,
  httpRequestBodyFraming,
  parseHttpHeaderFields,
  readTlsClientHello,
} from "./network-proxy-http.js";
import {
  addressIsPublic,
  decide,
  denyPendingEvents,
  domainMatches,
  pendingEvents,
  policyAllows,
  policyClock,
  recordDenial,
  withPolicyDb,
} from "./network-proxy-policy.js";
import { handleProxy, networkProxyDeps, openPublic, resolvePublic } from "./network-proxy.js";

let tmpDir = "";

function usePolicyDb(): void {
  vi.stubEnv("BRANCH_POLICY_DB", path.join(tmpDir, "policy.sqlite3"));
}

async function startServer(handler: (socket: net.Socket) => void) {
  const server = net.createServer({ allowHalfOpen: true }, handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as net.AddressInfo;
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function startProxy() {
  return startServer((socket) => {
    void handleProxy(socket);
  });
}

function connectTcp(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port, allowHalfOpen: true });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function exchange(port: number, request: Buffer | string): Promise<Buffer> {
  const socket = await connectTcp(port);
  const chunks: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise<void>((resolve) => {
    socket.once("end", () => resolve());
    socket.once("close", () => resolve());
  });
  socket.write(request);
  await Promise.race([
    ended,
    new Promise<void>((resolve) => {
      setTimeout(resolve, 2_000);
    }),
  ]);
  socket.destroy();
  return Buffer.concat(chunks);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-network-proxy-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("sandbox network proxy", () => {
  it("test_domain_matches_exact_and_leading_wildcard_only", () => {
    expect(domainMatches("pypi.org", "pypi.org")).toBe(true);
    expect(domainMatches("evilpypi.org", "pypi.org")).toBe(false);
    expect(domainMatches("files.pythonhosted.org", "*.pythonhosted.org")).toBe(true);
    expect(domainMatches("pythonhosted.org", "*.pythonhosted.org")).toBe(false);
  });

  it("test_address_is_public_rejects_host_private_link_local_and_metadata", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.2",
      "172.16.0.2",
      "192.168.1.2",
      "169.254.169.254",
      "224.0.0.1",
      "::1",
      "fc00::1",
      "fec0::1",
      "fe80::1",
      "ff0e::1",
    ]) {
      expect(addressIsPublic(address)).toBe(false);
    }
    expect(addressIsPublic("8.8.8.8")).toBe(true);
    expect(addressIsPublic("198.18.1.5")).toBe(false);
    expect(addressIsPublic("198.18.1.5", { allowSyntheticDns: true })).toBe(true);
  });

  it("test_policy_denial_and_temporary_or_sandbox_grants", () => {
    usePolicyDb();
    vi.stubEnv("BRANCH_NETWORK_MODE", "allowlist");
    vi.stubEnv("BRANCH_ALLOW_DOMAINS_JSON", JSON.stringify(["pypi.org"]));

    expect(policyAllows("pypi.org", 443, 100)).toBe(true);
    expect(policyAllows("example.com", 443, 100)).toBe(false);

    const temporary = recordDenial("example.com", 443, "CONNECT");
    expect(decide(temporary, "allow_temporary", 60)).toBe(true);
    expect(policyAllows("example.com", 443)).toBe(true);

    const sandbox = recordDenial("files.example.net", 443, "CONNECT");
    expect(decide(sandbox, "allow_sandbox", 60)).toBe(true);
    expect(policyAllows("files.example.net", 443, 10 ** 12)).toBe(true);
  });

  it("test_pending_events_are_consumed_once", () => {
    usePolicyDb();
    const requestId = recordDenial("example.com", 443, "CONNECT");

    const events = pendingEvents();

    expect(events).toEqual([
      {
        request_id: requestId,
        host: "example.com",
        port: 443,
        method: "CONNECT",
        created_at: events[0]?.created_at,
      },
    ]);
    expect(pendingEvents()).toEqual([]);
  });

  it("test_pending_events_surface_only_one_destination_per_approval", () => {
    usePolicyDb();
    const first = recordDenial("one.example", 443, "CONNECT");
    recordDenial("two.example", 443, "CONNECT");

    expect(pendingEvents().map((event) => event.request_id)).toEqual([first]);
    // The sibling is superseded so a retry can create a fresh approvable event.
    expect(pendingEvents()).toEqual([]);
    const fresh = recordDenial("two.example", 443, "CONNECT");
    expect(pendingEvents().map((event) => event.request_id)).toEqual([fresh]);
  });

  it("test_pending_events_supersede_every_sibling_without_a_batch_limit", () => {
    usePolicyDb();
    const requestIds = Array.from({ length: 17 }, (_, index) =>
      recordDenial(`host-${index}.example`, 443, "CONNECT"),
    );

    expect(pendingEvents().map((event) => event.request_id)).toEqual([requestIds[0]]);
    expect(pendingEvents()).toEqual([]);
  });

  it("test_deny_pending_events_atomically_denies_every_unsurfaced_event", () => {
    usePolicyDb();
    for (let index = 0; index < 17; index += 1) {
      recordDenial(`host-${index}.example`, 443, "CONNECT");
    }

    expect(denyPendingEvents()).toBe(17);
    expect(pendingEvents()).toEqual([]);

    const count = withPolicyDb(
      (db) =>
        db.prepare("SELECT COUNT(*) AS count FROM events WHERE decision = 'deny'").get() as {
          count: number;
        },
    );
    expect(Number(count.count)).toBe(17);
  });

  it("test_deny_pending_events_preserves_an_already_surfaced_user_decision", () => {
    usePolicyDb();
    const surfaced = recordDenial("interactive.example", 443, "CONNECT");
    expect(pendingEvents().map((event) => event.request_id)).toEqual([surfaced]);
    const unsurfaced = recordDenial("scheduled.example", 443, "CONNECT");

    expect(denyPendingEvents()).toBe(1);
    expect(decide(surfaced, "allow_temporary", 60)).toBe(true);
    expect(decide(unsurfaced, "deny", 60)).toBe(true);
  });

  it("test_pending_events_claims_old_unsurfaced_denial_on_retry", () => {
    usePolicyDb();
    let now = 100;
    vi.spyOn(policyClock, "now").mockImplementation(() => now);
    const requestId = recordDenial("late.example", 443, "CONNECT");

    now = 105;
    expect(recordDenial("late.example", 443, "CONNECT")).toBe(requestId);
    expect(pendingEvents().map((event) => event.request_id)).toEqual([requestId]);
  });

  it("test_resolve_public_fails_closed_when_dns_contains_private_answer", async () => {
    vi.spyOn(networkProxyDeps, "lookup").mockResolvedValue([
      { family: 4, address: "8.8.8.8" },
      { family: 4, address: "10.0.0.5" },
    ]);
    expect(await resolvePublic("example.com", 443)).toBeNull();
  });

  it("test_resolve_public_returns_every_validated_answer_and_open_retries", async () => {
    vi.spyOn(networkProxyDeps, "lookup").mockResolvedValue([
      { family: 4, address: "8.8.8.8" },
      { family: 4, address: "1.1.1.1" },
    ]);
    const attempts: string[] = [];
    const connected = new net.Socket();
    vi.spyOn(networkProxyDeps, "connect").mockImplementation(async (host, _port, family) => {
      attempts.push(host);
      expect(family).toBe(4);
      if (host === "8.8.8.8") {
        throw new Error("first address unavailable");
      }
      return connected;
    });

    const resolved = await resolvePublic("example.com", 443);

    expect(resolved).toEqual([
      { family: 4, address: "8.8.8.8" },
      { family: 4, address: "1.1.1.1" },
    ]);
    expect(await openPublic(resolved ?? [], 443)).toBe(connected);
    expect(attempts).toEqual(["8.8.8.8", "1.1.1.1"]);
  });

  it.each(["isolated", "allowlist"])(
    "test_denied_destination_is_rejected_without_dns_resolution[%s]",
    async (mode) => {
      usePolicyDb();
      vi.stubEnv("BRANCH_NETWORK_MODE", mode);
      vi.stubEnv("BRANCH_ALLOW_DOMAINS_JSON", JSON.stringify(["allowed.example"]));
      vi.stubEnv("BRANCH_RECORD_DENIALS", undefined);
      const resolutions: Array<[string, number]> = [];
      vi.spyOn(networkProxyDeps, "resolvePublic").mockImplementation(async (host, port) => {
        resolutions.push([host, port]);
        return null;
      });

      const proxy = await startProxy();
      try {
        const response = await exchange(
          proxy.port,
          "CONNECT denied.example:443 HTTP/1.1\r\nHost: denied.example:443\r\n\r\n",
        );

        expect(response.toString("latin1")).toContain("403 Forbidden");
        expect(resolutions).toEqual([]);
      } finally {
        await proxy.close();
      }
    },
  );

  it("test_tls_client_hello_sni_is_extracted_for_connect_enforcement", async () => {
    const written: Buffer[] = [];
    const transport = new Duplex({
      read() {},
      write(chunk: Buffer, _encoding, callback) {
        written.push(Buffer.from(chunk));
        callback();
      },
    });
    const client = tls.connect({ socket: transport, servername: "pypi.org" });
    client.on("error", () => {});
    await vi.waitFor(() => expect(written.length).toBeGreaterThan(0));
    client.destroy();
    const wire = Buffer.concat(written);

    const parsed = await readTlsClientHello(new ByteReader(Readable.from([wire])));

    expect(parsed).toEqual(["pypi.org", wire]);
  });

  it("test_http_request_framing_rejects_ambiguous_or_duplicate_lengths", () => {
    expect(() => {
      const fields = parseHttpHeaderFields(["Content-Length: 4", "Transfer-Encoding: chunked"]);
      httpRequestBodyFraming(fields);
    }).toThrow(/cannot be combined/);
    expect(() => {
      const fields = parseHttpHeaderFields(["Content-Length: 4", "Content-Length: 4"]);
      httpRequestBodyFraming(fields);
    }).toThrow(/one non-negative/);
  });

  it("test_chunked_request_body_rejects_non_hex_size", async () => {
    const reader = new ByteReader(Readable.from([Buffer.from("+1\r\na\r\n0\r\n\r\n", "latin1")]));
    const writer = new PassThrough();

    await expect(copyChunkedRequestBody(reader, writer)).rejects.toThrow(/Invalid chunk size/);
  });

  it("test_http_proxy_relays_exactly_one_request_per_connection", async () => {
    let resolveReceived: (value: Buffer) => void = () => {};
    const received = new Promise<Buffer>((resolve) => {
      resolveReceived = resolve;
    });
    const upstream = await startServer((socket) => {
      const reader = new ByteReader(socket);
      void (async () => {
        const header = await reader.readUntil(Buffer.from("\r\n\r\n"));
        const body = await reader.readExactly(4);
        resolveReceived(Buffer.concat([header, body]));
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
      })();
    });
    vi.spyOn(networkProxyDeps, "resolvePublic").mockResolvedValue([
      { family: 4, address: "127.0.0.1" },
    ]);
    vi.spyOn(networkProxyDeps, "openPublic").mockImplementation(() => connectTcp(upstream.port));
    vi.spyOn(networkProxyDeps, "policyAllows").mockImplementation(
      (host, port) => host === "allowed.example" && port === 80,
    );

    const proxy = await startProxy();
    try {
      const response = await exchange(
        proxy.port,
        "POST http://allowed.example/first HTTP/1.1\r\nHost: allowed.example\r\nContent-Length: 4\r\nConnection: keep-alive\r\n\r\ndataGET http://denied.example/second HTTP/1.1\r\nHost: denied.example\r\n\r\n",
      );

      const upstreamRequest = (await received).toString("latin1");
      expect(upstreamRequest).toContain("POST /first HTTP/1.1");
      expect(upstreamRequest).toContain("Connection: close");
      expect(upstreamRequest).not.toContain("Connection: keep-alive");
      expect(upstreamRequest.endsWith("data")).toBe(true);
      expect(upstreamRequest).not.toContain("denied.example");
      expect(response.toString("latin1")).toContain("200 OK");
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });

  it.each(["Host : denied.example", "Transfer-Encoding : chunked", "Bad(Header): value"])(
    "test_http_proxy_rejects_ambiguous_field_names_before_policy_check[%s]",
    async (malformedHeader) => {
      const policyChecks: Array<[string, number]> = [];
      vi.spyOn(networkProxyDeps, "policyAllows").mockImplementation((host, port) => {
        policyChecks.push([host, port]);
        return false;
      });

      const proxy = await startProxy();
      try {
        const response = await exchange(
          proxy.port,
          `GET http://allowed.example/ HTTP/1.1\r\nHost: allowed.example\r\n${malformedHeader}\r\n\r\n`,
        );

        expect(response.toString("latin1")).toContain("400 Bad Request");
        expect(policyChecks).toEqual([]);
      } finally {
        await proxy.close();
      }
    },
  );
});
