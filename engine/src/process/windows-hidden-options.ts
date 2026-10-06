/** Hide Windows console children by default while preserving explicit GUI launches. */
export function hiddenWindowsOptions<T extends object>(
  options: T,
  platform: NodeJS.Platform = process.platform,
): T & { windowsHide?: boolean } {
  const current = options as T & { windowsHide?: boolean };
  return platform === "win32"
    ? { ...options, windowsHide: current.windowsHide ?? true }
    : current;
}
