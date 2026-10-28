// Per-user live install for the Linux .deb package.
// dpkg places the system copy under /opt/branch-agent (root-owned, not writable for a normal user). The PATH
// launcher and application-menu entry seed ~/.local/share/branch-agent/app once, then start that copy. In-app
// updates swap the user copy with the existing asar/runtime helper path; they never write under /opt and never
// fetch the AppImage.
import { accessSync, chmodSync, constants, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { DesktopInstall } from "./desktop-update";

/** System package path the .deb installs; chrome-sandbox stays setuid there. */
export const LINUX_DEB_SYSTEM_ROOT = "/opt/branch-agent";

/** Relative segments under XDG data home for the per-user live app. */
export const LINUX_DEB_USER_APP_SEGMENTS = ["branch-agent", "app"] as const;

/** XDG data home (or ~/.local/share) that holds the seeded live app. */
export function linuxDebUserDataHome(homeDirectory: string, env: NodeJS.ProcessEnv = process.env): string {
  const named = env.XDG_DATA_HOME?.trim();
  return named ? named : join(homeDirectory, ".local", "share");
}

/** Per-user live app the .deb launcher seeds; in-app updates replace this folder. */
export function linuxDebUserAppDir(homeDirectory: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(linuxDebUserDataHome(homeDirectory, env), ...LINUX_DEB_USER_APP_SEGMENTS);
}

/** True when appDir is the .deb system package (or a path inside it). */
export function isLinuxDebSystemInstall(appDir: string, systemRoot: string = LINUX_DEB_SYSTEM_ROOT): boolean {
  const resolved = resolve(appDir);
  const root = resolve(systemRoot);
  if (resolved === root) return true;
  const rel = relative(root, resolved);
  return Boolean(rel) && !rel.startsWith("..") && !rel.startsWith(sep) && rel !== "";
}

export function canWriteDirectory(directory: string): boolean {
  try {
    accessSync(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function assertSystemPayload(systemRoot: string): void {
  for (const name of ["branch-agent", "Branch Agent.bin", "chrome-sandbox"]) {
    const path = join(systemRoot, name);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`The Linux package has no ${name} at ${systemRoot}`);
  }
}

/**
 * Seeds the per-user live app from the system package when it is missing. An existing user copy is left alone so
 * in-app updates are not overwritten by a later apt upgrade of /opt. Returns the live app directory.
 */
export function ensureLinuxDebUserInstall(
  systemRoot: string,
  homeDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  assertSystemPayload(systemRoot);
  const live = linuxDebUserAppDir(homeDirectory, env);
  const launcher = join(live, "branch-agent");
  if (existsSync(launcher) && statSync(launcher).isFile()) return live;
  const dataHome = linuxDebUserDataHome(homeDirectory, env);
  mkdirSync(dirname(live), { recursive: true });
  const staging = join(dataHome, `.app-seed-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  try {
    cpSync(systemRoot, staging, { recursive: true, verbatimSymlinks: true });
    // cpSync keeps root package modes; the live tree must be writable for in-app updates.
    makeTreeUserWritable(staging);
    rmSync(live, { recursive: true, force: true });
    renameSync(staging, live);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return live;
}

/** Adds owner read/write/execute on directories and owner read/write on files under root. */
function makeTreeUserWritable(root: string): void {
  const info = statSync(root);
  if (info.isDirectory()) {
    chmodSync(root, (info.mode | 0o700) & 0o7777);
    for (const name of readdirSync(root)) makeTreeUserWritable(join(root, name));
    return;
  }
  if (info.isFile()) chmodSync(root, (info.mode | 0o600) & 0o7777);
}

/** DesktopInstall that points at the seeded user copy (resources/ and the same executable basename). */
export function linuxDebUserDesktopInstall(install: DesktopInstall, userAppDir: string): DesktopInstall {
  return {
    ...install,
    appDir: userAppDir,
    resourcesDir: join(userAppDir, "resources"),
    executable: join(userAppDir, basename(install.executable)),
  };
}

/**
 * When the packaged app is still the root-owned .deb system copy, seed the user live install and return its
 * branch-agent launcher so main can hand off. AppImage and already-user installs return undefined.
 */
export function linuxDebSystemHandoff(
  install: DesktopInstall,
  options: {
    homeDirectory?: string;
    env?: NodeJS.ProcessEnv;
    systemRoot?: string;
    ensure?: typeof ensureLinuxDebUserInstall;
  } = {},
): string | undefined {
  if ((install.platform ?? process.platform) !== "linux" || install.appImage) return undefined;
  const systemRoot = options.systemRoot ?? LINUX_DEB_SYSTEM_ROOT;
  if (!isLinuxDebSystemInstall(install.appDir, systemRoot)) return undefined;
  const homeDirectory = options.homeDirectory ?? homedir();
  const env = options.env ?? process.env;
  const ensure = options.ensure ?? ensureLinuxDebUserInstall;
  const live = ensure(systemRoot, homeDirectory, env);
  const launcher = join(live, "branch-agent");
  if (!existsSync(launcher)) throw new Error(`Seeded Linux deb install is missing ${launcher}`);
  if (resolve(install.appDir) === resolve(live)) return undefined;
  return launcher;
}

/**
 * Install path desktop updates should target on Linux .deb: the writable user copy. When the process still names
 * the system package, retarget to the seeded user app so the helper never writes under /opt.
 */
export function resolveLinuxDebUpdateInstall(
  install: DesktopInstall,
  options: {
    homeDirectory?: string;
    env?: NodeJS.ProcessEnv;
    systemRoot?: string;
    ensure?: typeof ensureLinuxDebUserInstall;
  } = {},
): DesktopInstall {
  if ((install.platform ?? process.platform) !== "linux" || install.appImage) return install;
  const systemRoot = options.systemRoot ?? LINUX_DEB_SYSTEM_ROOT;
  if (!isLinuxDebSystemInstall(install.appDir, systemRoot)) return install;
  const homeDirectory = options.homeDirectory ?? homedir();
  const env = options.env ?? process.env;
  const ensure = options.ensure ?? ensureLinuxDebUserInstall;
  const live = ensure(systemRoot, homeDirectory, env);
  return linuxDebUserDesktopInstall(install, live);
}
