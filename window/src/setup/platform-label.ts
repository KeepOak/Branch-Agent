// The computer's platform in plain words, for setup and Settings copy.
export function platformName(): string {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform.toLowerCase();
  return platform.includes("mac") ? "macOS" : platform.includes("linux") ? "Linux" : platform.includes("win") ? "Windows" : "this computer";
}
export function matchPlatformLabel(): string {
  const platform = platformName();
  return platform === "macOS" ? "Match macOS" : platform === "Windows" ? "Match Windows" : "Match this computer";
}
