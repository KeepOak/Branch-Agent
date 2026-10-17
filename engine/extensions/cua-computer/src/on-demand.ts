/**
 * Computer use on demand. Release builds no longer ship the CUA Driver (the
 * SDK's native platform package and, on macOS, the cua-driver binary: about
 * 115 MiB on macOS). It comes from one of these, in order:
 *
 * 1. the packages bundled with this engine (source checkouts, older builds);
 * 2. a per-user copy, downloaded the first time computer use is turned on from
 *    the pinned archives in on-demand-assets.ts. Every archive is hashed while
 *    it streams to a temp file and checked against its pinned SHA-256 and size
 *    before anything is unpacked, made executable or run. The copy lives in
 *    <state dir>/tools/computer-use/<version>-<target>/ and every later engine
 *    (updates included) reuses it.
 *
 * While none is there, nothing fails silently: status() says "download" (not
 * downloaded yet, with its size), "downloading" (progress) or "unavailable"
 * with the reason (offline, refused digest, unsupported platform, failed
 * download), and loading the driver fails with that same sentence.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod as fsChmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  computerUseDownload,
  resolveComputerUseTarget,
  type ComputerUseDownload,
  type ComputerUseDownloadPart,
} from "./on-demand-assets.js";
import { extractTarball } from "./on-demand-tar.js";

export type ComputerUseUnavailableReason =
  | "not-downloaded"
  | "offline"
  | "digest-mismatch"
  | "unsupported-platform"
  | "download-failed"
  | "install-failed"
  | "cancelled";

export type ComputerUseRuntimeStatus =
  | { state: "ready"; source: "bundled" | "downloaded"; version?: string; root?: string }
  | { state: "download"; reason: "not-downloaded"; version: string; bytes: number; message: string }
  | {
      state: "downloading";
      version: string;
      bytes: number;
      received: number;
      percent: number;
      message: string;
    }
  | {
      state: "unavailable";
      reason: Exclude<ComputerUseUnavailableReason, "not-downloaded" | "cancelled">;
      version?: string;
      bytes?: number;
      message: string;
    };

/** Computer use cannot start yet; the message is written for the person using Branch Agent. */
export class ComputerUseUnavailableError extends Error {
  readonly reason: ComputerUseUnavailableReason;

  constructor(reason: ComputerUseUnavailableReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ComputerUseUnavailableError";
    this.reason = reason;
  }
}

export type ComputerUseOnDemandDeps = {
  platform?: NodeJS.Platform;
  arch?: string;
  linuxLibc?: "gnu" | "musl";
  /** Per-user folder that holds downloaded tools (the Branch Agent state dir). */
  stateDir: () => string;
  /** Whether this engine still bundles the SDK and its native package (source checkouts, older builds). */
  bundledReady?: () => boolean;
  fetch?: typeof fetch;
  chmod?: (file: string, mode: number) => Promise<void>;
  /** Override the pinned download (tests); null means this platform has none. */
  download?: ComputerUseDownload | null;
};

export type ComputerUseEnsureOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ComputerUseDownloadProgress) => void;
  /**
   * A refused download (its digest did not match the pins) is not fetched
   * again on its own; retry: true fetches it anyway. Any other failure
   * (offline, a failed download) tries again on the next use.
   */
  retry?: boolean;
};

export type ComputerUseDownloadProgress = {
  received: number;
  bytes: number;
  percent: number;
  message: string;
};

export type ComputerUseOnDemand = {
  /** The verified per-user copy's folder when one is installed; never downloads. */
  installedRoot(): Promise<string | undefined>;
  /** The per-user copy, downloading and verifying it first when needed. */
  ensureInstalled(options?: ComputerUseEnsureOptions): Promise<string>;
  /** Stops a running download and deletes its partial files; false when none was running. */
  cancel(): Promise<boolean>;
  /** What computer use would load now, or why it cannot. Never downloads. */
  status(): Promise<ComputerUseRuntimeStatus>;
  /** Folder the verified download lives in, undefined where there is none for this platform. */
  storeDir(): string | undefined;
};

export const COMPUTER_USE_DOWNLOAD_CANCELLED = "Cancelled";
export const COMPUTER_USE_RECEIPT = "computer-use-install.json";
const CURRENT = "current.json";
const OFFLINE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

type DownloadProgress = { received: number; notify?: () => void };

type InFlight = {
  promise: Promise<string>;
  progress: DownloadProgress;
  controller: AbortController;
  listeners: Set<(progress: ComputerUseDownloadProgress) => void>;
  waiters: number;
  kept: boolean;
};

function cancelledError(): ComputerUseUnavailableError {
  return new ComputerUseUnavailableError("cancelled", COMPUTER_USE_DOWNLOAD_CANCELLED);
}

function formatMegabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

const RETRY = "It tries again the next time computer use is used.";

/** "Getting computer use ready (62 MB)… 42%". */
export function computerUseDownloadProgress(
  download: Pick<ComputerUseDownload, "bytes">,
  received: number,
): ComputerUseDownloadProgress {
  const percent = Math.max(0, Math.min(99, Math.floor((received / download.bytes) * 100)));
  return {
    received,
    bytes: download.bytes,
    percent,
    message: `Getting computer use ready (${formatMegabytes(download.bytes)})… ${percent}%`,
  };
}

/** Where a package lives inside a store (or any node_modules root). */
export function storePackageDir(root: string, name: string): string {
  return path.join(root, "node_modules", ...name.split("/"));
}

/** Path of the SDK's package.json inside a store folder. */
export function storeSdkManifestPath(root: string): string {
  return path.join(storePackageDir(root, "@trycua/cua-driver"), "package.json");
}

function defaultLinuxLibc(): "gnu" | "musl" {
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: unknown } }
    | undefined;
  return typeof report?.header?.glibcVersionRuntime === "string" ? "gnu" : "musl";
}

/** Builds the on-demand resolver. One download runs at a time; callers share it. */
export function createComputerUseOnDemand(deps: ComputerUseOnDemandDeps): ComputerUseOnDemand {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const linuxLibc = platform === "linux" ? (deps.linuxLibc ?? defaultLinuxLibc()) : undefined;
  const target = resolveComputerUseTarget(platform, arch, linuxLibc);
  let download: ComputerUseDownload | undefined;
  if (deps.download !== undefined) {
    download = deps.download ?? undefined;
  } else if (target) {
    download = computerUseDownload(target);
  }
  const doFetch = deps.fetch ?? globalThis.fetch;
  const chmod = deps.chmod ?? ((file: string, mode: number) => fsChmod(file, mode));
  const host = `${platform}-${arch}${linuxLibc ? `-${linuxLibc}` : ""}`;
  let inFlight: InFlight | undefined;
  let lastFailure: ComputerUseUnavailableError | undefined;

  const storeDir = () =>
    download
      ? path.join(deps.stateDir(), "tools", "computer-use", `${download.version}-${download.target}`)
      : undefined;

  async function installedRoot() {
    const dir = storeDir();
    if (!download || !dir) {
      return undefined;
    }
    try {
      const receipt = JSON.parse(await readFile(path.join(dir, COMPUTER_USE_RECEIPT), "utf8")) as {
        parts?: unknown;
      };
      const pinned = download.parts.map((part) => part.sha256);
      if (JSON.stringify(receipt.parts) !== JSON.stringify(pinned)) {
        return undefined;
      }
      for (const part of download.parts) {
        const file =
          part.kind === "npm-package"
            ? path.join(storePackageDir(dir, part.name), "package.json")
            : path.join(dir, part.file);
        if (!(await stat(file)).isFile()) {
          return undefined;
        }
      }
      return dir;
    } catch {
      return undefined;
    }
  }

  async function ensureInstalled(options: ComputerUseEnsureOptions = {}) {
    const installed = await installedRoot();
    if (installed) {
      return installed;
    }
    if (!download) {
      throw unsupportedPlatformError(host);
    }
    if (options.signal?.aborted) {
      throw cancelledError();
    }
    if (!inFlight && lastFailure?.reason === "digest-mismatch" && options.retry !== true) {
      throw lastFailure;
    }
    if (!inFlight) {
      const active = download;
      const progress: DownloadProgress = { received: 0 };
      const controller = new AbortController();
      const listeners = new Set<(progress: ComputerUseDownloadProgress) => void>();
      progress.notify = () => {
        const shown = computerUseDownloadProgress(active, progress.received);
        for (const listener of listeners) {
          try {
            listener(shown);
          } catch {
            // A listener that fails must not stop the download.
          }
        }
      };
      const promise = downloadAndInstall({
        download: active,
        dir: storeDir()!,
        fetch: doFetch,
        chmod,
        platform,
        progress,
        signal: controller.signal,
      }).then(
        (root) => {
          lastFailure = undefined;
          return root;
        },
        (error: unknown) => {
          if (controller.signal.aborted) {
            // Cancelled: nothing was kept and computer use is simply not downloaded, not failed.
            lastFailure = undefined;
            throw cancelledError();
          }
          lastFailure =
            error instanceof ComputerUseUnavailableError
              ? error
              : new ComputerUseUnavailableError(
                  "install-failed",
                  `Computer use could not be installed: ${describe(error)}. Nothing was kept. ${RETRY}`,
                  { cause: error },
                );
          throw lastFailure;
        },
      );
      const current: InFlight = { promise, progress, controller, listeners, waiters: 0, kept: false };
      inFlight = current;
      const clear = () => {
        if (inFlight === current) {
          inFlight = undefined;
        }
      };
      promise.then(clear, clear);
    }
    return waitFor(inFlight, options);
  }

  function waitFor(current: InFlight, options: ComputerUseEnsureOptions): Promise<string> {
    const { signal, onProgress } = options;
    if (onProgress) {
      current.listeners.add(onProgress);
    }
    if (!signal) {
      current.kept = true;
    } else {
      current.waiters += 1;
    }
    return new Promise<string>((resolve, reject) => {
      let done = false;
      const leave = () => {
        if (onProgress) {
          current.listeners.delete(onProgress);
        }
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (done) {
          return;
        }
        done = true;
        leave();
        current.waiters -= 1;
        if (current.waiters <= 0 && !current.kept) {
          current.controller.abort();
        }
        reject(cancelledError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      current.promise.then(
        (root) => {
          if (!done) {
            done = true;
            leave();
            resolve(root);
          }
        },
        (error: unknown) => {
          if (!done) {
            done = true;
            leave();
            reject(error);
          }
        },
      );
    });
  }

  async function cancel(): Promise<boolean> {
    const current = inFlight;
    if (!current) {
      return false;
    }
    current.controller.abort();
    // Resolve only once the fetch stopped and the partial files are gone.
    await current.promise.catch(() => undefined);
    return true;
  }

  async function status(): Promise<ComputerUseRuntimeStatus> {
    if (deps.bundledReady?.()) {
      return { state: "ready", source: "bundled", ...(download ? { version: download.version } : {}) };
    }
    const installed = await installedRoot();
    if (installed && download) {
      return { state: "ready", source: "downloaded", version: download.version, root: installed };
    }
    if (!download) {
      return {
        state: "unavailable",
        reason: "unsupported-platform",
        message: unsupportedPlatformError(host).message,
      };
    }
    if (inFlight && !inFlight.controller.signal.aborted) {
      const progress = computerUseDownloadProgress(download, inFlight.progress.received);
      return {
        state: "downloading",
        version: download.version,
        bytes: download.bytes,
        received: progress.received,
        percent: progress.percent,
        message: progress.message,
      };
    }
    if (lastFailure && lastFailure.reason !== "not-downloaded" && lastFailure.reason !== "cancelled") {
      return {
        state: "unavailable",
        reason: lastFailure.reason,
        version: download.version,
        bytes: download.bytes,
        message: lastFailure.message,
      };
    }
    return {
      state: "download",
      reason: "not-downloaded",
      version: download.version,
      bytes: download.bytes,
      message: `Computer use isn't downloaded yet. It downloads once (${formatMegabytes(download.bytes)}) the first time it's on, then every update reuses it.`,
    };
  }

  return { installedRoot, ensureInstalled, cancel, status, storeDir };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unsupportedPlatformError(host: string): ComputerUseUnavailableError {
  return new ComputerUseUnavailableError(
    "unsupported-platform",
    `Computer use has no download for ${host}. It runs on macOS, Windows and glibc-based Linux (x64 or ARM64).`,
  );
}

function networkCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

type InstallParams = {
  download: ComputerUseDownload;
  dir: string;
  fetch: typeof fetch;
  chmod: (file: string, mode: number) => Promise<void>;
  platform: NodeJS.Platform;
  progress: DownloadProgress;
  signal: AbortSignal;
};

async function downloadAndInstall(params: InstallParams): Promise<string> {
  const { download, dir, platform } = params;
  const parent = path.dirname(dir);
  await mkdir(parent, { recursive: true });
  await removeStalePartials(parent);
  const work = path.join(parent, `.download-${randomUUID()}`);
  await mkdir(work, { recursive: true });
  try {
    // 1. Download and verify every archive. Nothing is unpacked until all of them match their pins.
    const archives: Array<{ part: ComputerUseDownloadPart; file: string }> = [];
    let before = 0;
    for (const [index, part] of download.parts.entries()) {
      const file = path.join(work, `${index}.tgz`);
      const digest = await downloadTo(file, part, params, before);
      params.signal.throwIfAborted();
      if (digest.sha256 !== part.sha256 || digest.bytes !== part.bytes) {
        throw new ComputerUseUnavailableError(
          "digest-mismatch",
          `The computer-use download was refused: ${part.name} ${part.version} has SHA-256 ${digest.sha256} (${digest.bytes} bytes), not the digest pinned for ${download.target}. Nothing was installed or run.`,
        );
      }
      archives.push({ part, file });
      before += part.bytes;
    }
    // 2. Verified: only now are files unpacked, and only unpacked files become executable.
    const stage = path.join(work, "stage");
    for (const { part, file } of archives) {
      if (part.kind === "npm-package") {
        const executables = await extractTarball(file, storePackageDir(stage, part.name), {
          kind: "npm-package",
        });
        if (platform !== "win32") {
          for (const executable of executables) {
            await params.chmod(executable, 0o755);
          }
        }
        continue;
      }
      await extractTarball(file, stage, { kind: "only", files: [part.file] });
      const driver = path.join(stage, part.file);
      const actual = await sha256File(driver).catch(() => undefined);
      if (actual !== part.fileSha256) {
        throw new ComputerUseUnavailableError(
          "digest-mismatch",
          `The computer-use download was refused: ${part.file} inside the verified archive does not match its pinned SHA-256. Nothing was installed or run.`,
        );
      }
      await params.chmod(driver, 0o755);
    }
    await writeFile(
      path.join(stage, "package.json"),
      JSON.stringify({ name: "branch-agent-computer-use", private: true }, null, 2) + "\n",
    );
    const receipt = {
      version: download.version,
      target: download.target,
      parts: download.parts.map((part) => part.sha256),
      sources: download.parts.map((part) => ({ name: part.name, version: part.version, url: part.url, bytes: part.bytes })),
      installedAt: new Date().toISOString(),
    };
    await writeFile(path.join(stage, COMPUTER_USE_RECEIPT), JSON.stringify(receipt, null, 2) + "\n");
    await rm(dir, { recursive: true, force: true });
    await rename(stage, dir);
    await pruneOtherVersions(parent, path.basename(dir));
    // The desktop app reads this to start the macOS driver from the verified copy.
    const current = {
      version: download.version,
      target: download.target,
      root: dir,
      ...(download.parts.some((part) => part.kind === "driver-archive")
        ? { driver: path.join(dir, "cua-driver") }
        : {}),
    };
    await writeFile(path.join(parent, CURRENT), JSON.stringify(current, null, 2) + "\n");
    return dir;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function offlineError(download: ComputerUseDownload, code: string, cause: unknown) {
  return new ComputerUseUnavailableError(
    "offline",
    `Computer use isn't downloaded yet and this computer looks offline (${code}). It needs a one-time download (${formatMegabytes(download.bytes)}). Connect to the internet: it tries again the next time computer use is used.`,
    { cause },
  );
}

async function downloadTo(
  file: string,
  part: ComputerUseDownloadPart,
  params: InstallParams,
  before: number,
): Promise<{ sha256: string; bytes: number }> {
  let response: Response;
  try {
    response = await params.fetch(part.url, {
      signal: AbortSignal.any([params.signal, AbortSignal.timeout(30 * 60_000)]),
    });
  } catch (error) {
    if (params.signal.aborted) {
      throw cancelledError();
    }
    const code = networkCode(error);
    if (code && OFFLINE_CODES.has(code)) {
      throw offlineError(params.download, code, error);
    }
    throw new ComputerUseUnavailableError(
      "download-failed",
      `Computer use could not be downloaded: ${describe(error)}. ${RETRY}`,
      { cause: error },
    );
  }
  if (!response.ok || !response.body) {
    throw new ComputerUseUnavailableError(
      "download-failed",
      `Computer use could not be downloaded: the server answered ${response.status} for ${part.name}. ${RETRY}`,
    );
  }
  const hash = createHash("sha256");
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      params.progress.received = before + Math.min(bytes, part.bytes);
      params.progress.notify?.();
      if (bytes > part.bytes) {
        callback(
          new ComputerUseUnavailableError(
            "digest-mismatch",
            `The computer-use download was refused: ${part.name} ${part.version} is larger than its pinned ${part.bytes} bytes. Nothing was installed or run.`,
          ),
        );
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
      counter,
      createWriteStream(file, { mode: 0o600 }),
      { signal: params.signal },
    );
  } catch (error) {
    if (params.signal.aborted) {
      throw cancelledError();
    }
    if (error instanceof ComputerUseUnavailableError) {
      throw error;
    }
    const code = networkCode(error);
    if (code && OFFLINE_CODES.has(code)) {
      throw offlineError(params.download, code, error);
    }
    throw new ComputerUseUnavailableError(
      "download-failed",
      `Computer use download stopped: ${describe(error)}. ${RETRY}`,
      { cause: error },
    );
  }
  return { sha256: hash.digest("hex"), bytes };
}

/** Partial downloads an engine left when it stopped mid-download (an app restart); an hour old is long abandoned. */
async function removeStalePartials(parent: string): Promise<void> {
  for (const entry of await readdir(parent).catch(() => [] as string[])) {
    if (!entry.startsWith(".download-")) {
      continue;
    }
    const folder = path.join(parent, entry);
    const changed = await stat(folder).then((info) => info.mtimeMs, () => Date.now());
    if (Date.now() - changed > 60 * 60_000) {
      await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function pruneOtherVersions(parent: string, keep: string): Promise<void> {
  for (const entry of await readdir(parent).catch(() => [] as string[])) {
    if (entry !== keep && entry !== CURRENT && !entry.startsWith(".")) {
      await rm(path.join(parent, entry), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
