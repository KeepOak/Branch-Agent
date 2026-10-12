// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/community/aio_sandbox/network_proxy.py (atlas SAFETY-0044)
/**
 * Strict HTTP/1.x request framing and TLS ClientHello parsing for the proxy sidecar.
 * Node builtins only.
 */
import type { Readable, Writable } from "node:stream";
import { normalizeHost } from "./network-proxy-policy.js";

export const MAX_HEADER_BYTES = 65_536;
export const IO_TIMEOUT_MS = 15_000;
export const RELAY_CHUNK_BYTES = 65_536;
const LINE_TERMINATOR = Buffer.from("\r\n", "latin1");
const HTTP_TOKEN_CHARS = new Set(
  "!#$%&'*+-.^_`|~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
);

export class InvalidHttpRequestError extends Error {}
export class InvalidHttpBodyError extends InvalidHttpRequestError {}
export class InvalidHttpHeaderError extends InvalidHttpRequestError {}
export class IncompleteReadError extends Error {}
export class LimitOverrunError extends Error {}
export class ReadTimeoutError extends Error {}

export function isStreamReadFailure(error: unknown): error is Error {
  return (
    error instanceof IncompleteReadError ||
    error instanceof LimitOverrunError ||
    error instanceof ReadTimeoutError
  );
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onLate?: (value: T) => void,
) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new ReadTimeoutError("Timed out"));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) {
          onLate?.(value);
          return;
        }
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (!settled) {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
  });
}

/** Buffered reader with asyncio StreamReader semantics over any readable byte stream. */
export class ByteReader {
  private buffer = Buffer.alloc(0);
  private ended = false;
  private failure: Error | undefined;
  private wake: (() => void) | undefined;
  private readonly source: Readable;
  private readonly limit: number;

  constructor(source: Readable, limit = MAX_HEADER_BYTES) {
    this.source = source;
    this.limit = limit;
    source.on("data", (chunk: Buffer | string) => {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
      if (this.buffer.length > this.limit * 2) {
        source.pause();
      }
      this.notify();
    });
    source.once("end", () => this.finish());
    source.once("close", () => this.finish());
    source.once("error", (error: Error) => {
      this.failure = error;
      this.notify();
    });
  }

  private finish(): void {
    this.ended = true;
    this.notify();
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  /** Waits for more bytes; false means end of stream. */
  private async waitForData(): Promise<boolean> {
    if (this.failure) {
      throw this.failure;
    }
    if (this.ended) {
      return false;
    }
    this.source.resume();
    await new Promise<void>((resolve) => {
      this.wake = resolve;
    });
    return true;
  }

  private take(length: number): Buffer {
    const chunk = Buffer.from(this.buffer.subarray(0, length));
    this.buffer = this.buffer.subarray(length);
    return chunk;
  }

  private async untilImpl(separator: Buffer): Promise<Buffer> {
    for (;;) {
      const index = this.buffer.indexOf(separator);
      if (index >= 0) {
        if (index > this.limit) {
          throw new LimitOverrunError("Separator found beyond the stream limit");
        }
        return this.take(index + separator.length);
      }
      if (this.buffer.length > this.limit) {
        throw new LimitOverrunError("Separator not found within the stream limit");
      }
      if (!(await this.waitForData())) {
        throw new IncompleteReadError("Stream ended before the separator");
      }
    }
  }

  async readUntil(separator: Buffer, timeoutMs = IO_TIMEOUT_MS): Promise<Buffer> {
    return await withTimeout(this.untilImpl(separator), timeoutMs);
  }

  private async exactlyImpl(length: number): Promise<Buffer> {
    while (this.buffer.length < length) {
      if (!(await this.waitForData())) {
        throw new IncompleteReadError("Stream ended before the expected length");
      }
    }
    return this.take(length);
  }

  async readExactly(length: number, timeoutMs = IO_TIMEOUT_MS): Promise<Buffer> {
    return await withTimeout(this.exactlyImpl(length), timeoutMs);
  }

  /** Returns up to `max` bytes, or an empty buffer at end of stream. */
  async read(max = RELAY_CHUNK_BYTES): Promise<Buffer> {
    while (this.buffer.length === 0) {
      if (!(await this.waitForData())) {
        return Buffer.alloc(0);
      }
    }
    return this.take(Math.min(max, this.buffer.length));
  }
}

export type ByteWriter = Pick<Writable, "write" | "once">;

export async function writeAll(writer: ByteWriter, chunk: Buffer): Promise<void> {
  if (!writer.write(chunk)) {
    await new Promise<void>((resolve) => {
      writer.once("drain", resolve);
      writer.once("close", resolve);
    });
  }
}

export type HttpHeaderField = readonly [rawName: string, name: string, value: string];

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if ((code < 0x20 && char !== "\t") || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Parse one header block using a single strict field-name grammar. */
export function parseHttpHeaderFields(headerLines: readonly string[]): HttpHeaderField[] {
  const fields: HttpHeaderField[] = [];
  for (const line of headerLines) {
    if (!line) {
      continue;
    }
    if (line.startsWith(" ") || line.startsWith("\t") || !line.includes(":")) {
      throw new InvalidHttpHeaderError("Obsolete or malformed HTTP headers are not supported");
    }
    const colon = line.indexOf(":");
    const rawName = line.slice(0, colon);
    const rawValue = line.slice(colon + 1);
    if (!rawName || [...rawName].some((char) => !HTTP_TOKEN_CHARS.has(char))) {
      throw new InvalidHttpHeaderError(
        "HTTP field names must use token characters followed immediately by a colon",
      );
    }
    if (hasControlCharacters(rawValue)) {
      throw new InvalidHttpHeaderError("HTTP field values cannot contain control characters");
    }
    fields.push([rawName, rawName.toLowerCase(), rawValue.replace(/^[ \t]+|[ \t]+$/gu, "")]);
  }
  return fields;
}

export type HttpBodyFraming = { mode: "chunked" | "fixed"; length: number };

export function fieldValues(fields: readonly HttpHeaderField[], name: string): string[] {
  return fields.filter((field) => field[1] === name).map((field) => field[2]);
}

/** Return the strictly validated framing for one HTTP proxy request. */
export function httpRequestBodyFraming(fields: readonly HttpHeaderField[]): HttpBodyFraming {
  const contentLengths = fieldValues(fields, "content-length");
  const transferEncodings = fieldValues(fields, "transfer-encoding").map((v) => v.toLowerCase());
  if (contentLengths.length > 0 && transferEncodings.length > 0) {
    throw new InvalidHttpBodyError("Content-Length and Transfer-Encoding cannot be combined");
  }
  if (transferEncodings.length > 0) {
    if (transferEncodings.length !== 1 || transferEncodings[0] !== "chunked") {
      throw new InvalidHttpBodyError("Only a single chunked Transfer-Encoding is supported");
    }
    return { mode: "chunked", length: 0 };
  }
  if (contentLengths.length === 0) {
    return { mode: "fixed", length: 0 };
  }
  const [value] = contentLengths;
  if (contentLengths.length !== 1 || value === undefined || !/^[0-9]+$/u.test(value)) {
    throw new InvalidHttpBodyError("Content-Length must be one non-negative decimal integer");
  }
  return { mode: "fixed", length: Number.parseInt(value, 10) };
}

const HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "upgrade",
];

/** Strip proxy/hop headers and force the one-request upstream connection closed. */
export function buildHttpOutboundHeader(
  method: string,
  path: string,
  version: string,
  fields: readonly HttpHeaderField[],
): Buffer {
  const connectionTokens = new Set(
    fieldValues(fields, "connection")
      .flatMap((value) => value.split(","))
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
  if ([...connectionTokens].some((token) => [...token].some((c) => !HTTP_TOKEN_CHARS.has(c)))) {
    throw new InvalidHttpHeaderError("Connection header options must use HTTP token characters");
  }
  if (["host", "content-length", "transfer-encoding"].some((name) => connectionTokens.has(name))) {
    throw new InvalidHttpBodyError("Connection cannot remove request framing headers");
  }
  const hop = new Set([...HOP_HEADERS, ...connectionTokens]);
  const kept = fields.filter((field) => !hop.has(field[1])).map((f) => `${f[0]}: ${f[2]}`);
  kept.push("Connection: close");
  return Buffer.from(`${method} ${path} ${version}\r\n${kept.join("\r\n")}\r\n\r\n`, "latin1");
}

export async function copyExactRequestBytes(
  reader: ByteReader,
  writer: ByteWriter,
  length: number,
) {
  let remaining = length;
  while (remaining > 0) {
    const chunk = await reader.readExactly(Math.min(remaining, RELAY_CHUNK_BYTES));
    await writeAll(writer, chunk);
    remaining -= chunk.length;
  }
}

async function copyChunkTrailers(reader: ByteReader, writer: ByteWriter, used: number) {
  let trailerBytes = used;
  for (;;) {
    const trailer = await reader.readUntil(LINE_TERMINATOR);
    trailerBytes += trailer.length;
    if (trailerBytes > MAX_HEADER_BYTES) {
      throw new InvalidHttpBodyError("Chunk trailers are too large");
    }
    const isEnd = trailer.equals(LINE_TERMINATOR);
    if (!isEnd && (trailer[0] === 0x20 || trailer[0] === 0x09 || !trailer.includes(0x3a))) {
      throw new InvalidHttpBodyError("Invalid chunk trailer");
    }
    await writeAll(writer, trailer);
    if (isEnd) {
      return;
    }
  }
}

/** Relay exactly one strictly framed chunked body, including its trailers. */
export async function copyChunkedRequestBody(reader: ByteReader, writer: ByteWriter) {
  for (;;) {
    const line = await reader.readUntil(LINE_TERMINATOR);
    if (line.length > MAX_HEADER_BYTES) {
      throw new InvalidHttpBodyError("Chunk header is too large");
    }
    const sizeToken = line.subarray(0, -2).toString("latin1").split(";", 1)[0]?.trim() ?? "";
    if (!sizeToken || !/^[0-9a-fA-F]+$/u.test(sizeToken)) {
      throw new InvalidHttpBodyError("Invalid chunk size");
    }
    const size = Number.parseInt(sizeToken, 16);
    await writeAll(writer, line);
    if (size === 0) {
      await copyChunkTrailers(reader, writer, line.length);
      return;
    }
    await copyExactRequestBytes(reader, writer, size);
    const terminator = await reader.readExactly(2);
    if (!terminator.equals(LINE_TERMINATOR)) {
      throw new InvalidHttpBodyError("Invalid chunk terminator");
    }
    await writeAll(writer, terminator);
  }
}

type SplitUrl = { scheme: string; netloc: string; path: string; query: string };

/** Subset of Python urllib.parse.urlsplit used by the upstream proxy. */
export function urlSplit(raw: string): SplitUrl | null {
  // oxlint-disable-next-line no-control-regex -- urlsplit strips leading C0 controls and spaces.
  const url = raw.replace(/^[\x00-\x20]+/u, "").replace(/[\t\r\n]/gu, "");
  let rest = url;
  let scheme = "";
  const colon = url.indexOf(":");
  if (colon > 0 && /^[A-Za-z][A-Za-z0-9+.-]*$/u.test(url.slice(0, colon))) {
    scheme = url.slice(0, colon).toLowerCase();
    rest = url.slice(colon + 1);
  }
  let netloc = "";
  if (rest.startsWith("//")) {
    const end = rest.slice(2).search(/[/?#]/u);
    netloc = end < 0 ? rest.slice(2) : rest.slice(2, end + 2);
    rest = end < 0 ? "" : rest.slice(end + 2);
    if (netloc.includes("[") !== netloc.includes("]")) {
      return null;
    }
  }
  rest = rest.split("#", 1)[0] ?? "";
  const question = rest.indexOf("?");
  const path = question < 0 ? rest : rest.slice(0, question);
  return { scheme, netloc, path, query: question < 0 ? "" : rest.slice(question + 1) };
}

function splitHostinfo(netloc: string): { hostname: string; port: string } {
  const hostinfo = netloc.slice(netloc.lastIndexOf("@") + 1);
  const open = hostinfo.indexOf("[");
  if (open >= 0) {
    const bracketed = hostinfo.slice(open + 1);
    const close = bracketed.indexOf("]");
    const after = close < 0 ? "" : bracketed.slice(close + 1);
    const portColon = after.indexOf(":");
    return {
      hostname: close < 0 ? bracketed : bracketed.slice(0, close),
      port: portColon < 0 ? "" : after.slice(portColon + 1),
    };
  }
  const colon = hostinfo.indexOf(":");
  return colon < 0
    ? { hostname: hostinfo, port: "" }
    : { hostname: hostinfo.slice(0, colon), port: hostinfo.slice(colon + 1) };
}

/** Python's SplitResult.port: null when absent, "invalid" when it would raise ValueError. */
export function netlocPort(netloc: string): number | null | "invalid" {
  const { port } = splitHostinfo(netloc);
  if (!port) {
    return null;
  }
  if (!/^[0-9]+$/u.test(port)) {
    return "invalid";
  }
  const value = Number.parseInt(port, 10);
  return value > 65_535 ? "invalid" : value;
}

export function netlocHostname(netloc: string): string | null {
  const { hostname } = splitHostinfo(netloc);
  return hostname ? hostname.toLowerCase() : null;
}

export function parseAuthority(authority: string, defaultPort: number): [string, number] | null {
  const parsed = urlSplit(`//${authority}`);
  if (!parsed) {
    return null;
  }
  const port = netlocPort(parsed.netloc);
  if (port === "invalid") {
    return null;
  }
  const host = normalizeHost(netlocHostname(parsed.netloc) ?? "");
  return host === null ? null : [host, port || defaultPort];
}

function uint16At(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buffer.length) {
    throw new RangeError("Truncated TLS field");
  }
  return buffer.readUInt16BE(offset);
}

function byteAt(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset >= buffer.length) {
    throw new RangeError("Truncated TLS field");
  }
  return buffer.readUInt8(offset);
}

function readServerName(extension: Buffer): { found: boolean; sni: string | null } {
  const namesSize = uint16At(extension, 0);
  let cursor = 2;
  while (cursor + 3 <= 2 + namesSize && cursor + 3 <= extension.length) {
    const nameType = byteAt(extension, cursor);
    const nameSize = uint16At(extension, cursor + 1);
    cursor += 3;
    if (cursor + nameSize > extension.length) {
      throw new RangeError("Truncated server name");
    }
    if (nameType === 0) {
      const raw = extension.subarray(cursor, cursor + nameSize);
      if (raw.some((byte) => byte > 0x7f)) {
        throw new RangeError("Non-ASCII server name");
      }
      return { found: true, sni: normalizeHost(raw.toString("ascii")) };
    }
    cursor += nameSize;
  }
  return { found: false, sni: null };
}

function parseHelloExtensions(hello: Buffer, start: number, end: number): string | null {
  let offset = start;
  let sni: string | null = null;
  while (offset + 4 <= end) {
    const extensionType = uint16At(hello, offset);
    const extensionSize = uint16At(hello, offset + 2);
    offset += 4;
    const extension = hello.subarray(offset, offset + extensionSize);
    offset += extensionSize;
    if (offset > end) {
      return null;
    }
    // Reject encrypted ClientHello: its hidden SNI cannot be compared
    // with the approved CONNECT host without TLS interception.
    if (extensionType === 0xfe0d || extensionType === 0xffce) {
      return null;
    }
    if (extensionType !== 0 || extension.length < 5) {
      continue;
    }
    const name = readServerName(extension);
    if (name.found) {
      sni = name.sni;
    }
  }
  return sni;
}

function parseClientHelloSni(hello: Buffer): string | null {
  try {
    let offset = 2 + 32;
    offset += 1 + byteAt(hello, offset);
    offset += 2 + uint16At(hello, offset);
    offset += 1 + byteAt(hello, offset);
    const extensionsSize = uint16At(hello, offset);
    offset += 2;
    const extensionsEnd = offset + extensionsSize;
    return extensionsEnd > hello.length ? null : parseHelloExtensions(hello, offset, extensionsEnd);
  } catch {
    return null;
  }
}

type HandshakeRecords = { wire: Buffer; hello: Buffer };

async function readHandshakeRecords(reader: ByteReader): Promise<HandshakeRecords | null> {
  const wire: Buffer[] = [];
  let wireLength = 0;
  let handshake = Buffer.alloc(0);
  let expected: number | null = null;
  while (wireLength <= MAX_HEADER_BYTES) {
    const header = await reader.readExactly(5);
    const recordSize = header.readUInt16BE(3);
    if (header[0] !== 22 || recordSize <= 0 || wireLength + 5 + recordSize > MAX_HEADER_BYTES) {
      return null;
    }
    const record = await reader.readExactly(recordSize);
    wire.push(header, record);
    wireLength += 5 + recordSize;
    handshake = Buffer.concat([handshake, record]);
    if (expected === null && handshake.length >= 4) {
      if (handshake[0] !== 1) {
        return null;
      }
      expected = 4 + handshake.readUIntBE(1, 3);
      if (expected > MAX_HEADER_BYTES) {
        return null;
      }
    }
    if (expected !== null && handshake.length >= expected) {
      break;
    }
  }
  return expected === null || handshake.length < expected
    ? null
    : { wire: Buffer.concat(wire), hello: handshake.subarray(4, expected) };
}

/** Read one TLS ClientHello and return its normalized SNI plus wire bytes. */
export async function readTlsClientHello(
  reader: ByteReader,
): Promise<readonly [string, Buffer] | null> {
  let records: HandshakeRecords | null;
  try {
    records = await readHandshakeRecords(reader);
  } catch (error) {
    if (error instanceof IncompleteReadError || error instanceof ReadTimeoutError) {
      return null;
    }
    throw error;
  }
  if (records === null) {
    return null;
  }
  const sni = parseClientHelloSni(records.hello);
  return sni === null ? null : [sni, records.wire];
}
