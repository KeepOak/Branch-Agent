import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pluginManifest from "../package.json" with { type: "json" };
import {
  inspectCuaDriverArtifacts,
  readPackageIdentity,
  type CuaDriverArtifactVerification,
} from "./driver-artifact-verification.js";
import { COMPUTER_USE_RECEIPT, storeSdkManifestPath, type ComputerUseOnDemand } from "./on-demand.js";

const SDK_PACKAGE = "@trycua/cua-driver";
const requireFromPlugin = createRequire(import.meta.url);

function resolvePackageEntry(packageName: string): string | undefined {
  try {
    return requireFromPlugin.resolve(packageName);
  } catch {}
  // The CUA Driver SDK is ESM-only: its exports map carries only the "import"
  // condition, so require-condition resolution throws PATH_NOT_EXPORTED even
  // when the package is installed. Resolve with import conditions before
  // concluding the package is missing.
  try {
    return fileURLToPath(import.meta.resolve(packageName));
  } catch {
    return undefined;
  }
}

/** The SDK's package.json bundled with this engine (source checkouts, older builds). */
function resolveBundledSdkManifest(): string | undefined {
  try {
    return requireFromPlugin.resolve(`${SDK_PACKAGE}/package.json`);
  } catch {}
  const entry = resolvePackageEntry(SDK_PACKAGE);
  if (!entry) {
    return undefined;
  }
  let current = path.dirname(entry);
  while (true) {
    const candidate = path.join(current, "package.json");
    try {
      if (readPackageIdentity(candidate).name === SDK_PACKAGE) {
        return candidate;
      }
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

let onDemand: ComputerUseOnDemand | undefined;

/** The plugin's on-demand source (computer-runtime.ts); downloaded copies are found through it. */
export function setComputerUseOnDemand(value: ComputerUseOnDemand | undefined): void {
  onDemand = value;
  installedVerification = undefined;
}

export function getComputerUseOnDemand(): ComputerUseOnDemand | undefined {
  return onDemand;
}

/** The SDK's package.json in the per-user download, when one was installed. */
function resolveDownloadedSdkManifest(): string | undefined {
  const root = onDemand?.storeDir();
  if (!root) {
    return undefined;
  }
  const manifest = storeSdkManifestPath(root);
  return fs.existsSync(path.join(root, COMPUTER_USE_RECEIPT)) && fs.existsSync(manifest)
    ? manifest
    : undefined;
}

export type CuaDriverSdkLocation = { source: "bundled" | "downloaded"; manifestPath: string };

/** Where the SDK loads from: bundled with this engine first, then the per-user download. */
export function resolveCuaDriverSdk(): CuaDriverSdkLocation | undefined {
  const bundled = resolveBundledSdkManifest();
  if (bundled) {
    return { source: "bundled", manifestPath: bundled };
  }
  const downloaded = resolveDownloadedSdkManifest();
  return downloaded ? { source: "downloaded", manifestPath: downloaded } : undefined;
}

function nativePackageName(): string | undefined {
  const linuxLibc = process.platform === "linux" ? detectLinuxLibc() : undefined;
  const triple =
    process.platform === "darwin"
      ? `darwin-${process.arch}`
      : process.platform === "win32"
        ? `win32-${process.arch}-msvc`
        : process.platform === "linux"
          ? `linux-${process.arch}-${linuxLibc}`
          : undefined;
  return triple ? `${SDK_PACKAGE}-${triple}` : undefined;
}

/** True when this engine still ships the SDK with this platform's native package. */
export function bundledCuaDriverReady(): boolean {
  const sdk = resolveBundledSdkManifest();
  const native = nativePackageName();
  if (!sdk || !native) {
    return false;
  }
  try {
    createRequire(sdk).resolve(`${native}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function resolvePackageJson(packageName: string): string | undefined {
  const sdk = resolveCuaDriverSdk();
  if (!sdk) {
    return undefined;
  }
  if (packageName === SDK_PACKAGE) {
    return sdk.manifestPath;
  }
  // Native packages belong to the SDK, not the plugin's dependency tree.
  try {
    return createRequire(sdk.manifestPath).resolve(`${packageName}/package.json`);
  } catch {
    return undefined;
  }
}

function detectLinuxLibc(): "gnu" | "musl" {
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: unknown } }
    | undefined;
  return typeof report?.header?.glibcVersionRuntime === "string" ? "gnu" : "musl";
}

let installedVerification: CuaDriverArtifactVerification | undefined;

export function verifyInstalledCuaDriverArtifacts(): CuaDriverArtifactVerification {
  if (installedVerification) {
    return installedVerification;
  }
  const verification = inspectCuaDriverArtifacts({
    platform: process.platform,
    arch: process.arch,
    ...(process.platform === "linux" ? { linuxLibc: detectLinuxLibc() } : {}),
    pluginManifest,
    resolvePackageJson,
  });
  if (!verification.ok && verification.code === "COMPUTER_DRIVER_PACKAGE_MISSING" && !resolveCuaDriverSdk()) {
    // Release builds no longer bundle the driver: it is not downloaded yet, not broken.
    const fixHint = "It downloads the first time computer use is used, while this computer is online.";
    return {
      ok: false,
      code: "COMPUTER_DRIVER_NOT_DOWNLOADED",
      diagnostic: `COMPUTER_DRIVER_NOT_DOWNLOADED: computer use isn't downloaded yet. Fix: ${fixHint}`,
      fixHint,
    };
  }
  installedVerification = verification;
  return verification;
}

/** Checks the driver files again on next use (after a download finished). */
export function resetCuaDriverVerification(): void {
  installedVerification = undefined;
}

/** The SDK entry module (dist/index.js) inside a package folder. */
export function cuaDriverSdkEntry(manifestPath: string): string {
  return path.join(path.dirname(manifestPath), "dist", "index.js");
}
