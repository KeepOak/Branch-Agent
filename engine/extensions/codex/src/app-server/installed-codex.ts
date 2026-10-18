/**
 * The Codex installed on this computer. Branch Agent releases ship no Codex
 * binary, only the small @openai/codex launcher. A Codex turn runs, in order:
 *
 * 1. a codex on PATH at or above the supported minimum
 *    (MIN_SUPPORTED_CODEX_APP_SERVER_VERSION), checked with "codex --version";
 *    PATH entries may be `~/…` (Linux desktop files often leave the tilde);
 * 2. the official standalone install next to the saved ChatGPT sign-in
 *    (`~/.local/bin`, `$CODEX_HOME/packages/standalone/current`), because a
 *    Linux desktop, AppImage or service PATH is often `/usr/bin:/bin`;
 * 3. the bundled platform package, when this build still has it (source
 *    checkouts);
 * 4. the Codex desktop app on macOS, as before.
 *
 * With none of them, starting Codex fails with the same sentence Settings ›
 * Accounts › Coding apps shows on the Codex row. Nothing is downloaded.
 */
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseSemver } from "semver";
import { MIN_SUPPORTED_CODEX_APP_SERVER_VERSION } from "./version.js";

/** The Codex row's line in Settings › Accounts › Coding apps (§4.7.8), and a Codex turn's error. */
export const CODEX_NOT_INSTALLED_MESSAGE =
  "Install and sign in to Codex on this computer, then check again.";

/** No Codex to start: nothing on PATH, no official standalone install, no bundled package, no desktop app. */
export class CodexNotInstalledError extends Error {
  constructor() {
    super(CODEX_NOT_INSTALLED_MESSAGE);
    this.name = "CodexNotInstalledError";
  }
}

export type InstalledCodexDeps = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Runs "<command> --version" and returns stdout, or undefined when it fails. */
  readVersion?: (command: string) => Promise<string | undefined>;
  /** Overrides the filesystem executable check (tests). */
  isExecutable?: (file: string, platform: NodeJS.Platform) => Promise<boolean>;
  now?: () => number;
};

export type InstalledCodex = {
  /** A codex on PATH at or above the supported minimum, or undefined. */
  findPathCommand(): Promise<{ command: string; version: string } | undefined>;
};

const PATH_CACHE_MS = 60_000;

export function createInstalledCodex(deps: InstalledCodexDeps = {}): InstalledCodex {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const readVersion = deps.readVersion ?? defaultReadVersion;
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const now = deps.now ?? Date.now;
  let pathCache:
    | { key: string; at: number; found?: { command: string; version: string } }
    | undefined;

  async function findPathCommand() {
    const key = lookupCacheKey(env);
    if (pathCache && pathCache.key === key && now() - pathCache.at < PATH_CACHE_MS) {
      return pathCache.found;
    }
    let found: { command: string; version: string } | undefined;
    for (const candidate of pathCandidates(env.PATH ?? env.Path ?? "", platform, env)) {
      if (!(await isExecutable(candidate, platform))) {
        continue;
      }
      // An older codex earlier on PATH is skipped; the next one is tried.
      const version = parseCodexVersion(await readVersion(candidate));
      if (version && meetsMinimum(version)) {
        found = { command: candidate, version };
        break;
      }
    }
    pathCache = { key, at: now(), ...(found ? { found } : {}) };
    return found;
  }

  return { findPathCommand };
}

/** "codex-cli 0.160.0" (or a bare version) to "0.160.0". */
export function parseCodexVersion(output: string | undefined): string | undefined {
  return /\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u.exec(output ?? "")?.[1];
}

function meetsMinimum(version: string): boolean {
  const parsed = parseSemver(version);
  return parsed !== null && parsed.compare(MIN_SUPPORTED_CODEX_APP_SERVER_VERSION) >= 0;
}

function lookupCacheKey(env: NodeJS.ProcessEnv): string {
  return [
    env.PATH ?? env.Path ?? "",
    env.HOME ?? "",
    env.USERPROFILE ?? "",
    env.CODEX_HOME ?? "",
    env.CODEX_INSTALL_DIR ?? "",
    env.XDG_BIN_HOME ?? "",
  ].join("\0");
}

/** OS account home. BRANCH_HOME is the engine workspace and hides a saved Codex. */
function resolveLookupHome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  const fromEnv = (platform === "win32" ? (env.USERPROFILE ?? env.HOME) : env.HOME)?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (env === process.env) {
    return os.homedir() || undefined;
  }
  return undefined;
}

function expandLookupDir(dir: string, home: string | undefined, pathApi: typeof path.posix): string {
  const trimmed = dir.trim().replace(/^"(.*)"$/u, "$1");
  if (!home) {
    return trimmed;
  }
  if (trimmed === "~") {
    return home;
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return pathApi.join(home, trimmed.slice(2));
  }
  return trimmed;
}

function wellKnownInstallDirs(
  env: NodeJS.ProcessEnv,
  home: string | undefined,
  pathApi: typeof path.posix,
): string[] {
  const dirs: string[] = [];
  const add = (dir: string | undefined) => {
    const trimmed = dir?.trim();
    if (trimmed && pathApi.isAbsolute(trimmed)) {
      dirs.push(pathApi.normalize(trimmed));
    }
  };
  // Official installer: BIN_DIR="${CODEX_INSTALL_DIR:-$HOME/.local/bin}".
  add(env.CODEX_INSTALL_DIR);
  add(env.XDG_BIN_HOME);
  if (home) {
    add(pathApi.join(home, ".local", "bin"));
  }
  // Official installer: CODEX_HOME="${CODEX_HOME:-$HOME/.codex}", then
  // packages/standalone/current[/bin]/codex (saved ChatGPT sign-in lives here).
  const codexHome = env.CODEX_HOME?.trim() || (home ? pathApi.join(home, ".codex") : undefined);
  if (codexHome && pathApi.isAbsolute(codexHome)) {
    const current = pathApi.join(codexHome, "packages", "standalone", "current");
    add(current);
    add(pathApi.join(current, "bin"));
  }
  return dirs;
}

function pathCandidates(
  searchPath: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const names = platform === "win32" ? ["codex.exe", "codex.cmd"] : ["codex"];
  const home = resolveLookupHome(env, platform);
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (file: string) => {
    if (!seen.has(file)) {
      seen.add(file);
      result.push(file);
    }
  };
  for (const dir of searchPath.split(platform === "win32" ? ";" : ":")) {
    const trimmed = expandLookupDir(dir, home, pathApi);
    if (!trimmed || !pathApi.isAbsolute(trimmed)) {
      continue;
    }
    for (const name of names) {
      add(pathApi.join(trimmed, name));
    }
  }
  for (const dir of wellKnownInstallDirs(env, home, pathApi)) {
    for (const name of names) {
      add(pathApi.join(dir, name));
    }
  }
  return result;
}

async function defaultIsExecutable(file: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(file, platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultReadVersion(command: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      command,
      ["--version"],
      {
        timeout: 5_000,
        windowsHide: true,
        shell: process.platform === "win32" && /\.cmd$/iu.test(command),
      },
      (error, stdout) => resolve(error ? undefined : stdout),
    );
  });
}
