import { VerifyError } from './verify';
import { compareVersions, isNewerApk, parseRemoteVersion, type RemoteVersion } from './versionCompare';

export const GITHUB_RELEASES_URL = 'https://api.github.com/repos/KeepOak/Branch-Agent/releases';
export const ANDROID_APK_RE = /^branch-android-(.+)\.apk$/i;
const SHA256_NAME_RE = /^branch-android-(.+)\.apk\.sha256(?:\.txt)?$/i;

export type ReleaseAsset = { name: string; browser_download_url: string; size: number };
export type GithubRelease = {
  draft: boolean;
  prerelease: boolean;
  tag_name: string;
  name?: string;
  assets: ReleaseAsset[];
};

export type ApkOffer = {
  version: string;
  remote: RemoteVersion;
  apk: ReleaseAsset;
  sha256: ReleaseAsset;
  tag: string;
};

function sha256AssetFor(apk: ReleaseAsset, assets: ReleaseAsset[]): ReleaseAsset | undefined {
  const version = ANDROID_APK_RE.exec(apk.name)?.[1];
  const names = new Set(
    [`${apk.name}.sha256`, version ? `branch-android-${version}.sha256` : '', `${apk.name}.sha256.txt`].filter(Boolean),
  );
  const exact = assets.find((asset) => names.has(asset.name));
  if (exact) return exact;
  if (!version) return undefined;
  const apkName = parseRemoteVersion(version).name.toLowerCase();
  return assets.find((asset) => {
    const sha = SHA256_NAME_RE.exec(asset.name);
    if (!sha) return false;
    return parseRemoteVersion(sha[1]).name.toLowerCase() === apkName;
  });
}

function stripReleaseLabel(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/^v/i, '')
    .replace(/^Branch Agent\s+/i, '');
}

function versionCodeFromLabel(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = parseRemoteVersion(stripReleaseLabel(value));
  return parsed.versionCode;
}

/**
 * versionCode is the Android APK workflow's run number. The workflow publishes it as
 * `branch-android-<version>.apk.versioncode.<runNumber>` next to the APK and `.sha256`
 * sidecar. The updater also accepts `+<runNumber>` in the APK name, tag, release name,
 * or `.sha256` name when a release is attached by hand.
 */
export function versionCodeFromAssets(
  version: string,
  assets: ReleaseAsset[],
  release?: Pick<GithubRelease, 'tag_name' | 'name'>,
): number | undefined {
  const fromApk = parseRemoteVersion(version);
  if (fromApk.versionCode != null) return fromApk.versionCode;

  const prefix = `branch-android-${version}.apk.versioncode.`;
  for (const asset of assets) {
    if (!asset.name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const n = Number(asset.name.slice(prefix.length));
    if (Number.isInteger(n) && n > 0) return n;
  }

  const fromTag = versionCodeFromLabel(release?.tag_name);
  if (fromTag != null) return fromTag;
  const fromName = versionCodeFromLabel(release?.name);
  if (fromName != null) return fromName;

  for (const asset of assets) {
    const sha = SHA256_NAME_RE.exec(asset.name);
    if (!sha) continue;
    const parsed = parseRemoteVersion(sha[1]);
    if (parsed.versionCode != null) return parsed.versionCode;
  }
  return undefined;
}

export function offerFromRelease(release: GithubRelease): ApkOffer | null {
  if (release.draft) return null;
  const apk = release.assets.find(
    (asset) =>
      ANDROID_APK_RE.test(asset.name)
      && !asset.name.toLowerCase().includes('.apk.')
      && !asset.name.toLowerCase().includes('-unsigned'),
  );
  if (!apk) return null;
  const sha256 = sha256AssetFor(apk, release.assets);
  if (!sha256) return null;
  const version = ANDROID_APK_RE.exec(apk.name)?.[1];
  if (!version) return null;
  const versionCode = versionCodeFromAssets(version, release.assets, release);
  const parsed = parseRemoteVersion(version);
  return {
    version,
    remote: versionCode != null ? { name: parsed.name, versionCode } : { name: parsed.name },
    apk,
    sha256,
    tag: release.tag_name,
  };
}

/** Newest published `branch-android-<version>.apk` that is newer than this install and has a `.sha256` sidecar. */
export function findNewerApk(
  releases: GithubRelease[],
  local: { version: string; versionCode: number },
): ApkOffer | null {
  let best: ApkOffer | null = null;
  for (const release of releases) {
    const offer = offerFromRelease(release);
    if (!offer || !isNewerApk(offer.remote, local)) continue;
    if (
      !best ||
      (offer.remote.versionCode != null && best.remote.versionCode != null
        ? offer.remote.versionCode > best.remote.versionCode
        : compareVersions(offer.version, best.version) > 0)
    ) {
      best = offer;
    }
  }
  return best;
}

export async function fetchReleases(
  load: (url: string) => Promise<unknown> = defaultLoad,
): Promise<GithubRelease[]> {
  const body = await load(`${GITHUB_RELEASES_URL}?per_page=30`);
  return Array.isArray(body) ? (body as GithubRelease[]) : [];
}

async function defaultLoad(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Branch-Android',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new VerifyError('Couldn’t check GitHub for an update.');
  return response.json();
}
