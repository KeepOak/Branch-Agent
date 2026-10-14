// Size-capped log files for the desktop's own logs (desktop.log, gateway.log). The live file rotates when the next
// write would pass the cap, and the newest archives stay as name.1.ext through name.5.ext.
import { appendFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { extname } from "node:path";
import { Writable } from "node:stream";

/** Default cap for one log file: 100 MB. */
export const LOG_MAX_BYTES = 100 * 1024 * 1024;
/** Numbered archives kept beside the live file. */
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

/**
 * Appends text. The live file rotates first when this write would take it past maxBytes. Never throws: a full disk,
 * a missing directory or a failed rotation drops or keeps the line, and the app keeps running.
 */
export function appendCappedLog(file: string, text: string | Buffer, maxBytes = LOG_MAX_BYTES): void {
  try {
    const size = existsSync(file) ? statSync(file).size : 0;
    if (size > 0 && size + Buffer.byteLength(text) > maxBytes) {
      // A failed rotation keeps appending to the live file: a log over its cap beats lost lines.
      try { rotate(file); } catch { /* keep appending */ }
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
export function cappedLogStream(file: string, maxBytes = LOG_MAX_BYTES): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      appendCappedLog(file, chunk, maxBytes);
      callback();
    },
  });
}
