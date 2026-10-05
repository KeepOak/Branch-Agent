// Branch: the "files" scope of a Git backup. It adds what the database dumps leave out — the redacted
// config file and each Trunk's workspace (memory markdown, instructions, Library documents) — and never
// copies secrets: credential-shaped files, SQLite databases, the state directory, agent directories and
// private update captures are skipped, symbolic links are never followed, and the config is redacted.
import fs from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "../infra/fs-safe.js";
import { isUpdateCapturePath } from "../infra/update-capture-paths.js";

export const GIT_BACKUP_FILES_SCOPE = "files";
const FILES_MANIFEST = "manifest.json";
const FILES_KIND = "branch-git-backup-files";

/** Names never copied from a workspace: credentials, keys, live databases and rebuildable trees. */
const SECRET_FILE_NAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  "auth-profiles.json",
  "auth.json",
  "credentials.json",
]);
const SKIPPED_DIR_NAMES = new Set([".git", "node_modules", "credentials"]);
const SECRET_FILE_PATTERNS = [
  /^\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.sqlite(3)?(-wal|-shm|-journal)?$/i,
];

export type GitBackupFilesSource = {
  stateDir: string;
  /** Redacted authored config, or undefined when the config could not be redacted safely. */
  config?: unknown;
  workspaces: Array<{ agentId: string; path: string }>;
  /** Roots never copied even when a workspace contains them (config, credentials, agents, repo). The
   *  state directory is guarded too, unless the workspace itself lives inside it (the default layout). */
  protectedPaths: string[];
};

type FilesManifest = {
  kind: typeof FILES_KIND;
  schemaVersion: 1;
  config: boolean;
  workspaces: Array<{ agentId: string; files: number }>;
  skipped: number;
};

export function isSecretWorkspaceName(name: string): boolean {
  return SECRET_FILE_NAMES.has(name.toLowerCase()) || SECRET_FILE_PATTERNS.some((p) => p.test(name));
}

function isProtected(entry: string, protectedPaths: string[]): boolean {
  return protectedPaths.some((root) => entry === root || isPathInside(root, entry));
}

type WalkState = { files: number; skipped: number; guards: string[]; stateDir: string };

async function copyTree(source: string, target: string, state: WalkState): Promise<void> {
  if (isUpdateCapturePath(source, state.stateDir)) {
    state.skipped += 1;
    return;
  }
  const entries = await fs.readdir(source, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    const protectedHere = isProtected(from, state.guards);
    if (protectedHere || entry.isSymbolicLink() || isSecretWorkspaceName(entry.name)) {
      state.skipped += 1;
      continue;
    }
    if (entry.isDirectory()) {
      if (SKIPPED_DIR_NAMES.has(entry.name.toLowerCase())) {
        state.skipped += 1;
        continue;
      }
      await copyTree(from, to, state);
    } else if (entry.isFile()) {
      await fs.mkdir(target, { recursive: true, mode: 0o700 });
      await fs.copyFile(from, to);
      state.files += 1;
    }
  }
}

async function canonical(entry: string): Promise<string> {
  return await fs.realpath(entry).catch(() => path.resolve(entry));
}

/** Write the files scope into a fresh directory (the caller replaces the repository copy with it). */
export async function writeGitBackupFiles(
  outputDir: string,
  source: GitBackupFilesSource,
): Promise<FilesManifest> {
  const protectedPaths = await Promise.all(source.protectedPaths.map(canonical));
  const stateDir = await canonical(source.stateDir);
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const manifest: FilesManifest = {
    kind: FILES_KIND,
    schemaVersion: 1,
    config: source.config !== undefined,
    workspaces: [],
    skipped: 0,
  };
  if (source.config !== undefined) {
    await fs.mkdir(path.join(outputDir, "config"), { recursive: true, mode: 0o700 });
    const configJson = `${JSON.stringify(source.config, null, 2)}\n`;
    await fs.writeFile(path.join(outputDir, "config", "branch.json"), configJson, { mode: 0o600 });
  }
  const seen = new Set<string>();
  for (const workspace of source.workspaces) {
    const root = await canonical(workspace.path);
    const exists = await fs.stat(root).then((s) => s.isDirectory(), () => false);
    // A shared workspace is copied once, under the first Trunk that uses it.
    if (!exists || seen.has(root) || isProtected(root, protectedPaths)) {
      continue;
    }
    seen.add(root);
    const guards = isPathInside(stateDir, root) ? protectedPaths : [...protectedPaths, stateDir];
    const state: WalkState = { files: 0, skipped: 0, guards, stateDir };
    const target = path.join(outputDir, "workspaces", workspace.agentId);
    await copyTree(root, target, state);
    manifest.workspaces.push({ agentId: workspace.agentId, files: state.files });
    manifest.skipped += state.skipped;
  }
  await fs.writeFile(
    path.join(outputDir, FILES_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  return manifest;
}

/** The files scope is backup-owned when it is missing, empty or carries this manifest. */
export async function isBackupOwnedFilesScope(scopePath: string): Promise<boolean> {
  const entries = await fs.readdir(scopePath).catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? [] : null,
  );
  if (entries === null) {
    return false;
  }
  if (entries.length === 0) {
    return true;
  }
  try {
    const raw = await fs.readFile(path.join(scopePath, FILES_MANIFEST), "utf8");
    return (JSON.parse(raw) as { kind?: unknown }).kind === FILES_KIND;
  } catch {
    return false;
  }
}

