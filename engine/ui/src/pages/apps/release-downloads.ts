const RELEASES_PAGE = "https://github.com/KeepOak/Branch-Agent/releases";

/**
 * Branch's own download pages for Get the apps (Private #1103). Never a store listing.
 * Plain links: the Control UI's content security policy blocks reading the releases API from the page.
 */
export const BRANCH_DOWNLOAD_PAGES = {
  mac: `${RELEASES_PAGE}/latest`,
  windows: `${RELEASES_PAGE}/latest`,
  linux: `${RELEASES_PAGE}/latest`,
  // Android builds ship in their own releases, so the latest one may have no APK.
  android: RELEASES_PAGE,
} as const;

export type ReleaseDownloadId = keyof typeof BRANCH_DOWNLOAD_PAGES;
