/** Dotted version parts, ignoring a `-build` / `+meta` suffix. `0.2.0-build-abc` → [0, 2, 0]. */
export function versionParts(value: string): number[] {
  const core = value.trim().split(/[-+]/)[0] ?? '';
  return core.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff > 0) return 1;
    if (diff < 0) return -1;
  }
  return 0;
}

export type RemoteVersion = { name: string; versionCode?: number };

/**
 * Filename versions: `0.2.0`, `0.2.0+12` (name + versionCode), or `12` (versionCode only).
 */
export function parseRemoteVersion(version: string): RemoteVersion {
  const trimmed = version.trim();
  if (/^\d+$/.test(trimmed)) return { name: trimmed, versionCode: Number(trimmed) };
  const plus = /^(.+)\+(\d+)$/.exec(trimmed);
  if (plus) return { name: plus[1], versionCode: Number(plus[2]) };
  return { name: trimmed };
}

/** True when the GitHub APK is newer than what is installed. Prefers versionCode when the filename has one. */
export function isNewerApk(
  remote: RemoteVersion,
  local: { version: string; versionCode: number },
): boolean {
  if (remote.versionCode != null) return remote.versionCode > local.versionCode;
  return compareVersions(remote.name, local.version) > 0;
}
