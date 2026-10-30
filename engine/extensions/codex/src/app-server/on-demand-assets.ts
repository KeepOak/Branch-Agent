/**
 * Pinned Codex downloads. Release builds no longer ship the Codex platform
 * package (about 318 MiB on disk); Branch Agent fetches it on first use.
 *
 * Each asset is the npm tarball of the platform package that @openai/codex
 * itself lists as an optional dependency, so the downloaded files are exactly
 * the files a bundled install had. The SHA-256 below is the digest Branch Agent
 * trusts: a download with any other digest is refused before it is unpacked.
 * The npm sha512 integrity is kept alongside to cross-check with the lockfile.
 * The version must equal CODEX_APP_SERVER_VERSION (a test enforces it).
 */
import { CODEX_APP_SERVER_VERSION } from "./version.js";

export type CodexDownloadTarget = `${"darwin" | "linux" | "win32"}-${"arm64" | "x64"}`;

export type CodexDownloadAsset = {
  version: string;
  target: CodexDownloadTarget;
  /** npm package name the official launcher resolves for this platform. */
  packageName: string;
  /** Rust target triple used inside the package's vendor folder. */
  triple: string;
  url: string;
  sha256: string;
  integrity: string;
  /** Download size (tarball bytes). */
  bytes: number;
  /** Installed size (file bytes once unpacked). */
  unpackedBytes: number;
};

/** Version these digests were measured for. */
export const CODEX_DOWNLOAD_VERSION = "0.160.0";

function asset(
  target: CodexDownloadTarget,
  triple: string,
  sha256: string,
  integrity: string,
  bytes: number,
  unpackedBytes: number,
): CodexDownloadAsset {
  return {
    version: CODEX_DOWNLOAD_VERSION,
    target,
    packageName: `@openai/codex-${target}`,
    triple,
    url: `https://registry.npmjs.org/@openai/codex/-/codex-${CODEX_DOWNLOAD_VERSION}-${target}.tgz`,
    sha256,
    integrity,
    bytes,
    unpackedBytes,
  };
}

/** Codex 0.160.0 platform packages, measured from the npm registry tarballs. */
export const CODEX_DOWNLOAD_ASSETS: Readonly<Record<CodexDownloadTarget, CodexDownloadAsset>> = {
  "darwin-arm64": asset(
    "darwin-arm64",
    "aarch64-apple-darwin",
    "fc789bcd655d903f92e1a23c8dc5315ba38f43b3586eafb7bd3b195970b57466",
    "sha512-aefV6cqZA2REZgR//4McyXlp7zLcTti4CI2v3j9IVgNndPBv2kCeNEcz07qeelXcwOdSFPUKb6roA48vZmDgrQ==",
    134_311_083,
    332_972_398,
  ),
  "darwin-x64": asset(
    "darwin-x64",
    "x86_64-apple-darwin",
    "d90ef1be135b605c88af1b7595bac768a02c7ea410688240961899655ccb5d2e",
    "sha512-ir7cdsPrb9VkqNqpTECoTiomv04xws/FQ968mHQzuL+2J5Da0Dkh2Qlxp7sguDDZJab4YpYmNjQvBVMXbTeQaQ==",
    143_411_935,
    356_688_534,
  ),
  "linux-arm64": asset(
    "linux-arm64",
    "aarch64-unknown-linux-musl",
    "9286a7e01d500ab224c9e5b4b223b7adf5dd901fba23efd6a438316426798b17",
    "sha512-VnVdsS06YlDsL8OwaJjQ3xdqdJNG4i+eBJBV3LytddknzSaF/urijLzVg3ptkwvoj8C7Gn7iWpVE+y8WEaPiCg==",
    155_716_078,
    401_682_252,
  ),
  "linux-x64": asset(
    "linux-x64",
    "x86_64-unknown-linux-musl",
    "37a41d61c3399182b8c727b77090cc7a1566bd849d0f09070a0bbc6fec4c58dc",
    "sha512-KI/73OqGrHmR18s7ya7E1NqV6rT0y3lxr0s8S1qR2m6zU6QRF/HlR529jALLh5vjdUnsRT4Ahoxt0axb4kY99g==",
    163_273_896,
    446_689_074,
  ),
  "win32-arm64": asset(
    "win32-arm64",
    "aarch64-pc-windows-msvc",
    "918d4677c7ccdbbac524de51d3c2f5a46d6bff8d2a596bda668bc231c48c927e",
    "sha512-tTvK9ZIGuj9WnYaYOAnfjJVSfPV7dKqWtDHqUPLf0Hadp6SgynTxx7S7iMXRieFeXVOI2XH76KxEHSOTOnz3zw==",
    151_948_410,
    389_339_784,
  ),
  "win32-x64": asset(
    "win32-x64",
    "x86_64-pc-windows-msvc",
    "1f4c46470317bf5fabb308ed3e39a80ff544069cedc2cb477005545e694058b9",
    "sha512-/gCFcuOmGlQkgGivWCtY8BNEDixh70Pue0HZOk9S8bj2vUIE1GLD9zcNB/KqqDJmn0S+lIttauLpzQnw6HOCHA==",
    162_643_563,
    450_619_016,
  ),
};

/** The pinned asset for a platform, or undefined where Codex publishes none. */
export function resolveCodexDownloadAsset(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): CodexDownloadAsset | undefined {
  const key = `${platform === "android" ? "linux" : platform}-${arch}`;
  return Object.hasOwn(CODEX_DOWNLOAD_ASSETS, key)
    ? CODEX_DOWNLOAD_ASSETS[key as CodexDownloadTarget]
    : undefined;
}

/** True when the pins were measured for the Codex version Branch Agent runs. */
export function codexDownloadPinsMatchVersion(): boolean {
  return CODEX_DOWNLOAD_VERSION === CODEX_APP_SERVER_VERSION;
}
