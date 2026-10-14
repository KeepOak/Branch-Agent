// Size-capped log files for the desktop's own logs (desktop.log, gateway.log). The live file rotates when the next
// write would pass the cap, and the newest archives stay as name.1.ext through name.N.ext.
import { appendFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { extname } from "node:path";
import { Writable } from "node:stream";

/** How large one capped log may grow and how many numbered archives stay beside the live file. */
export interface LogLimits {
  maxBytes: number;
  archives: number;
}

/** Branch's limits for desktop.log and gateway.log: 20 MB per file, two archives (60 MB worst case per log). */
export const BRANCH_LOG_LIMITS: LogLimits = { maxBytes: 20 * 1024 * 1024, archives: 2 };

export function rotatedLogPath(file: string, index: number): string {
  const ext = extname(file);
  return `${file.slice(0, file.length - ext.length)}.${index}${ext}`;
}

/** Drops the oldest archive, shifts the others up one and moves the live file to name.1. */
function rotate(file: string, archives: number): void {
  rmSync(rotatedLogPath(file, archives), { force: true });
  for (let index = archives - 1; index >= 1; index -= 1) {
    if (existsSync(rotatedLogPath(file, index))) renameSync(rotatedLogPath(file, index), rotatedLogPath(file, index + 1));
  }
  if (existsSync(file)) renameSync(file, rotatedLogPath(file, 1));
}

/**
 * Appends text. The live file rotates first when this write would take it past limits.maxBytes. Never throws: a full
 * disk, a missing directory or a failed rotation drops or keeps the line, and the app keeps running.
 */
export function appendCappedLog(file: string, text: string | Buffer, limits: LogLimits): void {
  try {
    const size = existsSync(file) ? statSync(file).size : 0;
    if (size > 0 && size + Buffer.byteLength(text) > limits.maxBytes) {
      // A failed rotation keeps appending to the live file: a log over its cap beats lost lines.
      try { rotate(file, limits.archives); } catch { /* keep appending */ }
    }
    appendFileSync(file, text);
  } catch {
    // This line is dropped; the next write tries again.
  }
}

/**
 * A writable for a child's output. Each chunk goes through appendCappedLog, which reopens the file by path, so a
 * rotation never leaves a stream writing into an archive, and a write error never reaches the stream.
 */
export function cappedLogStream(file: string, limits: LogLimits): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      appendCappedLog(file, chunk, limits);
      callback();
    },
  });
}
