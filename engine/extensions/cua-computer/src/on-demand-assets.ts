/**
 * Pinned computer-use downloads. Release builds no longer ship the CUA Driver
 * (the macOS cua-driver binary and the SDK's native platform package, about
 * 115 MiB on macOS); Branch Agent fetches it the first time computer use is on.
 *
 * Each part is the exact npm tarball the bundled install resolved (the SDK, its
 * uniffi runtime and the native package for this platform), plus on macOS the
 * cua-driver binary from the same GitHub release archive the release build
 * staged. The SHA-256 and size here are what Branch Agent trusts: a download
 * with any other digest or size is refused before anything is unpacked or run.
 * The npm sha512 integrity is kept beside each pin so a test can cross-check it
 * against pnpm-lock.yaml. All pins live in this plugin's package.json, which the
 * desktop app also reads before it starts the macOS driver.
 */
import pluginManifest from "../package.json" with { type: "json" };

export const COMPUTER_USE_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64-gnu",
  "linux-x64-gnu",
  "win32-arm64-msvc",
  "win32-x64-msvc",
] as const;

export type ComputerUseTarget = (typeof COMPUTER_USE_TARGETS)[number];

type PackagePin = { version: string; sha256: string; integrity: string; bytes: number };

type DownloadManifest = {
  dependencies?: Record<string, string>;
  cuaDriverArtifacts?: Record<
    string,
    { archiveSha256?: string; archiveBytes?: number; files?: Record<string, string> }
  >;
  cuaDriverDownloads?: {
    packages?: Record<string, PackagePin>;
    targets?: Record<string, { packages?: Record<string, PackagePin> }>;
  };
};

export type ComputerUseDownloadPart =
  | {
      kind: "npm-package";
      name: string;
      version: string;
      url: string;
      sha256: string;
      integrity: string;
      bytes: number;
    }
  | {
      /** The macOS driver: one file kept from the GitHub release archive. */
      kind: "driver-archive";
      name: "cua-driver";
      version: string;
      url: string;
      sha256: string;
      bytes: number;
      file: string;
      fileSha256: string;
    };

export type ComputerUseDownload = {
  /** The pinned CUA Driver SDK version (the plugin's @trycua/cua-driver dependency). */
  version: string;
  target: ComputerUseTarget;
  parts: ComputerUseDownloadPart[];
  /** Total download size (all archives). */
  bytes: number;
};

const SDK_PACKAGE = "@trycua/cua-driver";
const SHA256 = /^[a-f0-9]{64}$/u;

/** The npm registry tarball URL of a package version. */
export function npmTarballUrl(name: string, version: string): string {
  const base = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
  return `https://registry.npmjs.org/${name}/-/${base}-${version}.tgz`;
}

/** The release archive the macOS build staged cua-driver from (scripts/stage-cua-driver-macos.sh). */
export function driverArchiveUrl(version: string): string {
  return `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${version}/cua-driver-rs-${version}-darwin-universal-binary.tar.gz`;
}

/** This host's download target, or undefined where the CUA Driver publishes none (musl Linux, ia32...). */
export function resolveComputerUseTarget(
  platform: NodeJS.Platform,
  arch: string,
  linuxLibc?: "gnu" | "musl",
): ComputerUseTarget | undefined {
  if (arch !== "arm64" && arch !== "x64") {
    return undefined;
  }
  if (platform === "darwin") {
    return `darwin-${arch}`;
  }
  if (platform === "win32") {
    return `win32-${arch}-msvc`;
  }
  if (platform === "linux" && linuxLibc === "gnu") {
    return `linux-${arch}-gnu`;
  }
  return undefined;
}

function npmPart(name: string, pin: PackagePin | undefined): ComputerUseDownloadPart {
  if (
    !pin ||
    !SHA256.test(pin.sha256) ||
    !Number.isSafeInteger(pin.bytes) ||
    pin.bytes <= 0 ||
    typeof pin.version !== "string"
  ) {
    throw new Error(`The computer-use download pin for ${name} is missing or invalid.`);
  }
  return {
    kind: "npm-package",
    name,
    version: pin.version,
    url: npmTarballUrl(name, pin.version),
    sha256: pin.sha256,
    integrity: pin.integrity,
    bytes: pin.bytes,
  };
}

/** The pinned download for a target; throws when the manifest's pins are incomplete. */
export function computerUseDownload(
  target: ComputerUseTarget,
  manifest: unknown = pluginManifest,
): ComputerUseDownload {
  const value = manifest as DownloadManifest;
  const version = value.dependencies?.[SDK_PACKAGE];
  const downloads = value.cuaDriverDownloads;
  if (typeof version !== "string" || !downloads) {
    throw new Error("The computer-use download pins are missing from cua-computer.");
  }
  const shared = downloads.packages ?? {};
  const own = downloads.targets?.[target]?.packages ?? {};
  const parts: ComputerUseDownloadPart[] = [
    npmPart(SDK_PACKAGE, shared[SDK_PACKAGE]),
    npmPart("@ubjs/core", shared["@ubjs/core"]),
    npmPart("@ubjs/node", shared["@ubjs/node"]),
    npmPart(`${SDK_PACKAGE}-${target}`, own[`${SDK_PACKAGE}-${target}`]),
    npmPart(`@ubjs/node-${target}`, own[`@ubjs/node-${target}`]),
  ];
  if (parts[0]?.version !== version || parts[3]?.version !== version) {
    throw new Error(`The computer-use download pins are not for CUA Driver ${version}.`);
  }
  if (target.startsWith("darwin-")) {
    const archive = value.cuaDriverArtifacts?.["darwin-universal-binary"];
    const fileSha256 = archive?.files?.["cua-driver"];
    if (
      !archive?.archiveSha256 ||
      !SHA256.test(archive.archiveSha256) ||
      !Number.isSafeInteger(archive.archiveBytes) ||
      !fileSha256 ||
      !SHA256.test(fileSha256)
    ) {
      throw new Error("The macOS cua-driver download pin is missing or invalid.");
    }
    parts.push({
      kind: "driver-archive",
      name: "cua-driver",
      version,
      url: driverArchiveUrl(version),
      sha256: archive.archiveSha256,
      bytes: archive.archiveBytes!,
      file: "cua-driver",
      fileSha256,
    });
  }
  return { version, target, parts, bytes: parts.reduce((sum, part) => sum + part.bytes, 0) };
}
