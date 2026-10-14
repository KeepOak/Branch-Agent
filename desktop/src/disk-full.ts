// A full disk must never crash the desktop main process (Private #1036). A write that fails because the disk is full
// is skipped, the owner sees one plain banner, and the banner goes away once a write lands again or space comes back.
import { statfsSync, type StatsFs } from "node:fs";

/** The one banner the owner sees while the disk is full. */
export const DISK_FULL_MESSAGE = "Your disk is full. Branch paused saving until you free space.";
/** Free space that counts as "space came back" for the watch below. */
export const DISK_SPACE_BACK_BYTES = 64 * 1024 * 1024;

type Listener = (full: boolean) => void;
let full = false;
const listeners = new Set<Listener>();

/** ENOSPC (no space left) or EDQUOT (quota used up), also when wrapped in an error's cause. */
export function isDiskFullError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (code === "ENOSPC" || code === "EDQUOT") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function diskIsFull(): boolean {
  return full;
}

function notify(value: boolean): void {
  for (const listener of [...listeners]) {
    try { listener(value); } catch { /* a listener never stops the others or the write path */ }
  }
}

/** Called when the full state changes: true once when saving pauses, false once when it resumes. */
export function onDiskFullChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Records a write failure. True when the disk was full (the banner shows once); false for any other error. */
export function reportDiskFull(error: unknown): boolean {
  if (!isDiskFullError(error)) return false;
  if (!full) {
    full = true;
    notify(true);
  }
  return true;
}

/** A write landed again: saving has resumed and the banner goes away. */
export function reportDiskWritable(): void {
  if (!full) return;
  full = false;
  notify(false);
}

/**
 * Runs one synchronous write. A full disk skips it and returns false (the caller keeps its in-memory value); any
 * other error is the caller's, as before.
 */
export function saveUnlessDiskFull(write: () => void): boolean {
  try {
    write();
  } catch (error) {
    if (reportDiskFull(error)) return false;
    throw error;
  }
  reportDiskWritable();
  return true;
}

/** Electron's own report for an uncaught main-process error that is not a full disk. */
export type UncaughtFallback = (error: Error) => void;
interface ProcessLike { on(event: "uncaughtException", listener: (error: Error) => void): unknown }

/**
 * The main process's last line: a full-disk error that escaped a write path pauses saving instead of raising
 * Electron's modal "A JavaScript error occurred in the main process" (which also blocked a normal quit). Every other
 * uncaught error still goes to fallback.
 */
export function installDiskFullGuard(target: ProcessLike, fallback: UncaughtFallback): void {
  target.on("uncaughtException", error => {
    if (reportDiskFull(error)) return;
    fallback(error);
  });
}

type FreeSpace = Pick<StatsFs, "bavail" | "bsize">;

/**
 * While the disk is full, checks the data folder's free space every intervalMs; once DISK_SPACE_BACK_BYTES are free
 * again the banner goes away by itself, even if nothing else wrote. Returns a stop function.
 */
export function watchDiskSpace(dir: string, options: { intervalMs?: number; statfs?: (dir: string) => FreeSpace } = {}): () => void {
  const statfs = options.statfs ?? ((path: string): FreeSpace => statfsSync(path));
  let timer: NodeJS.Timeout | undefined;
  const check = (): void => {
    try {
      const stats = statfs(dir);
      if (Number(stats.bavail) * Number(stats.bsize) >= DISK_SPACE_BACK_BYTES) reportDiskWritable();
    } catch { /* keep the banner; the next check or write decides */ }
  };
  const stopTimer = (): void => { if (timer) clearInterval(timer); timer = undefined; };
  const unsubscribe = onDiskFullChange(value => {
    if (value && !timer) {
      timer = setInterval(check, options.intervalMs ?? 30_000);
      timer.unref?.();
    } else if (!value) stopTimer();
  });
  return () => { unsubscribe(); stopTimer(); };
}
