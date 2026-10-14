/**
 * Codex on demand. Release builds ship only the small @openai/codex launcher;
 * the platform package with the native binaries (about 318 MiB on disk) comes
 * from one of these, in order:
 *
 * 1. a codex the user installed on PATH that meets the supported minimum;
 * 2. the platform package next to the launcher (source checkouts, older builds);
 * 3. a per-user copy downloaded on first use from the pinned npm tarball,
 *    verified against the SHA-256 pinned in on-demand-assets.ts before any file
 *    is unpacked or made executable, then reused by every later engine.
 *
 * While none is available (offline, refused digest, unsupported platform) the
 * status names the reason, and starting Codex fails with that reason instead
 * of a missing-binary error from the launcher.
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod as fsChmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import { parse as parseSemver } from "semver";
import { resolveCodexDownloadAsset, type CodexDownloadAsset } from "./on-demand-assets.js";
import { MIN_SUPPORTED_CODEX_APP_SERVER_VERSION } from "./version.js";

export type CodexRuntimeSource = "path" | "bundled" | "downloaded";

export type CodexRuntimeUnavailableReason =
  | "not-downloaded"
  | "offline"
  | "digest-mismatch"
  | "unsupported-platform"
  | "download-failed"
  | "install-failed";

export type CodexRuntimeStatus =
  | { state: "ready"; source: CodexRuntimeSource; command: string; version?: string }
  | { state: "download"; reason: "not-downloaded"; version: string; bytes: number; message: string }
  | { state: "downloading"; version: string; bytes: number; received: number; message: string }
  | {
      state: "unavailable";
      reason: Exclude<CodexRuntimeUnavailableReason, "not-downloaded">;
      version?: string;
      bytes?: number;
      message: string;
    };

/** Codex cannot start yet; the message is written for the person using Branch Agent. */
export class CodexRuntimeUnavailableError extends Error {
  readonly reason: CodexRuntimeUnavailableReason;

  constructor(
    reason: CodexRuntimeUnavailableReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "CodexRuntimeUnavailableError";
    this.reason = reason;
  }
}

export type CodexOnDemandDeps = {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  env?: NodeJS.ProcessEnv;
  /** Per-user folder that holds downloaded tools (the Branch Agent state dir). */
  stateDir: () => string;
  /** The bundled @openai/codex launcher entrypoint (bin/codex.js), copied beside the download. */
  launcherEntrypoint: () => string | undefined;
  /** Whether the bundled launcher still has its platform package (source checkouts). */
  bundledReady?: (launcher: string) => boolean;
  fetch?: typeof fetch;
  /** Runs "<command> --version" and returns stdout, or undefined when it fails. */
  readVersion?: (command: string) => Promise<string | undefined>;
  chmod?: (file: string, mode: number) => Promise<void>;
  /** Override the pinned asset (tests); null means this platform has none. */
  asset?: CodexDownloadAsset | null;
  now?: () => number;
};

export type CodexOnDemand = {
  /** A codex on PATH at or above the supported minimum, or undefined. */
  findPathCommand(): Promise<{ command: string; version: string } | undefined>;
  /** The downloaded launcher when a verified copy is installed; never downloads. */
  installedLauncher(): Promise<string | undefined>;
  /** The downloaded launcher, downloading and verifying it first when needed. */
  ensureLauncher(): Promise<string>;
  /** What Codex would run now, or why it cannot. Never downloads. */
  status(): Promise<CodexRuntimeStatus>;
  /** Folder the verified download lives in. */
  storeDir(): string | undefined;
};

const PATH_CACHE_MS = 60_000;
const RECEIPT = "codex-install.json";
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

type DownloadProgress = { received: number };

/** Builds the on-demand resolver. One download runs at a time; callers share it. */
export function createCodexOnDemand(deps: CodexOnDemandDeps): CodexOnDemand {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const env = deps.env ?? process.env;
  const asset =
    deps.asset === null ? undefined : (deps.asset ?? resolveCodexDownloadAsset(platform, arch));
  const doFetch = deps.fetch ?? globalThis.fetch;
  const readVersion = deps.readVersion ?? defaultReadVersion;
  const chmod = deps.chmod ?? ((file: string, mode: number) => fsChmod(file, mode));
  const now = deps.now ?? Date.now;
  let pathCache:
    | { key: string; at: number; found?: { command: string; version: string } }
    | undefined;
  let inFlight: { promise: Promise<string>; progress: DownloadProgress } | undefined;
  let lastFailure: CodexRuntimeUnavailableError | undefined;

  const storeDir = () =>
    asset
      ? path.join(deps.stateDir(), "tools", "codex", `${asset.version}-${asset.target}`)
      : undefined;

  async function findPathCommand() {
    const key = env.PATH ?? env.Path ?? "";
    if (pathCache && pathCache.key === key && now() - pathCache.at < PATH_CACHE_MS) {
      return pathCache.found;
    }
    let found: { command: string; version: string } | undefined;
    for (const candidate of pathCandidates(key, platform)) {
      if (!(await isExecutable(candidate, platform))) {
        continue;
      }
      const version = parseCodexVersion(await readVersion(candidate));
      if (version && meetsMinimum(version)) {
        found = { command: candidate, version };
        break;
      }
    }
    pathCache = { key, at: now(), ...(found ? { found } : {}) };
    return found;
  }

  async function installedLauncher() {
    const dir = storeDir();
    if (!asset || !dir) {
      return undefined;
    }
    try {
      const receipt = JSON.parse(await readFile(path.join(dir, RECEIPT), "utf8")) as {
        sha256?: unknown;
      };
      if (receipt.sha256 !== asset.sha256) {
        return undefined;
      }
      const launcher = storeLauncherPath(dir);
      await access(launcher, fsConstants.F_OK);
      await access(storeNativePath(dir, asset, platform), executableMode(platform));
      return launcher;
    } catch {
      return undefined;
    }
  }

  async function ensureLauncher() {
    const installed = await installedLauncher();
    if (installed) {
      return installed;
    }
    if (!asset) {
      throw unsupportedPlatformError(platform, arch);
    }
    if (!inFlight) {
      const progress: DownloadProgress = { received: 0 };
      const promise = downloadAndInstall({
        asset,
        dir: storeDir()!,
        launcher: deps.launcherEntrypoint(),
        fetch: doFetch,
        chmod,
        platform,
        progress,
      }).then(
        (launcher) => {
          lastFailure = undefined;
          return launcher;
        },
        (error: unknown) => {
          lastFailure =
            error instanceof CodexRuntimeUnavailableError
              ? error
              : new CodexRuntimeUnavailableError(
                  "install-failed",
                  `Codex ${asset.version} could not be installed: ${describe(error)}. Nothing was kept. ${retryHint()}`,
                  { cause: error },
                );
          throw lastFailure;
        },
      );
      const current = { promise, progress };
      inFlight = current;
      const clear = () => {
        if (inFlight === current) {
          inFlight = undefined;
        }
      };
      promise.then(clear, clear);
    }
    return inFlight.promise;
  }

  async function status(): Promise<CodexRuntimeStatus> {
    const onPath = await findPathCommand();
    if (onPath) {
      return { state: "ready", source: "path", command: onPath.command, version: onPath.version };
    }
    const bundled = deps.launcherEntrypoint();
    if (bundled && deps.bundledReady?.(bundled)) {
      return {
        state: "ready",
        source: "bundled",
        command: bundled,
        ...(asset ? { version: asset.version } : {}),
      };
    }
    const installed = await installedLauncher();
    if (installed && asset) {
      return { state: "ready", source: "downloaded", command: installed, version: asset.version };
    }
    if (!asset) {
      return {
        state: "unavailable",
        reason: "unsupported-platform",
        message: unsupportedPlatformError(platform, arch).message,
      };
    }
    if (inFlight) {
      const percent = Math.min(99, Math.floor((inFlight.progress.received / asset.bytes) * 100));
      return {
        state: "downloading",
        version: asset.version,
        bytes: asset.bytes,
        received: inFlight.progress.received,
        message: `Downloading Codex ${asset.version} (${formatMegabytes(asset.bytes)}): ${percent}%.`,
      };
    }
    if (lastFailure && lastFailure.reason !== "not-downloaded") {
      return {
        state: "unavailable",
        reason: lastFailure.reason,
        version: asset.version,
        bytes: asset.bytes,
        message: lastFailure.message,
      };
    }
    return {
      state: "download",
      reason: "not-downloaded",
      version: asset.version,
      bytes: asset.bytes,
      message: `Codex ${asset.version} downloads the first time you use it (${formatMegabytes(asset.bytes)}). Or install Codex ${MIN_SUPPORTED_CODEX_APP_SERVER_VERSION} or newer on your PATH.`,
    };
  }

  return { findPathCommand, installedLauncher, ensureLauncher, status, storeDir };
}

/** Path of the copied launcher inside a store folder. */
export function storeLauncherPath(dir: string): string {
  return path.join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
}

function storeNativePath(
  dir: string,
  asset: CodexDownloadAsset,
  platform: NodeJS.Platform,
): string {
  return path.join(
    dir,
    "node_modules",
    ...asset.packageName.split("/"),
    "vendor",
    asset.triple,
    "bin",
    platform === "win32" ? "codex.exe" : "codex",
  );
}

/** "codex-cli 0.160.0" (or a bare version) to "0.160.0". */
export function parseCodexVersion(output: string | undefined): string | undefined {
  return /\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u.exec(output ?? "")?.[1];
}

function meetsMinimum(version: string): boolean {
  const parsed = parseSemver(version);
  return parsed !== null && parsed.compare(MIN_SUPPORTED_CODEX_APP_SERVER_VERSION) >= 0;
}

function pathCandidates(searchPath: string, platform: NodeJS.Platform): string[] {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const names = platform === "win32" ? ["codex.exe", "codex.cmd"] : ["codex"];
  const result: string[] = [];
  for (const dir of searchPath.split(platform === "win32" ? ";" : ":")) {
    const trimmed = dir.trim().replace(/^"(.*)"$/u, "$1");
    if (!trimmed || !pathApi.isAbsolute(trimmed)) {
      continue;
    }
    for (const name of names) {
      result.push(pathApi.join(trimmed, name));
    }
  }
  return result;
}

function executableMode(platform: NodeJS.Platform): number {
  return platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK;
}

async function isExecutable(file: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(file, executableMode(platform));
    return true;
  } catch {
    return false;
  }
}

function defaultReadVersion(command: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      command,
      ["--version"],
      {
        timeout: 5_000,
        windowsHide: true,
        shell: process.platform === "win32" && /\.cmd$/iu.test(command),
      },
      (error, stdout) => resolve(error ? undefined : String(stdout)),
    );
  });
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function retryHint(): string {
  return `Try again, or install Codex ${MIN_SUPPORTED_CODEX_APP_SERVER_VERSION} or newer on your PATH.`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unsupportedPlatformError(platform: string, arch: string): CodexRuntimeUnavailableError {
  return new CodexRuntimeUnavailableError(
    "unsupported-platform",
    `Codex has no download for ${platform}-${arch}. Install Codex ${MIN_SUPPORTED_CODEX_APP_SERVER_VERSION} or newer on your PATH to use it.`,
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
  asset: CodexDownloadAsset;
  dir: string;
  launcher: string | undefined;
  fetch: typeof fetch;
  chmod: (file: string, mode: number) => Promise<void>;
  platform: NodeJS.Platform;
  progress: DownloadProgress;
};

async function downloadAndInstall(params: InstallParams): Promise<string> {
  const { asset, dir, platform } = params;
  if (!params.launcher) {
    throw new CodexRuntimeUnavailableError(
      "install-failed",
      "The Codex launcher is missing from this Branch Agent install. Reinstall or update Branch Agent.",
    );
  }
  const parent = path.dirname(dir);
  await mkdir(parent, { recursive: true });
  const work = path.join(parent, `.download-${randomUUID()}`);
  await mkdir(work, { recursive: true });
  try {
    const tarball = path.join(work, "codex.tgz");
    const digest = await downloadTo(tarball, params);
    if (digest.sha256 !== asset.sha256 || digest.bytes !== asset.bytes) {
      throw new CodexRuntimeUnavailableError(
        "digest-mismatch",
        `Codex ${asset.version} download was refused: its SHA-256 ${digest.sha256} (${digest.bytes} bytes) does not match the digest pinned for ${asset.target}. Nothing was installed or run. ${retryHint()}`,
      );
    }
    // Verified: only now are files unpacked, and only unpacked files become executable.
    const stage = path.join(work, "stage");
    const packageRoot = path.join(stage, "node_modules", ...asset.packageName.split("/"));
    const executables = await extractPackageTarball(tarball, packageRoot);
    if (platform !== "win32") {
      for (const file of executables) {
        await params.chmod(file, 0o755);
      }
    }
    await access(storeNativePath(stage, asset, platform), fsConstants.F_OK);
    const launcherRoot = path.join(stage, "node_modules", "@openai", "codex");
    await mkdir(path.join(launcherRoot, "bin"), { recursive: true });
    const sourceRoot = path.dirname(path.dirname(params.launcher));
    await copyFile(path.join(sourceRoot, "package.json"), path.join(launcherRoot, "package.json"));
    await copyFile(params.launcher, path.join(launcherRoot, "bin", "codex.js"));
    await writeFile(
      path.join(stage, "package.json"),
      JSON.stringify({ name: "branch-agent-codex-runtime", private: true }, null, 2) + "\n",
    );
    const receipt = {
      version: asset.version,
      target: asset.target,
      url: asset.url,
      sha256: asset.sha256,
      bytes: asset.bytes,
      installedAt: new Date().toISOString(),
    };
    await writeFile(path.join(stage, RECEIPT), JSON.stringify(receipt, null, 2) + "\n");
    await rm(dir, { recursive: true, force: true });
    await rename(stage, dir);
    await pruneOtherVersions(parent, path.basename(dir));
    // Other Branch Agent parts that run Codex (the ACP adapter) read this to find the verified copy.
    const current = {
      version: asset.version,
      launcher: storeLauncherPath(dir),
      native: storeNativePath(dir, asset, platform),
    };
    await writeFile(path.join(parent, CURRENT), JSON.stringify(current, null, 2) + "\n");
    return storeLauncherPath(dir);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function offlineError(asset: CodexDownloadAsset, code: string, cause: unknown) {
  return new CodexRuntimeUnavailableError(
    "offline",
    `Codex isn't downloaded yet and this computer looks offline (${code}). Branch Agent downloads Codex ${asset.version} (${formatMegabytes(asset.bytes)}) the first time it's used. Connect to the internet and try again, or install Codex ${MIN_SUPPORTED_CODEX_APP_SERVER_VERSION} or newer on your PATH.`,
    { cause },
  );
}

async function downloadTo(
  file: string,
  params: InstallParams,
): Promise<{ sha256: string; bytes: number }> {
  const { asset } = params;
  let response: Response;
  try {
    response = await params.fetch(asset.url, { signal: AbortSignal.timeout(30 * 60_000) });
  } catch (error) {
    const code = networkCode(error);
    if (code && OFFLINE_CODES.has(code)) {
      throw offlineError(asset, code, error);
    }
    throw new CodexRuntimeUnavailableError(
      "download-failed",
      `Codex ${asset.version} could not be downloaded: ${describe(error)}. ${retryHint()}`,
      { cause: error },
    );
  }
  if (!response.ok || !response.body) {
    throw new CodexRuntimeUnavailableError(
      "download-failed",
      `Codex ${asset.version} could not be downloaded: the server answered ${response.status}. ${retryHint()}`,
    );
  }
  const hash = createHash("sha256");
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      params.progress.received = bytes;
      if (bytes > asset.bytes) {
        callback(
          new CodexRuntimeUnavailableError(
            "digest-mismatch",
            `Codex ${asset.version} download was refused: it is larger than the pinned ${asset.bytes} bytes. Nothing was installed or run. ${retryHint()}`,
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
    );
  } catch (error) {
    if (error instanceof CodexRuntimeUnavailableError) {
      throw error;
    }
    const code = networkCode(error);
    if (code && OFFLINE_CODES.has(code)) {
      throw offlineError(asset, code, error);
    }
    throw new CodexRuntimeUnavailableError(
      "download-failed",
      `Codex ${asset.version} download stopped: ${describe(error)}. ${retryHint()}`,
      { cause: error },
    );
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function pruneOtherVersions(parent: string, keep: string): Promise<void> {
  for (const entry of await readdir(parent).catch(() => [] as string[])) {
    if (entry !== keep && entry !== CURRENT && !entry.startsWith(".")) {
      await rm(path.join(parent, entry), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

type TarEntry = {
  remaining: number;
  padding: number;
  kind: "file" | "pax" | "longname" | "skip";
  out?: FileHandle;
  memory?: Buffer[];
};

/**
 * Unpacks an npm package tarball (entries under "package/") into root. Files are
 * written without execute bits; the paths that had them are returned so the
 * caller marks them executable. Links, devices and paths outside root are refused.
 */
export async function extractPackageTarball(tarball: string, root: string): Promise<string[]> {
  await mkdir(root, { recursive: true });
  const executables: string[] = [];
  let pending: Buffer = Buffer.alloc(0);
  let entry: TarEntry | undefined;
  let skip = 0;
  let paxPath: string | undefined;
  let longName: string | undefined;
  let ended = false;

  const finishEntry = async (current: TarEntry) => {
    await current.out?.close();
    if (current.kind === "pax" && current.memory) {
      paxPath = parsePaxPath(Buffer.concat(current.memory).toString("utf8"));
    } else if (current.kind === "longname" && current.memory) {
      longName = Buffer.concat(current.memory).toString("utf8").replace(/\0.*$/su, "");
    }
    skip = current.padding;
    entry = undefined;
  };

  try {
    for await (const chunk of createReadStream(tarball).pipe(createGunzip())) {
      pending = pending.length ? Buffer.concat([pending, chunk as Buffer]) : (chunk as Buffer);
      while (!ended) {
        if (entry) {
          if (entry.remaining > 0) {
            if (pending.length === 0) {
              break;
            }
            const take = pending.subarray(0, Math.min(entry.remaining, pending.length));
            pending = pending.subarray(take.length);
            entry.remaining -= take.length;
            if (entry.out) {
              await entry.out.write(take);
            } else if (entry.memory) {
              entry.memory.push(Buffer.from(take));
            }
          }
          if (entry.remaining === 0) {
            await finishEntry(entry);
          }
          continue;
        }
        if (skip > 0) {
          if (pending.length === 0) {
            break;
          }
          const drop = Math.min(skip, pending.length);
          pending = pending.subarray(drop);
          skip -= drop;
          continue;
        }
        if (pending.length < 512) {
          break;
        }
        const header = pending.subarray(0, 512);
        pending = pending.subarray(512);
        if (header.every((byte) => byte === 0)) {
          ended = true;
          break;
        }
        const size = readOctal(header, 124, 12);
        const padding = (512 - (size % 512)) % 512;
        const type = String.fromCharCode(header[156] || 48);
        if (type === "x") {
          entry = { remaining: size, padding, kind: "pax", memory: [] };
          continue;
        }
        if (type === "g") {
          entry = { remaining: size, padding, kind: "skip" };
          continue;
        }
        if (type === "L") {
          entry = { remaining: size, padding, kind: "longname", memory: [] };
          continue;
        }
        const name = paxPath ?? longName ?? readHeaderName(header);
        paxPath = undefined;
        longName = undefined;
        const relative = packageRelativePath(name);
        if (type === "5") {
          await mkdir(path.join(root, relative), { recursive: true });
          entry = { remaining: size, padding, kind: "skip" };
          continue;
        }
        if (type !== "0" && type !== "7") {
          throw new Error(`refusing tar entry ${name} of type ${JSON.stringify(type)}`);
        }
        const target = path.join(root, relative);
        await mkdir(path.dirname(target), { recursive: true });
        const out = await open(target, "w", 0o644);
        if ((readOctal(header, 100, 8) & 0o111) !== 0) {
          executables.push(target);
        }
        entry = { remaining: size, padding, kind: "file", out };
      }
      if (ended) {
        break;
      }
    }
  } finally {
    await entry?.out?.close().catch(() => undefined);
  }
  if (entry && entry.remaining > 0) {
    throw new Error("The Codex download ended in the middle of a file.");
  }
  return executables;
}

function readOctal(header: Buffer, offset: number, length: number): number {
  const field = header.subarray(offset, offset + length);
  if ((field[0] ?? 0) & 0x80) {
    let value = 0;
    for (let index = 1; index < field.length; index += 1) {
      value = value * 256 + (field[index] ?? 0);
    }
    return value;
  }
  const text = field.toString("ascii").replace(/\0.*$/su, "").trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function readHeaderName(header: Buffer): string {
  const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/su, "");
  const magic = header.subarray(257, 262).toString("ascii");
  const prefix =
    magic === "ustar" ? header.subarray(345, 500).toString("utf8").replace(/\0.*$/su, "") : "";
  return prefix ? prefix + "/" + name : name;
}

function parsePaxPath(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const match = /^\d+ path=(.*)$/su.exec(line);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function packageRelativePath(name: string): string {
  const normalized = path.posix.normalize(name.replace(/\\/gu, "/"));
  const relative = normalized.startsWith("package/") ? normalized.slice("package/".length) : "";
  if (
    !relative ||
    normalized.includes("\0") ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.posix.isAbsolute(relative)
  ) {
    throw new Error(`refusing tar entry outside the package: ${name}`);
  }
  return relative;
}
