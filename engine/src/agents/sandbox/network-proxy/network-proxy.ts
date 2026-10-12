// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/community/aio_sandbox/network_proxy.py (atlas SAFETY-0044)
/**
 * Trusted HTTP(S) policy proxy used by restricted Docker sandboxes.
 *
 * The sidecar runs this file as a script, so the proxy modules import only Node builtins
 * and use erasable TypeScript syntax. It deliberately supports only HTTP absolute-form
 * requests and HTTPS CONNECT; all other protocols remain unavailable on the sandbox's
 * internal-only network.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { realpathSync } from "node:fs";
import net from "node:net";
import { pathToFileURL } from "node:url";
import {
  buildHttpOutboundHeader,
  ByteReader,
  copyChunkedRequestBody,
  copyExactRequestBytes,
  fieldValues,
  httpRequestBodyFraming,
  type HttpBodyFraming,
  type HttpHeaderField,
  InvalidHttpBodyError,
  InvalidHttpHeaderError,
  InvalidHttpRequestError,
  IO_TIMEOUT_MS,
  isStreamReadFailure,
  MAX_HEADER_BYTES,
  netlocHostname,
  netlocPort,
  parseAuthority,
  parseHttpHeaderFields,
  readTlsClientHello,
  RELAY_CHUNK_BYTES,
  urlSplit,
  withTimeout,
  writeAll,
} from "./network-proxy-http.js";
import {
  addressIsPublic,
  decide,
  denyPendingEvents,
  isNetworkPolicyDecision,
  NETWORK_PROXY_ENV,
  normalizeHost,
  pendingEvents,
  policyAllows,
  recordDenial,
  withPolicyDb,
} from "./network-proxy-policy.js";

export const NETWORK_PROXY_PORT = 3128;
const HEADER_TERMINATOR = Buffer.from("\r\n\r\n", "latin1");

export type ResolvedAddress = { family: 4 | 6; address: string };

export async function resolvePublic(host: string, port: number): Promise<ResolvedAddress[] | null> {
  let infos: ResolvedAddress[];
  try {
    infos = await networkProxyDeps.lookup(host, port);
  } catch {
    return null;
  }
  const allowSyntheticDns = process.env[NETWORK_PROXY_ENV.allowSyntheticDns] === "1";
  const accepted = infos.filter((info) => addressIsPublic(info.address, { allowSyntheticDns }));
  if (accepted.length !== infos.length || accepted.length === 0) {
    return null;
  }
  return accepted.map((info) => ({ family: info.family, address: info.address }));
}

function connectTcp(address: string, port: number, family: 4 | 6): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port, family, allowHalfOpen: true });
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

/** Try every pre-validated DNS answer within one shared deadline. */
export async function openPublic(
  resolved: readonly ResolvedAddress[],
  port: number,
): Promise<net.Socket | null> {
  const deadline = Date.now() + IO_TIMEOUT_MS;
  for (const [index, answer] of resolved.entries()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    // Reserve an equal share of the remaining budget for every later
    // address so a black-holed first answer cannot consume the full
    // deadline and strand otherwise reachable candidates.
    const attemptTimeout = remaining / (resolved.length - index);
    try {
      return await withTimeout(
        networkProxyDeps.connect(answer.address, port, answer.family),
        attemptTimeout,
        (late) => late.destroy(),
      );
    } catch {
      continue;
    }
  }
  return null;
}

async function lookupAddresses(host: string, _port: number): Promise<ResolvedAddress[]> {
  const entries = await dnsLookup(host, { all: true, order: "verbatim" });
  return entries.map((entry) => ({
    family: entry.family === 6 ? (6 as const) : (4 as const),
    address: entry.address,
  }));
}

/** Mutable seams mirror the upstream module-level monkeypatch points for loopback tests. */
export const networkProxyDeps = {
  lookup: lookupAddresses,
  connect: connectTcp,
  policyAllows: (host: string, port: number): boolean => policyAllows(host, port),
  resolvePublic: (host: string, port: number) => resolvePublic(host, port),
  openPublic: (resolved: readonly ResolvedAddress[], port: number) => openPublic(resolved, port),
};

function closeSocket(socket: net.Socket): void {
  if (!socket.destroyed) {
    socket.end(() => socket.destroy());
  }
}

async function relay(reader: ByteReader, writer: net.Socket): Promise<void> {
  try {
    for (;;) {
      const chunk = await reader.read(RELAY_CHUNK_BYTES);
      if (chunk.length === 0) {
        break;
      }
      await writeAll(writer, chunk);
    }
  } catch {
    // Connection failures end this direction of the relay.
  } finally {
    closeSocket(writer);
  }
}

async function rejectRequest(writer: net.Socket, status: string, body: string): Promise<void> {
  const encoded = Buffer.from(body, "utf8");
  const head = `HTTP/1.1 ${status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${encoded.length}\r\nConnection: close\r\n\r\n`;
  await writeAll(writer, Buffer.concat([Buffer.from(head, "latin1"), encoded]));
  await new Promise<void>((resolve) => {
    writer.end(() => resolve());
  });
  writer.destroy();
}

type HttpProxyRequest = {
  kind: "http";
  method: string;
  host: string;
  port: number;
  outboundHeader: Buffer;
  framing: HttpBodyFraming;
};
type ProxyRequest =
  | { kind: "connect"; method: "CONNECT"; host: string; port: number }
  | HttpProxyRequest;
type ProxyRejection = { reject: true; status: string; body: string };

function rejection(status: string, body: string): ProxyRejection {
  return { reject: true, status, body };
}

function parseConnectRequest(target: string): ProxyRequest | ProxyRejection {
  const parsed = parseAuthority(target, 443);
  if (parsed === null || parsed[1] !== 443) {
    return rejection("403 Forbidden", "Only HTTPS CONNECT on port 443 is supported");
  }
  return { kind: "connect", method: "CONNECT", host: parsed[0], port: parsed[1] };
}

type HttpTarget = { host: string; port: number; path: string };

function parseHttpTarget(target: string): HttpTarget | ProxyRejection {
  const parsed = urlSplit(target);
  const hostname = parsed ? netlocHostname(parsed.netloc) : null;
  if (!parsed || parsed.scheme !== "http" || !hostname) {
    return rejection(
      "403 Forbidden",
      "Only HTTP absolute-form requests and HTTPS CONNECT are supported",
    );
  }
  const rawPort = netlocPort(parsed.netloc);
  if (rawPort === "invalid") {
    return rejection("400 Bad Request", "Invalid destination port");
  }
  const port = rawPort || 80;
  const host = normalizeHost(hostname);
  if (host === null || port !== 80) {
    return rejection("403 Forbidden", "Only HTTP on port 80 is supported");
  }
  const path = (parsed.path || "/") + (parsed.query ? `?${parsed.query}` : "");
  return { host, port, path };
}

function parseHttpRequest(
  method: string,
  target: string,
  version: string,
  fields: readonly HttpHeaderField[],
): ProxyRequest | ProxyRejection {
  const parsed = parseHttpTarget(target);
  if ("reject" in parsed) {
    return parsed;
  }
  const hostHeaders = fieldValues(fields, "host");
  const authority = hostHeaders.length === 1 ? parseAuthority(hostHeaders[0] ?? "", 80) : null;
  if (authority?.[0] !== parsed.host || authority[1] !== parsed.port) {
    return rejection(
      "400 Bad Request",
      "HTTP Host header must match the approved proxy destination",
    );
  }
  if (fields.some((field) => field[1] === "expect")) {
    return rejection(
      "417 Expectation Failed",
      "Expect is not supported by the sandbox network proxy",
    );
  }
  try {
    const framing = httpRequestBodyFraming(fields);
    const outboundHeader = buildHttpOutboundHeader(method, parsed.path, version, fields);
    return { kind: "http", method, host: parsed.host, port: parsed.port, outboundHeader, framing };
  } catch (error) {
    if (error instanceof InvalidHttpRequestError) {
      return rejection("400 Bad Request", error.message);
    }
    throw error;
  }
}

function splitRequestLine(line: string): [string, string, string] | null {
  const first = line.indexOf(" ");
  const second = first < 0 ? -1 : line.indexOf(" ", first + 1);
  if (second < 0) {
    return null;
  }
  return [line.slice(0, first), line.slice(first + 1, second), line.slice(second + 1)];
}

function parseRequestHead(header: Buffer): ProxyRequest | ProxyRejection {
  if (header.length > MAX_HEADER_BYTES) {
    return rejection("431 Request Header Fields Too Large", "Proxy request headers are too large");
  }
  const [requestLine = "", ...headerLines] = header.toString("latin1").split("\r\n");
  const parts = splitRequestLine(requestLine);
  if (parts === null) {
    return rejection("400 Bad Request", "Invalid proxy request line");
  }
  const [rawMethod, target, version] = parts;
  if (version !== "HTTP/1.0" && version !== "HTTP/1.1") {
    return rejection("400 Bad Request", "Unsupported HTTP version");
  }
  let fields: HttpHeaderField[];
  try {
    fields = parseHttpHeaderFields(headerLines);
  } catch (error) {
    if (error instanceof InvalidHttpHeaderError) {
      return rejection("400 Bad Request", error.message);
    }
    throw error;
  }
  const method = rawMethod.toUpperCase();
  return method === "CONNECT"
    ? parseConnectRequest(target)
    : parseHttpRequest(method, target, version, fields);
}

async function readProxyRequest(reader: ByteReader): Promise<ProxyRequest | ProxyRejection> {
  let header: Buffer;
  try {
    header = await reader.readUntil(HEADER_TERMINATOR);
  } catch (error) {
    if (isStreamReadFailure(error)) {
      return rejection("400 Bad Request", "Invalid proxy request");
    }
    throw error;
  }
  return parseRequestHead(header);
}

async function rejectByPolicy(client: net.Socket, request: ProxyRequest): Promise<void> {
  let detail = "";
  if (process.env[NETWORK_PROXY_ENV.recordDenials] === "1") {
    detail = ` (request ${recordDenial(request.host, request.port, request.method)})`;
  }
  await rejectRequest(
    client,
    "403 Forbidden",
    `Sandbox network policy denied ${request.host}:${request.port}${detail}`,
  );
}

async function tunnelConnect(
  reader: ByteReader,
  client: net.Socket,
  upstream: net.Socket,
  host: string,
): Promise<void> {
  await writeAll(client, Buffer.from("HTTP/1.1 200 Connection Established\r\n\r\n", "latin1"));
  const clientHello = await readTlsClientHello(reader);
  if (clientHello === null || clientHello[0] !== host) {
    upstream.destroy();
    client.destroy();
    return;
  }
  await writeAll(upstream, clientHello[1]);
  await Promise.all([relay(reader, upstream), relay(new ByteReader(upstream), client)]);
}

async function forwardHttp(
  reader: ByteReader,
  client: net.Socket,
  upstream: net.Socket,
  request: HttpProxyRequest,
): Promise<void> {
  await writeAll(upstream, request.outboundHeader);
  try {
    if (request.framing.mode === "chunked") {
      await copyChunkedRequestBody(reader, upstream);
    } else {
      await copyExactRequestBytes(reader, upstream, request.framing.length);
    }
  } catch (error) {
    if (!isStreamReadFailure(error) && !(error instanceof InvalidHttpBodyError)) {
      throw error;
    }
    upstream.destroy();
    await rejectRequest(client, "400 Bad Request", error.message || "Invalid HTTP request body");
    return;
  }
  upstream.end();
  try {
    // One request per client connection is intentional. Relaying arbitrary
    // remaining client bytes would let a pipelined request bypass the next
    // destination/Host policy check.
    await relay(new ByteReader(upstream), client);
  } finally {
    upstream.destroy();
  }
}

async function serveProxyRequest(reader: ByteReader, client: net.Socket): Promise<void> {
  const request = await readProxyRequest(reader);
  if ("reject" in request) {
    await rejectRequest(client, request.status, request.body);
    return;
  }
  if (net.isIP(request.host) !== 0) {
    const body = "IP-literal destinations are not allowed by sandbox network policy";
    await rejectRequest(client, "403 Forbidden", body);
    return;
  }
  if (!networkProxyDeps.policyAllows(request.host, request.port)) {
    await rejectByPolicy(client, request);
    return;
  }
  const resolved = await networkProxyDeps.resolvePublic(request.host, request.port);
  const upstream = resolved ? await networkProxyDeps.openPublic(resolved, request.port) : null;
  if (upstream === null) {
    const body = "Destination did not resolve exclusively to public addresses";
    await rejectRequest(client, "403 Forbidden", body);
    return;
  }
  if (request.kind === "connect") {
    await tunnelConnect(reader, client, upstream, request.host);
    return;
  }
  await forwardHttp(reader, client, upstream, request);
}

export async function handleProxy(client: net.Socket): Promise<void> {
  const reader = new ByteReader(client);
  try {
    await serveProxyRequest(reader, client);
  } catch {
    client.destroy();
  }
}

export async function serveNetworkProxy(
  port = NETWORK_PROXY_PORT,
  host = "0.0.0.0",
): Promise<net.Server> {
  withPolicyDb(() => undefined);
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    void handleProxy(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  return server;
}

function runDecideCommand(args: readonly string[]): number {
  const positional: string[] = [];
  let ttl = 300;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const inline = arg.startsWith("--ttl=") ? arg.slice("--ttl=".length) : undefined;
    if (arg !== "--ttl" && inline === undefined) {
      positional.push(arg);
      continue;
    }
    const value = inline ?? args[++index];
    if (!value || !/^-?[0-9]+$/u.test(value)) {
      return 2;
    }
    ttl = Number.parseInt(value, 10);
  }
  const [requestId, decision] = positional;
  if (positional.length !== 2 || !requestId || !isNetworkPolicyDecision(decision)) {
    return 2;
  }
  return decide(requestId, decision, ttl) ? 0 : 2;
}

export async function runNetworkProxyCli(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "serve") {
    await serveNetworkProxy();
    return 0;
  }
  if (command === "pending") {
    process.stdout.write(`${JSON.stringify(pendingEvents())}\n`);
    return 0;
  }
  if (command === "deny-pending") {
    process.stdout.write(`${denyPendingEvents()}\n`);
    return 0;
  }
  if (command === "decide") {
    return runDecideCommand(rest);
  }
  process.stderr.write("usage: network-proxy {serve,pending,deny-pending,decide} ...\n");
  return 2;
}

function isNetworkProxyEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isNetworkProxyEntrypoint()) {
  void runNetworkProxyCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
