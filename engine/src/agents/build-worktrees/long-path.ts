import path from "node:path";

/**
 * Windows refuses ordinary paths past 260 characters, which deep node_modules trees pass easily.
 * The \\?\ namespace (\\?\UNC\ for shares) lifts that limit; other platforms keep the path unchanged.
 */
export function toLongPathSafe(
  target: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") {
    return target;
  }
  return path.win32.toNamespacedPath(path.win32.resolve(target));
}

/** Git on Windows needs core.longpaths for checkouts with paths past 260 characters. */
export function buildWorktreeGitArgs(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === "win32" ? ["-c", "core.longpaths=true", ...args] : [...args];
}
