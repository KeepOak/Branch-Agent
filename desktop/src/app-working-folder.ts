// Windows shortcuts used to Start in the app folder, which a desktop update later renames (#1777, #787).
// At startup, before anything is spawned, leave that folder so an old or hand-made shortcut is tolerated too.
import path from "node:path";

const VERSION_FOLDER = /^app-[A-Za-z0-9._-]+$/;
const api = (win32: boolean) => (win32 ? path.win32 : path.posix);

function fold(value: string, win32: boolean): string {
  return win32 ? value.replaceAll("/", "\\").toLowerCase() : value;
}

/** True when `target` is `root` or a path inside it. */
export function pathIsInside(root: string, target: string, win32 = process.platform === "win32"): boolean {
  const p = api(win32);
  const from = fold(p.resolve(root), win32);
  const to = fold(p.resolve(target), win32);
  const rel = p.relative(from, to);
  if (!rel) return true;
  if (p.isAbsolute(rel)) return false;
  return !rel.split(/[\\/]/).includes("..");
}

/**
 * Folders a live process must not use as its working directory: the packaged app folder, and on a versioned
 * Windows install the root that holds those `app-*` folders (the Setup install directory).
 */
export function heldAppFolders(appDir: string, win32 = process.platform === "win32"): string[] {
  const p = api(win32);
  const roots = [p.resolve(appDir)];
  if (VERSION_FOLDER.test(p.basename(appDir))) roots.push(p.dirname(roots[0]!));
  return roots;
}

export function cwdHoldsAppFolder(cwd: string, appDir: string, win32 = process.platform === "win32"): boolean {
  return heldAppFolders(appDir, win32).some((root) => pathIsInside(root, cwd, win32));
}

export interface LeaveAppWorkingFolder {
  cwd: string;
  appDir: string;
  home: string;
  chdir: (dir: string) => void;
  /** Tests pass win32 path rules on any host. */
  win32?: boolean;
}

/**
 * When the process started inside the app folder (or the Windows install root that contains it), move to `home`.
 * Returns whether the working folder changed.
 */
export function leaveAppWorkingFolder(input: LeaveAppWorkingFolder): boolean {
  const win32 = input.win32 ?? process.platform === "win32";
  const home = input.home.trim();
  if (!home) return false;
  if (!cwdHoldsAppFolder(input.cwd, input.appDir, win32)) return false;
  if (cwdHoldsAppFolder(home, input.appDir, win32)) return false;
  try {
    input.chdir(home);
    return true;
  } catch {
    return false;
  }
}
