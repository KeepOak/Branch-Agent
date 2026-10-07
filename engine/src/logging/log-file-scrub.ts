// Scrubs credentials from rotated or retired log files without touching the live file.
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { replaceFileAtomic } from "@openclaw/fs-safe/atomic";
import { resolveGatewayLogPaths, resolveGatewaySupervisorLogPaths } from "../daemon/restart-logs.js";
import { desktopDataDirectory } from "../mcp/desktop-gateway.js";
import { canUseNodeFs } from "./log-file-shared.js";
import { redactSensitiveLines, resolveRedactOptions } from "./redact.js";

/** Read window for bounded scrubbing. Used so a secret can sit across a chunk boundary. */
export const SCRUB_CHUNK_SIZE = 64 * 1024;
/** Extra bytes kept from the previous window so a split secret is still redacted. */
export const SCRUB_CHUNK_OVERLAP = 8 * 1024;

const DATED_ROLLING_LOG_RE = /^branch(?:-[a-z0-9-]+)?-\d{4}-\d{2}-\d{2}\.log$/u;
const SIZE_ROTATED_LOG_RE = /\.\d+\.log$/u;
const SYSLOG_ROTATED_LOG_RE = /\.log\.\d+$/u;

export type ScrubLogDirectoryOptions = {
  dryRun?: boolean;
  skipFiles?: readonly string[];
  beforeRename?: (params: { filePath: string; tempPath: string }) => Promise<void>;
};

/**
 * Size-rotated copies (`branch.1.log`, `gateway.1.log`, `background.1.log`),
 * syslog-rotated copies (`gateway.log.1`), and dated rolling files that are no
 * longer the active write target.
 */
export function isRotatedOrRetiredLogName(name: string): boolean {
  return (
    SIZE_ROTATED_LOG_RE.test(name) ||
    SYSLOG_ROTATED_LOG_RE.test(name) ||
    DATED_ROLLING_LOG_RE.test(name)
  );
}

function resolveExistingDir(dir: string, dirs: Set<string>): void {
  dirs.add(path.resolve(dir));
}

/**
 * Engine logger dir plus the desktop data dir and daemon gateway log dirs,
 * resolved through the same helpers the apps use. No user paths are hard-coded.
 */
export function resolveLogScrubDirectories(
  engineLogDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const dirs = new Set<string>();
  resolveExistingDir(engineLogDir, dirs);

  const testControlled = Boolean(env.BRANCH_STATE_DIR || env.BRANCH_DESKTOP_DATA || env.BRANCH_HOME);
  if (env.VITEST === "true" && !testControlled) {
    return [...dirs];
  }

  try {
    resolveExistingDir(resolveGatewayLogPaths(env).logDir, dirs);
  } catch {
    // HOME or state dir may be unset in constrained service environments.
  }
  try {
    resolveExistingDir(resolveGatewaySupervisorLogPaths(env).logDir, dirs);
  } catch {
    // Same: supervisor paths need a resolvable home.
  }

  try {
    resolveExistingDir(desktopDataDirectory(env), dirs);
  } catch {
    // Desktop data dir is optional when the engine is not launched by the app.
  }

  const branchHome = env.BRANCH_HOME?.trim();
  if (branchHome && path.basename(branchHome) === "home") {
    resolveExistingDir(path.dirname(branchHome), dirs);
  }

  return [...dirs];
}

function resolveSkipFiles(skipFiles: readonly string[] | undefined): Set<string> {
  return new Set((skipFiles ?? []).map((file) => path.resolve(file)));
}

function redactWindow(text: string, redactOpts: ReturnType<typeof resolveRedactOptions>): string {
  return redactSensitiveLines(text.split("\n"), redactOpts).join("\n");
}

/**
 * Redacts `text` in bounded windows. Consecutive windows overlap so a secret
 * that starts near a chunk boundary is still visible to the matcher.
 */
export function redactTextInOverlappingChunks(
  text: string,
  redactOpts: ReturnType<typeof resolveRedactOptions> = resolveRedactOptions(),
  chunkSize = SCRUB_CHUNK_SIZE,
  overlap = SCRUB_CHUNK_OVERLAP,
): string {
  if (text.length <= chunkSize) {
    return redactWindow(text, redactOpts);
  }
  const parts: string[] = [];
  let offset = 0;
  let hold = "";
  while (offset < text.length) {
    const end = Math.min(offset + chunkSize, text.length);
    const window = hold + text.slice(offset, end);
    const redacted = redactWindow(window, redactOpts);
    if (end >= text.length) {
      parts.push(redacted);
      break;
    }
    const nextHold = window.slice(-overlap);
    if (redacted.endsWith(nextHold)) {
      parts.push(redacted.slice(0, redacted.length - nextHold.length));
      hold = nextHold;
    } else {
      // The overlap was redacted. Emit the whole window and do not replay the
      // original hold — replaying it would duplicate bytes in the output.
      parts.push(redacted);
      hold = "";
    }
    offset = end;
  }
  return parts.join("");
}

async function readAndRedactLogFile(
  filePath: string,
  redactOpts: ReturnType<typeof resolveRedactOptions>,
): Promise<string | null> {
  const stream = createReadStream(filePath, { highWaterMark: SCRUB_CHUNK_SIZE });
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const out: string[] = [];
  let changed = false;

  const flush = (ending: boolean): void => {
    if (pending.length === 0) {
      return;
    }
    if (!ending && pending.length <= SCRUB_CHUNK_OVERLAP) {
      return;
    }
    const hold = ending ? "" : pending.slice(-SCRUB_CHUNK_OVERLAP);
    const window = pending;
    const redacted = redactTextInOverlappingChunks(window, redactOpts);
    if (redacted !== window) {
      changed = true;
    }
    if (hold && redacted.endsWith(hold)) {
      out.push(redacted.slice(0, redacted.length - hold.length));
      pending = hold;
      return;
    }
    out.push(redacted);
    pending = "";
  };

  for await (const chunk of stream) {
    pending += decoder.write(chunk);
    if (pending.length >= SCRUB_CHUNK_SIZE + SCRUB_CHUNK_OVERLAP) {
      flush(false);
    }
  }
  pending += decoder.end();
  flush(true);
  return changed ? out.join("") : null;
}

async function scrubLogFile(
  filePath: string,
  redactOpts: ReturnType<typeof resolveRedactOptions>,
  opts?: ScrubLogDirectoryOptions,
): Promise<boolean> {
  const redacted = await readAndRedactLogFile(filePath, redactOpts);
  if (redacted === null) {
    return false;
  }
  if (!opts?.dryRun) {
    await replaceFileAtomic({
      filePath,
      content: redacted,
      syncTempFile: true,
      copyFallbackOnPermissionError: true,
      preserveExistingMode: true,
      tempPrefix: ".branch-log-scrub",
      ...(opts?.beforeRename ? { beforeRename: opts.beforeRename } : {}),
    });
  }
  return true;
}

/**
 * Scrubs sensitive data from rotated or retired log files in `logDir`.
 * Never rewrites `skipFiles` (the live logger target).
 */
export async function scrubLogDirectory(
  logDir: string,
  opts?: ScrubLogDirectoryOptions,
): Promise<{ scrubbedFiles: number; skippedFiles: number; errors: string[] }> {
  if (!canUseNodeFs()) {
    return { scrubbedFiles: 0, skippedFiles: 0, errors: [] };
  }

  const redactOpts = resolveRedactOptions();
  const errors: string[] = [];
  let scrubbedFiles = 0;
  let skippedFiles = 0;
  const skipFiles = resolveSkipFiles(opts?.skipFiles);

  try {
    const entries = await fs.readdir(logDir, { withFileTypes: true });
    const logFiles = entries.filter((entry) => entry.isFile() && isRotatedOrRetiredLogName(entry.name));

    for (const entry of logFiles) {
      const filePath = path.join(logDir, entry.name);
      if (skipFiles.has(path.resolve(filePath))) {
        skippedFiles += 1;
        continue;
      }
      try {
        const stat = await fs.stat(filePath);
        if (stat.size === 0) {
          continue;
        }
        if (await scrubLogFile(filePath, redactOpts, opts)) {
          scrubbedFiles += 1;
        }
      } catch (error) {
        errors.push(`Failed to scrub ${entry.name}: ${String(error)}`);
      }
    }
  } catch (error) {
    errors.push(`Failed to read log directory: ${String(error)}`);
  }

  return { scrubbedFiles, skippedFiles, errors };
}
