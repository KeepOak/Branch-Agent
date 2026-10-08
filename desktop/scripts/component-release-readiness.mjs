import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PUSH_BACKUP_MIN_AGE_MS = 25 * 60 * 1000;
export const CATCH_UP_MAX_WAIT_MS = 26 * 60 * 1000;
// The release check is strict (`>` 25 minutes). Stay a few seconds past that
// boundary so the dispatched run does not still observe a closed window.
export const CATCH_UP_WINDOW_BUFFER_MS = 5 * 1000;

export function pushBackupShouldRelease(publishedAt, now = Date.now()) {
  if (publishedAt == null || publishedAt === "") return true;
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) return true;
  return now - published > PUSH_BACKUP_MIN_AGE_MS;
}

export function catchUpWaitMs(publishedAt, now = Date.now()) {
  if (publishedAt == null || publishedAt === "") return 0;
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) return 0;
  const remaining = published + PUSH_BACKUP_MIN_AGE_MS + CATCH_UP_WINDOW_BUFFER_MS - now;
  if (remaining <= 0) return 0;
  return Math.min(remaining, CATCH_UP_MAX_WAIT_MS);
}

// One catch-up decision. Same commit as the latest release never dispatches.
// Main ahead of that commit dispatches only once the 25-minute window has passed;
// until then the caller sleeps for waitMs (capped at 26 minutes) and asks again.
export function decideCatchUp({ mainCommit, latestCommit, publishedAt, now = Date.now() } = {}) {
  const head = typeof mainCommit === "string" ? mainCommit : "";
  const released = typeof latestCommit === "string" ? latestCommit : "";
  if (head === "" || released === "") {
    return {
      dispatch: false,
      waitMs: 0,
      reason: "Catch-up could not compare main with the latest release; not dispatching",
    };
  }
  if (head === released) {
    return {
      dispatch: false,
      waitMs: 0,
      reason: `Main is already the latest release (${released}); no catch-up`,
    };
  }
  const waitMs = catchUpWaitMs(publishedAt, now);
  if (waitMs > 0) {
    return {
      dispatch: false,
      waitMs,
      reason: `Main is ahead of the latest release; waiting ${Math.ceil(waitMs / 1000)}s for the 25-minute window`,
    };
  }
  return {
    dispatch: true,
    waitMs: 0,
    reason: "Main is ahead of the latest release and the 25-minute window has passed; dispatching a catch-up release",
  };
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return "";
  return argv[index + 1] ?? "";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "decide-catch-up") {
    const nowArg = argValue(process.argv, "--now");
    const decision = decideCatchUp({
      mainCommit: argValue(process.argv, "--main"),
      latestCommit: argValue(process.argv, "--latest"),
      publishedAt: argValue(process.argv, "--published-at"),
      now: nowArg === "" ? Date.now() : Number(nowArg),
    });
    process.stdout.write(`${JSON.stringify(decision)}\n`);
    process.exit(0);
  }
  process.exit(pushBackupShouldRelease(process.argv[2]) ? 0 : 1);
}
