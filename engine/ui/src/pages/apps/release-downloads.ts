import { html } from "lit";
import { property, state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../../lib/external-link.ts";
import { BranchLightDomContentsElement } from "../../lit/branch-element.ts";

const RELEASE_REPOSITORY = "KeepOak/Branch-Agent";
const RELEASES_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases?per_page=100`;

/** The release page, used until the matching asset URL is known. */
export const BRANCH_RELEASES_LATEST = `https://github.com/${RELEASE_REPOSITORY}/releases/latest`;

/** Asset names already published on Branch releases. Stable download names are not on main yet. */
export const RELEASE_DOWNLOADS = {
  mac: /^Branch-Agent-.+-darwin-arm64\.dmg$/,
  windows: /^Branch-Agent-Setup-.+-win32-x64\.exe$/,
  linux: /^Branch-Agent-.+-linux-x64\.AppImage$/,
  android: /^branch-android-.+\.apk$/,
} as const;
export type ReleaseDownloadId = keyof typeof RELEASE_DOWNLOADS;
export interface ReleaseAsset { name?: string; browser_download_url?: string }
export interface ReleaseListing { assets?: readonly ReleaseAsset[] }

/** A GitHub release asset URL for this repository, or nothing when the URL is not one. */
export function trustedReleaseAsset(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const prefix = `/${RELEASE_REPOSITORY}/releases/download/`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(prefix)
  ) {
    return undefined;
  }
  return url.toString();
}

/** The newest signed asset whose name is one Branch already publishes. Listings are newest first. */
export function releaseDownloadUrl(
  id: ReleaseDownloadId,
  releases: readonly ReleaseListing[],
): string | undefined {
  const pattern = RELEASE_DOWNLOADS[id];
  for (const release of releases) {
    for (const asset of release.assets ?? []) {
      if (typeof asset.name !== "string" || typeof asset.browser_download_url !== "string") {
        continue;
      }
      if (!pattern.test(asset.name) || asset.name.toLowerCase().includes("unsigned")) {
        continue;
      }
      const url = trustedReleaseAsset(asset.browser_download_url);
      if (url) {
        return url;
      }
    }
  }
  return undefined;
}

function isReleaseDownloadId(id: string): id is ReleaseDownloadId {
  return Object.hasOwn(RELEASE_DOWNLOADS, id);
}

let listingsOverride: readonly ReleaseListing[] | undefined;

/** Tests supply listings so rendering never reads GitHub. */
export function useReleaseListingsForTests(listings: readonly ReleaseListing[] | undefined): void {
  listingsOverride = listings;
}

let listingsPromise: Promise<readonly ReleaseListing[]> | undefined;

function loadReleaseListings(): Promise<readonly ReleaseListing[]> {
  listingsPromise ??= fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Branch-Agent" },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Branch releases could not be read (${response.status})`);
      }
      const body: unknown = await response.json();
      if (!Array.isArray(body)) {
        throw new Error("Branch releases could not be read");
      }
      return body as ReleaseListing[];
    })
    .catch((error: unknown) => {
      listingsPromise = undefined;
      throw error;
    });
  return listingsPromise;
}

class BranchReleaseDownload extends BranchLightDomContentsElement {
  @property({ attribute: "download-id" }) downloadId = "";
  @property({ attribute: "label-key" }) labelKey = "appsPage.ctaDownload";
  @property({ type: Boolean }) primary = false;
  @state() private href = BRANCH_RELEASES_LATEST;

  override connectedCallback(): void {
    super.connectedCallback();
    if (listingsOverride) {
      return;
    }
    const id = this.downloadId;
    if (!isReleaseDownloadId(id)) {
      return;
    }
    void loadReleaseListings()
      .then((releases) => {
        const url = releaseDownloadUrl(id, releases);
        if (url) {
          this.href = url;
        }
      })
      .catch(() => undefined);
  }

  override render() {
    const id = this.downloadId;
    const resolved =
      listingsOverride && isReleaseDownloadId(id)
        ? releaseDownloadUrl(id, listingsOverride)
        : undefined;
    const className = this.primary ? "apps-card__cta apps-card__cta--primary" : "apps-card__cta";
    return html`<a
      class=${className}
      href=${resolved ?? this.href}
      target=${EXTERNAL_LINK_TARGET}
      rel=${buildExternalLinkRel()}
      >${t(this.labelKey)}</a
    >`;
  }
}

if (!customElements.get("branch-release-download")) {
  customElements.define("branch-release-download", BranchReleaseDownload);
}
