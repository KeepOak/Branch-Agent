// Scrubs sensitive credentials from existing log files on startup.
import fs from "node:fs/promises";
import path from "node:path";
import { canUseNodeFs, LOG_PREFIX, LOG_SUFFIX } from "./log-file-shared.js";
import { redactSensitiveLines, resolveRedactOptions } from "./redact.js";

const MAX_SCRUB_FILE_SIZE = 200 * 1024 * 1024; // 200 MB
const SCRUB_BATCH_SIZE = 10_000; // Process 10K lines at a time

/**
 * Scrubs sensitive data from all log files in the given directory.
 * Called on gateway/daemon startup to retroactively redact any leaked credentials.
 */
export async function scrubLogDirectory(
  logDir: string,
  opts?: { dryRun?: boolean },
): Promise<{ scrubbedFiles: number; skippedFiles: number; errors: string[] }> {
  if (!canUseNodeFs()) {
    return { scrubbedFiles: 0, skippedFiles: 0, errors: [] };
  }

  const redactOpts = resolveRedactOptions();
  const errors: string[] = [];
  let scrubbedFiles = 0;
  let skippedFiles = 0;

  try {
    const entries = await fs.readdir(logDir, { withFileTypes: true });
    const logFiles = entries.filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.startsWith(`${LOG_PREFIX}-`) || entry.name === "branch.log") &&
        (entry.name.endsWith(LOG_SUFFIX) || entry.name === "branch.log"),
    );

    for (const entry of logFiles) {
      const filePath = path.join(logDir, entry.name);
      try {
        const stat = await fs.stat(filePath);
        if (stat.size === 0) {
          continue;
        }
        if (stat.size > MAX_SCRUB_FILE_SIZE) {
          skippedFiles += 1;
          errors.push(`Skipped ${entry.name} (${stat.size} bytes exceeds limit)`);
          continue;
        }

        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split("\n");
        const redactedLines = redactSensitiveLines(
          lines,
          redactOpts,
          lines.map(() => true),
        );
        const redactedContent = redactedLines.join("\n");

        if (redactedContent !== content) {
          if (!opts?.dryRun) {
            await fs.writeFile(filePath, redactedContent, "utf8");
          }
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
