/**
 * The Codex installed on this computer. Branch Agent releases ship no Codex
 * binary, only the small @openai/codex launcher. A Codex turn runs, in order:
 *
 * 1. a codex on PATH at or above the supported minimum
 *    (MIN_SUPPORTED_CODEX_APP_SERVER_VERSION), checked with "codex --version";
 * 2. the bundled platform package, when this build still has it (source
 *    checkouts);
 * 3. the Codex desktop app on macOS, as before.
 *
 * With none of them, the registered first-use download (on-demand.ts) fetches
 * the pinned package. With no download registered, starting Codex fails with
 * the same sentence Settings › Accounts › Coding apps shows on the Codex row.
 */
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { parse as parseSemver } from "semver";
import { MIN_SUPPORTED_CODEX_APP_SERVER_VERSION } from "./version.js";

/** The Codex row's line in Settings › Accounts › Coding apps (§4.7.8), and a Codex turn's error. */
export const CODEX_NOT_INSTALLED_MESSAGE =
  "Install and sign in to Codex on this computer, then check again.";

/** No Codex to start: nothing on PATH, no bundled platform package, no desktop app. */
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
  const now = deps.now ?? Date.now;
  let pathCache:
    | { key: string; at: number; found?: { command: string; version: string } }
    | undefined;

  async function findPathCommand() {
    const key = env.PATH ?? env.Path ?? "";
    if (pathCache && pathCache.key === key && now() - pathCache.at < PATH_CACHE_MS) {
      return pathCache.found;
    }
    let found: { command: string; version: string } | undefined;
    for (const candidate of pathCandidates(key, platform)) {
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

function pathCandidates(searchPath: string, platform: NodeJS.Platform): string[] {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const names = platform === "win32" ? ["codex.exe", "codex.cmd"] : ["codex"];
  const result: string[] = [];
  for (const dir of searchPath.split(platform === "win32" ? ";" : ":")) {
    const trimmed = dir.trim().replace(/^"(.*)"$/u, "$1");
    if (!trimmed || !pathApi.isAbsolute(trimmed)) {
      continue;
    }
    for (const name of names) {
      result.push(pathApi.join(trimmed, name));
    }
  }
  return result;
}

async function isExecutable(file: string, platform: NodeJS.Platform): Promise<boolean> {
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
      (error, stdout) => resolve(error ? undefined : String(stdout)),
    );
  });
}
