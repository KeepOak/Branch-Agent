// Watches for new builds without repackaging the app:
// - the window build folder's stamp (branch-build.txt, written by scripts/publish-window.sh): the window reloads;
// - the engine (a newly published copy, or a rebuild of the one in use): the window shows "An update is ready — Restart"; the engine never restarts by itself.
// Polling a small file every few seconds instead of fs.watch: a watch handle on Windows would block the folder swap.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const WINDOW_POLL_MS = 3000;
const ENGINE_POLL_MS = 15000;

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/** Calls onChange whenever read() differs from the last seen (non-empty) value. */
function poll(read: () => Promise<string> | string, everyMs: number, onChange: () => void): () => void {
  let last: string | undefined;
  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    const now = await read();
    busy = false;
    if (!now) return; // mid-swap or missing: wait for the next tick
    if (last !== undefined && now !== last) onChange();
    last = now;
  };
  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  return () => clearInterval(timer);
}

export function watchWindowBuild(windowDir: string, onNewBuild: () => void): () => void {
  return poll(() => readOrEmpty(join(windowDir, "branch-build.txt")), WINDOW_POLL_MS, onNewBuild);
}

export function watchEngineBuild(signature: () => string, onNewBuild: () => void): () => void {
  return poll(signature, ENGINE_POLL_MS, onNewBuild);
}
