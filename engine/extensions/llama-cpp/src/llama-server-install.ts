import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs, { type BigIntStats } from "node:fs";
import fsp, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { sha256File as hashFile } from "@openclaw/fs-safe/durability";
import { toErrorObject } from "branch/plugin-sdk/error-runtime";
import { asOptionalRecord } from "branch/plugin-sdk/string-coerce-runtime";
import { resolveLlamaCppDataDir } from "./defaults.js";
import {
  LLAMA_SERVER_BUILD,
  LLAMA_SERVER_COMMIT,
  LLAMA_SERVER_RELEASE,
  resolveManagedLlamaServerPaths,
  selectLlamaServerAsset,
  type LlamaServerArchive,
  type LlamaServerAsset,
  type LlamaServerDependency,
} from "./llama-server-assets.js";
import {
  extractLlamaServerArchive,
  extractLlamaServerDependencyArchive,
} from "./llama-server-extract.js";
import { extractWindowsVcRuntime } from "./llama-server-vc-runtime.js";
import {
  discardStagedPartial,
  hashStagedPrefix,
  isStagedFreshRetry,
  isStagedPartialKept,
  keepStagedPartial,
  openStagedPartial,
  resolveResumeOffset,
  resumableStartByte,
  retryStagedFresh,
  stagingMetaPath,
  stagingPartPath,
} from "./resumable-download.js";

const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const VERSION_TIMEOUT_MS = 15_000;
// Freshly extracted macOS binaries can spend tens of seconds in Gatekeeper
// evaluation. Keep this wider budget at the pre-publication version check;
// reused, post-publication, and CUDA probes retain the fast default.
const FRESH_VERSION_TIMEOUT_MS = 120_000;

export type LlamaDownloadProgress = (status: {
  downloadedSize: number;
  totalSize: number;
  bytesPerSecond: number;
}) => void;

const installationPromises = new Map<string, Promise<string>>();

function compareVersion(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function assertSupportedLinuxRuntime(asset: LlamaServerAsset): void {
  if (asset.platform !== "linux") {
    return;
  }
  const header = asOptionalRecord(asOptionalRecord(process.report?.getReport())?.header);
  const glibc = typeof header?.glibcVersionRuntime === "string" ? header.glibcVersionRuntime : "";
  if (!glibc) {
    throw new Error(
      "The verified Ubuntu llama-server build requires glibc and cannot run on musl/Alpine. Install llama-server manually for this host and configure its absolute path.",
    );
  }
  const minimum = asset.arch === "arm64" ? "2.38" : "2.34";
  if (compareVersion(glibc, minimum) < 0) {
    throw new Error(
      `The verified llama-server build requires glibc ${minimum}+ on Linux ${asset.arch}; this host has ${glibc}. Install a compatible llama-server manually and configure its absolute path.`,
    );
  }
}

function assetUrl(asset: Pick<LlamaServerArchive, "name" | "url">): string {
  return (
    asset.url ??
    `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_SERVER_RELEASE}/${asset.name}`
  );
}

const verifiedFiles = new Map<string, { identity: string; sha256: string }>();
const VERIFIED_FILE_LIMIT = 16;

function fileIdentity(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

function rememberVerifiedFile(filePath: string, stat: BigIntStats, sha256: string): void {
  verifiedFiles.delete(filePath);
  verifiedFiles.set(filePath, { identity: fileIdentity(stat), sha256 });
  if (verifiedFiles.size > VERIFIED_FILE_LIMIT) {
    const oldest = verifiedFiles.keys().next().value;
    if (oldest !== undefined) {
      verifiedFiles.delete(oldest);
    }
  }
}

export async function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  try {
    const identity = fileIdentity(await fsp.stat(filePath, { bigint: true }));
    const verified = verifiedFiles.get(filePath);
    if (verified?.identity === identity) {
      return verified.sha256;
    }
    verifiedFiles.delete(filePath);
    const handle = await fsp.open(filePath, "r");
    try {
      const before = fileIdentity(await handle.stat({ bigint: true }));
      const { digest: sha256 } = await hashFile(handle, { signal });
      const after = await handle.stat({ bigint: true });
      if (
        before !== fileIdentity(after) ||
        before !== fileIdentity(await fsp.stat(filePath, { bigint: true }))
      ) {
        throw new Error(`File changed during integrity verification: ${filePath}. Retry setup.`);
      }
      rememberVerifiedFile(filePath, after, sha256);
      return sha256;
    } finally {
      await handle.close();
    }
  } catch (error) {
    verifiedFiles.delete(filePath);
    throw error;
  }
}

function readResponseSha256(response: Response): string | undefined {
  for (const name of ["x-checksum-sha256", "x-linked-etag"]) {
    const value = response.headers.get(name)?.replace(/^W\//u, "").replaceAll('"', "").trim();
    if (value && /^[a-f\d]{64}$/iu.test(value)) {
      return value.toLowerCase();
    }
  }
  const encoded = response.headers.get("digest")?.match(/(?:^|,)\s*sha-256=([^,\s]+)/iu)?.[1];
  return encoded ? Buffer.from(encoded, "base64").toString("hex") : undefined;
}

type DownloadParams = {
  url: string;
  destination: string;
  expectedSha256?: string;
  expectedSize?: number;
  requireServerDigest?: boolean;
  signal?: AbortSignal;
  onProgress?: LlamaDownloadProgress;
  /**
   * Stage to a deterministic `<destination>.part` so an interrupted or cancelled
   * download resumes on the next call. Needs `expectedSha256`; callers whose
   * destination name changes per attempt leave it off.
   */
  resumable?: boolean;
};

type StagedTarget = {
  partialPath: string;
  /** Byte offset already staged on disk; the request asks for the rest with Range. */
  startByte: number;
  /** Set for resumable downloads: the digest recorded in the partial's sidecar. */
  sidecarSha256?: string;
};

export async function downloadVerifiedFile(params: DownloadParams): Promise<void> {
  await fsp.mkdir(path.dirname(params.destination), { recursive: true });
  const expectedSha256 = params.expectedSha256?.toLowerCase();
  if (params.resumable && expectedSha256) {
    await downloadResumable({ ...params, expectedSha256 });
    return;
  }
  const partialPath = `${params.destination}.partial-${randomUUID()}`;
  try {
    await transferToPartial(params, { partialPath, startByte: 0 });
  } finally {
    await fsp.rm(partialPath, { force: true }).catch(() => undefined);
  }
}

// A download with a known digest stages to a deterministic .part file, so an
// interrupted or cancelled transfer resumes on the next attempt (atlas MODELS-ACCOUNTS-0141).
async function downloadResumable(params: DownloadParams & { expectedSha256: string }) {
  const partialPath = stagingPartPath(params.destination);
  let startByte = await resumableStartByte(partialPath, params.expectedSha256);
  if (startByte > 0 && params.expectedSize !== undefined && startByte >= params.expectedSize) {
    if (await promoteCompletePartial(params, partialPath, startByte)) {
      return;
    }
    startByte = 0;
  }
  for (;;) {
    const target = { partialPath, startByte, sidecarSha256: params.expectedSha256 };
    try {
      await transferToPartial(params, target);
      await fsp.rm(stagingMetaPath(partialPath), { force: true }).catch(() => undefined);
      return;
    } catch (error) {
      if (isStagedPartialKept(error)) {
        throw error;
      }
      await discardStagedPartial(partialPath);
      // A resumed transfer that fails verification or is refused restarts once from byte 0.
      if (startByte === 0 || !isStagedFreshRetry(error)) {
        throw error;
      }
      startByte = 0;
    }
  }
}

/** Commits a staged partial that already holds every expected byte, without another request. */
async function promoteCompletePartial(
  params: DownloadParams & { expectedSha256: string },
  partialPath: string,
  size: number,
): Promise<boolean> {
  if (size !== params.expectedSize) {
    await discardStagedPartial(partialPath);
    return false;
  }
  const handle = await fsp.open(partialPath, "r");
  try {
    const { digest } = await hashFile(handle, { signal: params.signal });
    if (digest !== params.expectedSha256) {
      await discardStagedPartial(partialPath);
      return false;
    }
    await publishVerifiedPartial(params, handle, partialPath, digest);
  } finally {
    await handle.close();
  }
  await fsp.rm(stagingMetaPath(partialPath), { force: true }).catch(() => undefined);
  return true;
}

async function transferToPartial(params: DownloadParams, target: StagedTarget): Promise<void> {
  // Setup/doctor closure must not cold-load the SSRF barrel (DNS, proxy state,
  // logging); defer it to actual download time per the closure guard contract.
  const { fetchWithSsrFGuard, ssrfPolicyFromHttpBaseUrlAllowedOrigin } =
    await import("branch/plugin-sdk/ssrf-runtime");
  const { response, release } = await fetchWithSsrFGuard({
    url: params.url,
    signal: params.signal,
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    policy: ssrfPolicyFromHttpBaseUrlAllowedOrigin(params.url),
    requireHttps: true,
    auditContext: "llama-cpp-download",
    ...(target.startByte > 0 ? { init: { headers: { range: `bytes=${target.startByte}-` } } } : {}),
  }).catch((error: unknown) => {
    throw keepStagedPartial(error);
  });
  try {
    const startByte = resolveResponseStart(response, target.startByte);
    const expectedSha256 = params.expectedSha256 ?? readResponseSha256(response);
    if (!expectedSha256 && params.requireServerDigest) {
      throw new Error(
        "the download server did not provide a SHA-256 digest; download the GGUF manually and configure its local path",
      );
    }
    await writeVerifiedBody(params, response, { ...target, startByte }, expectedSha256);
  } finally {
    await release();
  }
}

function resolveResponseStart(response: Response, requestedStart: number): number {
  if (requestedStart > 0 && response.status === 416) {
    throw retryStagedFresh(new Error("download resume was refused: HTTP 416"));
  }
  if (!response.ok || !response.body) {
    throw keepStagedPartial(
      new Error(`download failed: HTTP ${response.status} ${response.statusText}`),
    );
  }
  const startByte = resolveResumeOffset(requestedStart, response.status, {
    "content-range": response.headers.get("content-range") ?? undefined,
  });
  if (startByte === null) {
    throw retryStagedFresh(new Error("download resume returned a different byte range"));
  }
  return startByte;
}

async function openTargetPartial(target: StagedTarget) {
  if (!target.sidecarSha256) {
    return await fsp.open(target.partialPath, "wx", 0o600);
  }
  return await openStagedPartial({
    stagingPath: target.partialPath,
    startByte: target.startByte,
    expectedSha256: target.sidecarSha256,
  });
}

async function writeVerifiedBody(
  params: DownloadParams,
  response: Response,
  target: StagedTarget,
  expectedSha256: string | undefined,
): Promise<void> {
  const contentLength = Number(response.headers.get("content-length"));
  const totalSize =
    params.expectedSize ??
    (Number.isFinite(contentLength) && contentLength > 0 ? target.startByte + contentLength : 0);
  const hash = createHash("sha256");
  if (target.startByte > 0) {
    await hashStagedPrefix({
      stagingPath: target.partialPath,
      length: target.startByte,
      hash,
      signal: params.signal,
    }).catch((error: unknown) => {
      throw keepStagedPartial(error);
    });
  }
  const handle = await openTargetPartial(target);
  try {
    const body = response.body as ReadableStream<Uint8Array>;
    const downloadedSize = await streamBodyToHandle({
      params,
      body,
      handle,
      hash,
      totalSize,
      target,
    });
    const actualSha256 = verifyDownloadedBytes(params, downloadedSize, hash, expectedSha256);
    await publishVerifiedPartial(params, handle, target.partialPath, actualSha256);
  } finally {
    await handle.close();
  }
}

async function streamBodyToHandle(input: {
  params: DownloadParams;
  body: ReadableStream<Uint8Array>;
  handle: FileHandle;
  hash: ReturnType<typeof createHash>;
  totalSize: number;
  target: StagedTarget;
}): Promise<number> {
  const { params, handle, hash, totalSize } = input;
  let downloadedSize = input.target.startByte;
  let previousSize = downloadedSize;
  let previousAt = Date.now();
  let rollingBytesPerSecond = 0;
  // Unlock on every exit; the guard owns aborting an unfinished download.
  const chunks = input.body.values({ preventCancel: true });
  try {
    for (;;) {
      // A failed read is an interruption: staged bytes stay for the next attempt.
      const next = await chunks.next().catch((error: unknown) => {
        throw keepStagedPartial(error);
      });
      if (next.done) {
        return downloadedSize;
      }
      const chunk = Buffer.from(next.value);
      await handle.writeFile(chunk);
      hash.update(chunk);
      downloadedSize += chunk.byteLength;
      const now = Date.now();
      if (now > previousAt) {
        const currentRate = ((downloadedSize - previousSize) * 1000) / (now - previousAt);
        rollingBytesPerSecond =
          rollingBytesPerSecond === 0
            ? currentRate
            : rollingBytesPerSecond * 0.75 + currentRate * 0.25;
        previousSize = downloadedSize;
        previousAt = now;
      }
      params.onProgress?.({ downloadedSize, totalSize, bytesPerSecond: rollingBytesPerSecond });
    }
  } finally {
    await chunks.return?.();
  }
}

function verifyDownloadedBytes(
  params: DownloadParams,
  downloadedSize: number,
  hash: ReturnType<typeof createHash>,
  expectedSha256: string | undefined,
): string {
  if (params.expectedSize && downloadedSize !== params.expectedSize) {
    throw retryStagedFresh(
      new Error(`download size mismatch: expected ${params.expectedSize}, got ${downloadedSize}`),
    );
  }
  const actualSha256 = hash.digest("hex");
  if (expectedSha256 && actualSha256 !== expectedSha256.toLowerCase()) {
    throw retryStagedFresh(
      new Error(`download SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`),
    );
  }
  return actualSha256;
}

async function publishVerifiedPartial(
  params: DownloadParams,
  handle: FileHandle,
  partialPath: string,
  sha256: string,
): Promise<void> {
  const completed = await handle.stat({ bigint: true });
  // A cancel after verification keeps the complete partial for the next attempt to commit.
  try {
    params.signal?.throwIfAborted();
  } catch (error) {
    throw keepStagedPartial(error);
  }
  await fsp.rename(partialPath, params.destination);
  const published = await handle.stat({ bigint: true });
  // Rename can change ctime. Retain the verified open file's publication identity so
  // setup and cold chat preparation do not rescan a multi-GB download in this process.
  if (completed.size === published.size && completed.mtimeNs === published.mtimeNs) {
    rememberVerifiedFile(params.destination, published, sha256);
  }
}

async function runServerCommand(
  command: string,
  args: string[],
  signal?: AbortSignal,
  timeoutMs = VERSION_TIMEOUT_MS,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, signal, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(error.message, { cause: error }));
        } else {
          resolve(`${stdout}${stderr}`.trim());
        }
      },
    );
  });
}

function formatRuntimeDependencyError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  if (process.platform === "linux") {
    return new Error(
      `The verified llama-server build could not start. Install the OpenMP runtime (for example libgomp1 on Debian/Ubuntu or libgomp on Fedora), then rerun llama.cpp setup. Detail: ${detail}`,
      { cause: error },
    );
  }
  if (process.platform === "win32") {
    return new Error(
      `The verified llama-server build could not start with its app-local Visual C++ runtime. Rerun llama.cpp setup to reinstall it, or configure a compatible llama-server manually. Detail: ${detail}`,
      { cause: error },
    );
  }
  return new Error(`The verified llama-server build could not start: ${detail}`, { cause: error });
}

async function queryServerVersion(
  command: string,
  signal?: AbortSignal,
  versionTimeoutMs = VERSION_TIMEOUT_MS,
): Promise<string> {
  try {
    return await runServerCommand(command, ["--version"], signal, versionTimeoutMs);
  } catch (error) {
    signal?.throwIfAborted();
    throw formatRuntimeDependencyError(error);
  }
}

function validateServerVersionOutput(command: string, version: string): void {
  const versionLine = version.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  const match = versionLine.match(/^version: .+ \(build (\d+), commit ([a-f\d]{9})\)$/u);
  const build = match?.[1] ? Number(match[1]) : undefined;
  const commit = match?.[2];
  if (build !== LLAMA_SERVER_BUILD || commit !== LLAMA_SERVER_COMMIT.slice(0, 9)) {
    throw new Error(
      `Unexpected llama-server build at ${command}: expected ${LLAMA_SERVER_RELEASE} (${LLAMA_SERVER_COMMIT.slice(0, 9)}), got ${version || "no version output"}`,
    );
  }
}

async function validateCudaServer(
  command: string,
  asset: LlamaServerAsset,
  signal?: AbortSignal,
): Promise<void> {
  if (asset.backend === "cuda") {
    // --version succeeds even if a dynamically loaded CUDA backend fails. Device
    // enumeration must prove CUDA is usable before this installation is published.
    const devices = await runServerCommand(command, ["--list-devices"], signal);
    if (!/^\s*CUDA\d+: .+\(\d+ MiB, \d+ MiB free\)$/mu.test(devices)) {
      throw new Error(
        "The verified llama-server could not initialize an NVIDIA CUDA device. Update the NVIDIA driver and rerun setup, or configure a compatible llama-server manually. CPU fallback was not activated.",
      );
    }
  }
}

async function validateInstalledServer(
  command: string,
  asset: LlamaServerAsset,
  signal?: AbortSignal,
  versionTimeoutMs = VERSION_TIMEOUT_MS,
): Promise<void> {
  validateServerVersionOutput(command, await queryServerVersion(command, signal, versionTimeoutMs));
  await validateCudaServer(command, asset, signal);
}

type LlamaServerInstallOptions = {
  asset?: LlamaServerAsset;
  signal?: AbortSignal;
  onProgress?: LlamaDownloadProgress;
};

async function stageLlamaServerDependency(params: {
  dependency: LlamaServerDependency;
  index: number;
  extractDir: string;
  extractedRoot: string;
  options: LlamaServerInstallOptions;
}): Promise<void> {
  const { dependency, extractDir, extractedRoot, index, options } = params;
  options.signal?.throwIfAborted();
  const dependencyArchive = path.join(extractDir, dependency.name);
  await downloadVerifiedFile({
    url: assetUrl(dependency),
    destination: dependencyArchive,
    expectedSha256: dependency.sha256,
    expectedSize: dependency.archive === "vc-redist" ? dependency.size : undefined,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  const dependencyExtractDir = path.join(extractDir, `dependency-${index}`);
  await fsp.mkdir(dependencyExtractDir);
  const dependencyRoot =
    dependency.archive === "vc-redist"
      ? await extractWindowsVcRuntime({
          bundlePath: dependencyArchive,
          destDir: dependencyExtractDir,
          asset: dependency,
          signal: options.signal,
        })
      : await extractLlamaServerDependencyArchive({
          archivePath: dependencyArchive,
          destDir: dependencyExtractDir,
          asset: dependency,
        });
  for (const file of dependencyFiles(dependency)) {
    await fsp.copyFile(
      path.join(dependencyRoot, file),
      path.join(extractedRoot, file),
      fs.constants.COPYFILE_EXCL,
    );
  }
}

function formatVcRuntimeFallbackError(startupError: unknown, fallbackError: unknown): Error {
  const startupDetail = startupError instanceof Error ? startupError.message : String(startupError);
  const fallbackDetail =
    fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
  return new Error(
    `The extracted llama-server could not start with the installed Windows runtime, and its app-local Visual C++ runtime fallback did not restore it. Initial startup detail: ${startupDetail} Fallback detail: ${fallbackDetail}`,
    { cause: fallbackError },
  );
}

async function installLlamaServer(
  asset: LlamaServerAsset,
  options: LlamaServerInstallOptions,
): Promise<string> {
  options.signal?.throwIfAborted();
  assertSupportedLinuxRuntime(asset);
  const { installDir, command } = resolveManagedLlamaServerPaths(asset);
  if (
    await fsp
      .stat(command)
      .then((stat) => stat.isFile())
      .catch(() => false)
  ) {
    await validateInstalledServer(command, asset, options.signal);
    return command;
  }
  const dataDir = resolveLlamaCppDataDir();
  const archivePath = path.join(dataDir, `.download-${randomUUID()}-${asset.name}`);
  const extractDir = path.join(dataDir, `.extract-${randomUUID()}`);
  await fsp.mkdir(dataDir, { recursive: true });
  try {
    await downloadVerifiedFile({
      url: assetUrl(asset),
      destination: archivePath,
      expectedSha256: asset.sha256,
      signal: options.signal,
      onProgress: options.onProgress,
    });
    const serverExtractDir = path.join(extractDir, "server");
    await fsp.mkdir(serverExtractDir, { recursive: true });
    const extractedCommand = await extractLlamaServerArchive({
      archivePath,
      destDir: serverExtractDir,
      asset,
    });
    const extractedRoot = path.dirname(extractedCommand);
    const dependencies = asset.dependencies ?? [];
    const windowsRuntimeDependencies: Array<{
      dependency: LlamaServerDependency;
      index: number;
    }> = [];
    for (const [index, dependency] of dependencies.entries()) {
      if (dependency.archive === "vc-redist") {
        windowsRuntimeDependencies.push({ dependency, index });
      } else {
        await stageLlamaServerDependency({
          dependency,
          index,
          extractDir,
          extractedRoot,
          options,
        });
      }
    }
    options.signal?.throwIfAborted();
    await fsp.chmod(extractedCommand, 0o755);
    if (windowsRuntimeDependencies.length > 0) {
      let version: string;
      try {
        version = await queryServerVersion(
          extractedCommand,
          options.signal,
          FRESH_VERSION_TIMEOUT_MS,
        );
      } catch (startupError) {
        options.signal?.throwIfAborted();
        try {
          for (const { dependency, index } of windowsRuntimeDependencies) {
            await stageLlamaServerDependency({
              dependency,
              index,
              extractDir,
              extractedRoot,
              options,
            });
          }
        } catch (stagingError) {
          options.signal?.throwIfAborted();
          throw formatVcRuntimeFallbackError(startupError, stagingError);
        }
        try {
          version = await queryServerVersion(
            extractedCommand,
            options.signal,
            FRESH_VERSION_TIMEOUT_MS,
          );
        } catch (retryError) {
          options.signal?.throwIfAborted();
          throw formatVcRuntimeFallbackError(startupError, retryError);
        }
      }
      validateServerVersionOutput(extractedCommand, version);
      await validateCudaServer(extractedCommand, asset, options.signal);
    } else {
      await validateInstalledServer(
        extractedCommand,
        asset,
        options.signal,
        FRESH_VERSION_TIMEOUT_MS,
      );
    }
    await fsp.mkdir(path.dirname(installDir), { recursive: true });
    options.signal?.throwIfAborted();
    await fsp.rm(installDir, { recursive: true, force: true });
    await fsp.rename(extractedRoot, installDir);
    await validateInstalledServer(command, asset, options.signal);
    return command;
  } finally {
    await Promise.all([
      fsp.rm(archivePath, { force: true }),
      fsp.rm(extractDir, { recursive: true, force: true }),
    ]);
  }
}

function dependencyFiles(dependency: LlamaServerDependency): readonly string[] {
  return dependency.archive === "vc-redist"
    ? dependency.files.map((file) => file.target)
    : dependency.files;
}

export async function ensureLlamaServerInstalled(options: LlamaServerInstallOptions = {}): Promise<{
  command: string;
  asset: LlamaServerAsset;
}> {
  options.signal?.throwIfAborted();
  const asset = options.asset ?? selectLlamaServerAsset();
  const key = resolveManagedLlamaServerPaths(asset).command;
  const previous = installationPromises.get(key);
  // Each caller owns its cancellation. Serialize attempts so a cancelled setup
  // cannot poison another caller or race its archive cleanup/publication.
  const pending = Promise.resolve(previous)
    .catch(() => undefined)
    .then(() => installLlamaServer(asset, options))
    .finally(() => {
      if (installationPromises.get(key) === pending) {
        installationPromises.delete(key);
      }
    });
  installationPromises.set(key, pending);
  const command =
    previous && options.signal
      ? await new Promise<string>((resolve, reject) => {
          const signal = options.signal;
          const onAbort = () => reject(toErrorObject(signal?.reason, "Installation cancelled"));
          signal?.addEventListener("abort", onAbort, { once: true });
          void pending
            .then(resolve, reject)
            .finally(() => signal?.removeEventListener("abort", onAbort));
          if (signal?.aborted) {
            onAbort();
          }
        })
      : await pending;
  return { command, asset };
}
