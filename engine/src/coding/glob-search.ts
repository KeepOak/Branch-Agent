import path from "node:path";
import { minimatch } from "minimatch";

const EXCLUDED_DIR_NAMES = new Set([".git", "node_modules", "dist", ".turbo", ".cache"]);

export type GlobEntry = { name: string; isDirectory: boolean };
export type GlobStat = { type: "file" | "directory" | "other"; mtimeMs: number };
export type GlobPaths = Pick<typeof path, "join" | "relative" | "sep">;
export type GlobOperations = {
  paths?: GlobPaths;
  validatePath: (filePath: string, signal?: AbortSignal) => Promise<string | void>;
  readDirectory: (directory: string, signal?: AbortSignal) => Promise<GlobEntry[]>;
  stat: (filePath: string, signal?: AbortSignal) => Promise<GlobStat | null>;
};

export function unsafeGlobPattern(pattern: string): string | undefined {
  if (pattern.includes("\0")) return "glob pattern must not contain NUL";
  if (path.isAbsolute(pattern) || pattern.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(pattern)) {
    return "glob pattern must be relative to the validated search root";
  }
  if (/(?:^|[\\/,{])\.\.(?=$|[\\/,}])/.test(pattern)) {
    return "glob pattern must not traverse above the validated search root";
  }
  return undefined;
}

export function matchesGlobPattern(candidate: string, pattern: string): boolean {
  return minimatch(candidate, pattern, { dot: false, nocomment: true, nonegate: true });
}

export async function walkContainedGlob(
  root: string,
  pattern: string,
  readDirectory: GlobOperations["readDirectory"],
  paths: GlobPaths = path,
  signal?: AbortSignal,
): Promise<string[]> {
  const results: string[] = [];
  const canMatchDescendants = /[\\/]/.test(pattern);
  async function walk(directory: string): Promise<void> {
    signal?.throwIfAborted();
    const entries = await readDirectory(directory, signal).catch(() => []);
    signal?.throwIfAborted();
    for (const entry of entries) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      const absolute = paths.join(directory, entry.name);
      if (entry.isDirectory) {
        if (canMatchDescendants) await walk(absolute);
        continue;
      }
      const relative = paths.relative(root, absolute).split(paths.sep).join("/");
      if (matchesGlobPattern(relative, pattern)) results.push(absolute);
    }
  }
  await walk(root);
  return results;
}

async function enrichGlobCandidate(
  filePath: string,
  operations: GlobOperations,
  signal?: AbortSignal,
) {
  const stat = await operations.stat(filePath, signal).catch(() => null);
  signal?.throwIfAborted();
  return stat?.type === "file" ? { filePath, mtimeMs: stat.mtimeMs } : undefined;
}

export async function searchContainedGlob(
  root: string,
  pattern: string,
  operations: GlobOperations,
  signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted();
  if (!pattern) throw new Error("pattern is required");
  const failure = unsafeGlobPattern(pattern);
  if (failure) throw new Error(failure);
  const searchRoot = (await operations.validatePath(root, signal)) ?? root;
  const candidates = await walkContainedGlob(
    searchRoot,
    pattern,
    operations.readDirectory,
    operations.paths,
    signal,
  );
  for (const candidate of candidates) {
    signal?.throwIfAborted();
    await operations.validatePath(candidate, signal);
  }
  const stats = await Promise.all(
    candidates.map((candidate) => enrichGlobCandidate(candidate, operations, signal)),
  );
  const files = stats.filter(
    (entry): entry is { filePath: string; mtimeMs: number } => entry !== undefined,
  );
  files.sort((a, b) => {
    const bMtime = Number.isFinite(b.mtimeMs) ? b.mtimeMs : 0;
    const aMtime = Number.isFinite(a.mtimeMs) ? a.mtimeMs : 0;
    return bMtime - aMtime || a.filePath.localeCompare(b.filePath);
  });
  return files.map((entry) => entry.filePath);
}
