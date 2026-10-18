import { installerAssetName } from "./release-inventory.mjs";

const repository = "KeepOak/Branch-Agent";
export const UPDATE_ONLY_LABEL = "used by automatic updates, you don't need this";

/** One person-facing installer per platform, in the order a stranger reads the release page. */
export const DOWNLOAD_PLATFORMS = Object.freeze([
  ["macOS", "darwin-arm64"],
  ["Windows", "win32-x64"],
  ["Linux", "linux-x64"],
]);

function assetUrl(version, name) {
  return `https://github.com/${repository}/releases/download/v${version}/${name}`;
}

/** The installer a person should grab for this target, or null when that target has none. */
export function downloadAssetName(version, target) {
  return installerAssetName(version, target);
}

/**
 * Release-page notes. A short Download block names the one installer per platform that is
 * actually on the release; every other uploaded file is labeled as update-only.
 */
export function formatReleaseNotes({ commit, version, names }) {
  const uploaded = [...new Set(names)];
  const downloads = [];
  const downloadNames = new Set();
  for (const [label, target] of DOWNLOAD_PLATFORMS) {
    const name = downloadAssetName(version, target);
    if (!name || !uploaded.includes(name)) continue;
    downloadNames.add(name);
    downloads.push(`- ${label}: [${name}](${assetUrl(version, name)})`);
  }
  const others = uploaded.filter((name) => !downloadNames.has(name)).sort();
  return [
    "Download this",
    "",
    ...downloads,
    ...(downloads.length ? [""] : []),
    ...(others.length ? ["Other files", ""] : []),
    ...others.map((name) => `- ${name}: ${UPDATE_ONLY_LABEL}`),
    ...(others.length ? [""] : []),
    `Branch Agent built from ${commit}.`,
    "",
    "Native Windows x64, macOS arm64 and Linux x64 packages; verified engine, renderer and desktop app update components. Existing data and credentials are retained. Installed desktop apps take the new desktop app on their next start.",
    "",
  ].join("\n");
}
