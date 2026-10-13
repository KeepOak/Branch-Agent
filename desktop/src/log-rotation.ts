// Size-capped log files for the desktop's own logs (desktop.log, gateway.log). The rule and the archive names are
// upstream OpenClaw's: src/logging/logger.ts in cd89adf0ac01 ("fix(logging): rotate file logs instead of
// suppressing") and engine/src/logging/logger-file-transport.ts (rotateLogFile). The live file rotates when the
// next write would pass the cap, and the newest archives stay as name.1.ext through name.5.ext.
import { appendFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { extname } from "node:path";
import { Writable } from "node:stream";

/** Upstream's default for logging.maxFileBytes. */
export const LOG_MAX_BYTES = 100 * 1024 * 1024;
/** Numbered archives kept beside the live file (upstream MAX_ROTATED_LOG_FILES). */
export const LOG_ROTATED_FILES = 5;

export function rotatedLogPath(file: string, index: number): string {
  const ext = extname(file);
  return `${file.slice(0, file.length - ext.length)}.${index}${ext}`;
}

/** Drops the oldest archive, shifts the others up one and moves the live file to name.1. */
function rotate(file: string): void {
  rmSync(rotatedLogPath(file, LOG_ROTATED_FILES), { force: true });
  for (let index = LOG_ROTATED_FILES - 1; index >= 1; index -= 1) {
    if (existsSync(rotatedLogPath(file, index))) renameSync(rotatedLogPath(file, index), rotatedLogPath(file, index + 1));
  }
  if (existsSync(file)) renameSync(file, rotatedLogPath(file, 1));
}

/** Appends text. The live file rotates first when this write would take it past maxBytes. */
export function appendCappedLog(file: string, text: string | Buffer, maxBytes = LOG_MAX_BYTES): void {
  const size = existsSync(file) ? statSync(file).size : 0;
  if (size > 0 && size + Buffer.byteLength(text) > maxBytes) {
    // A failed rotation keeps appending to the live file: a log over its cap beats lost lines.
    try { rotate(file); } catch { /* keep appending */ }
  }
  appendFileSync(file, text);
}

/**
 * A writable for a child's output. Each chunk goes through appendCappedLog, which reopens the file by path, so a
 * rotation never leaves a stream writing into an archive.
 */
export function cappedLogStream(file: string, maxBytes = LOG_MAX_BYTES): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      // A full disk must never stop the engine's output or the app.
      try { appendCappedLog(file, chunk, maxBytes); } catch { /* the chunk is dropped */ }
      callback();
    },
  });
}
