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
export interface ComponentRelease {
  schemaVersion: 1;
  version: string;
  components: { engine: ComponentAsset; window: ComponentAsset };
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

export function parseComponentRelease(value: unknown): ComponentRelease {
  const item = value as ComponentRelease | undefined;
  if (item?.schemaVersion !== 1 || typeof item.version !== "string" || !/^[\w.-]+$/.test(item.version)) {
    throw new Error("Unsupported release manifest");
  }
  return { schemaVersion: 1, version: item.version,
    components: { engine: asset(item.components?.engine), window: asset(item.components?.window) } };
}

export function trustedDownloadResponse(response: Response): void {
  if (!response.ok || !response.body) throw new Error(`Release download failed (${response.status})`);
  if (!response.url) return; // Synthetic Response objects used by offline fixtures.
  const url = new URL(response.url);
  if (url.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname)) {
    throw new Error("Untrusted release redirect");
  }
}
