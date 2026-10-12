export const RELEASE_REPOSITORY = "KeepOak/Branch-Agent";
export const RELEASE_MANIFEST_URL = `https://github.com/${RELEASE_REPOSITORY}/releases/latest/download/branch-release-${process.platform}-${process.arch}.json`;

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
  components: { engine: ComponentAsset; window: ComponentAsset; desktop?: DesktopAsset; desktopRuntime?: DesktopAsset };
}

function asset(value: unknown): ComponentAsset {
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
  if (item.platform && item.platform !== process.platform) throw new Error("Release platform mismatch");
  if (item.arch && item.arch !== process.arch) throw new Error("Release architecture mismatch");
  return item;
}

/** Releases before the desktop component carry none; a present one must name its exact target and Electron. */
function desktopAsset(value: unknown): DesktopAsset | undefined {
  if (value === undefined) return undefined;
  const item = asset(value) as DesktopAsset;
  if (!item.platform || !item.arch) throw new Error("Desktop component must name its target");
  if (typeof item.electronVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(item.electronVersion)) throw new Error("Invalid desktop Electron version");
  if (item.appAsarSha256 !== undefined && !/^[a-f0-9]{64}$/.test(item.appAsarSha256)) throw new Error("Invalid desktop app.asar SHA256");
  return item;
}

export function parseComponentRelease(value: unknown): ComponentRelease {
  const item = value as ComponentRelease | undefined;
  if (item?.schemaVersion !== 1 || typeof item.version !== "string" || !/^[\w.-]+$/.test(item.version)) {
    throw new Error("Unsupported release manifest");
  }
  const desktop = desktopAsset(item.components?.desktop);
  const desktopRuntime = desktopAsset(item.components?.desktopRuntime);
  return { schemaVersion: 1, version: item.version,
    components: { engine: asset(item.components?.engine), window: asset(item.components?.window),
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
