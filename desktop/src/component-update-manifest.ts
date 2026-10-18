export const RELEASE_REPOSITORY = "KeepOak/Branch-Agent";
export type ReleaseRuntime = { platform: string; arch: string };

/** The latest-release manifest this machine's updater fetches. Intel Macs get darwin-x64; Apple silicon gets darwin-arm64. */
export function releaseManifestName(platform: string = process.platform, arch: string = process.arch): string {
  return `branch-release-${platform}-${arch}.json`;
}

export function releaseManifestUrl(platform: string = process.platform, arch: string = process.arch): string {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/latest/download/${releaseManifestName(platform, arch)}`;
}

export const RELEASE_MANIFEST_URL = releaseManifestUrl();

export interface ComponentAsset {
  url: string;
  sha256: string;
  bytes: number;
  expandedBytes: number;
  platform?: string;
  arch?: string;
}
/** The desktop app's own code (app.asar), or the whole packaged app when Electron itself changes. */
export interface DesktopAsset extends ComponentAsset {
  electronVersion: string; platform: string; arch: string;
  /** SHA256 of the app.asar the component carries; an installed desktop with the same bytes stays as it is. */
  appAsarSha256?: string;
}
export interface ComponentRelease {
  schemaVersion: 1;
  version: string;
  /** Published as a security fix: auto-apply lands it without waiting for the Trunk-work batch (Private #951). */
  security?: true;
  components: { engine: ComponentAsset; window: ComponentAsset; desktop?: DesktopAsset; desktopRuntime?: DesktopAsset };
}

function asset(value: unknown, runtime: ReleaseRuntime): ComponentAsset {
  if (!value || typeof value !== "object") throw new Error("Missing release component");
  const item = value as ComponentAsset;
  const url = new URL(item.url);
  const prefix = `/${RELEASE_REPOSITORY}/releases/download/`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.startsWith(prefix)
    || url.username || url.password || url.search || url.hash) throw new Error("Untrusted release asset URL");
  if (!/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error("Invalid component SHA256");
  for (const size of [item.bytes, item.expandedBytes]) {
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error("Invalid component size");
  }
  if (item.platform && item.platform !== runtime.platform) throw new Error("Release platform mismatch");
  if (item.arch && item.arch !== runtime.arch) throw new Error("Release architecture mismatch");
  return item;
}

/** Releases before the desktop component carry none; a present one must name its exact target and Electron. */
function desktopAsset(value: unknown, runtime: ReleaseRuntime): DesktopAsset | undefined {
  if (value === undefined) return undefined;
  const item = asset(value, runtime) as DesktopAsset;
  if (!item.platform || !item.arch) throw new Error("Desktop component must name its target");
  if (typeof item.electronVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(item.electronVersion)) throw new Error("Invalid desktop Electron version");
  if (item.appAsarSha256 !== undefined && !/^[a-f0-9]{64}$/.test(item.appAsarSha256)) throw new Error("Invalid desktop app.asar SHA256");
  return item;
}

export function parseComponentRelease(value: unknown, runtime: ReleaseRuntime = { platform: process.platform, arch: process.arch }): ComponentRelease {
  const item = value as ComponentRelease | undefined;
  if (item?.schemaVersion !== 1 || typeof item.version !== "string" || !/^[\w.-]+$/.test(item.version)) {
    throw new Error("Unsupported release manifest");
  }
  const security = (item as { security?: unknown }).security;
  if (security !== undefined && typeof security !== "boolean") throw new Error("Invalid release security flag");
  const desktop = desktopAsset(item.components?.desktop, runtime);
  const desktopRuntime = desktopAsset(item.components?.desktopRuntime, runtime);
  return { schemaVersion: 1, version: item.version, ...(security ? { security: true as const } : {}),
    components: { engine: asset(item.components?.engine, runtime), window: asset(item.components?.window, runtime),
      ...(desktop ? { desktop } : {}), ...(desktopRuntime ? { desktopRuntime } : {}) } };
}

export function trustedDownloadResponse(response: Response): void {
  if (!response.ok || !response.body) throw new Error(`Release download failed (${response.status})`);
  if (!response.url) return; // Synthetic Response objects used by offline fixtures.
  const url = new URL(response.url);
  if (url.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname)) {
    throw new Error("Untrusted release redirect");
  }
}
