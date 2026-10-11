// The desktop app's own update, in the same verified component flow as the engine and window.
// Like electron-updater's quitAndInstall: a release is downloaded, size/SHA256-checked and extracted beside the
// other components while the app runs; the swap happens only once this app has exited. A small helper (written
// outside app.asar, run by plain Node) waits for the exit, swaps app.asar (or the whole app when Electron changes
// or macOS requires a sealed bundle), relaunches, and restores the previous copy if the new one never confirms.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type * as NodeFs from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { DesktopConfig } from "./config";
import { extractComponentArchive } from "./component-update-archive";
import { downloadComponent, replaceFile } from "./component-update-files";
import type { ComponentRelease, DesktopAsset } from "./component-update-manifest";
import type { HelperPlan } from "./desktop-update-helper";
import { chooseStagedMacBundle, ensureMacApplicationsInstall } from "./mac-applications";

/** Where the running desktop app lives. Only a packaged app has one; development runs never update themselves. */
export interface DesktopInstall {
  /** The packaged app folder (win32/linux) or the .app bundle (darwin). */
  appDir: string;
  /** Holds app.asar. */
  resourcesDir: string;
  executable: string;
  electronVersion: string;
  /** A plain Node that can run the helper from outside the app folder. */
  nodePath: string;
}
export interface DesktopJournal {
  version: string;
  sha256: string;
  kind: "asar" | "runtime";
  /** The verified, extracted replacement: an app.asar file or a whole app folder. */
  staged: string;
  /** What the replacement takes the place of. */
  target: string;
  phase: "staged" | "applying" | "applied";
  /** Set when the app was still in use at the swap: later starts wait until then; Restart retries at once. */
  heldUntil?: number;
}

const journalFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "desktop-update-pending.json");
const versionFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "desktop-update-version.txt");
// The first Keeper release reaches existing installs as app.asar. That new app then installs
// its whole runtime from the same verified release so the executable and OS icon also change.
const ICON_REVISION = "keeper-v1";
const iconFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "desktop-icon-version.txt");
const packagedIconFile = (install: DesktopInstall): string => join(install.resourcesDir, "keeper-icon-revision");
const rejectedFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "desktop-update-rejected.json");
const CONFIRM_TIMEOUT_MS = 90_000;
/**
 * Inside Electron, fs treats any path ending in .asar as an archive to read from, so writing or checking a new
 * app.asar fails. Staged copies are named .asar.staged; the helper (plain Node) gives them their names back.
 */
export const STAGED_ASAR = ".asar.staged";
const stagedName = (name: string): string => name.replace(/\.asar(?=\/|$)/g, STAGED_ASAR);
const sealedMacInstall = (install: DesktopInstall): boolean => process.platform === "darwin" && install.appDir.endsWith(".app");

/** Electron's fs opens app.asar as an archive; original-fs reads the file's own bytes. */
const rawFs: typeof NodeFs = process.versions.electron ? require("original-fs") : require("node:fs");

async function fileSha256(file: string): Promise<string | undefined> {
  const hash = createHash("sha256");
  try { for await (const chunk of rawFs.createReadStream(file)) hash.update(chunk as Buffer); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return hash.digest("hex");
}

async function readOrEmpty(file: string): Promise<string> {
  try { return (await readFile(file, "utf8")).trim(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
export async function readDesktopJournal(cfg: DesktopConfig): Promise<DesktopJournal | undefined> {
  const value = await readOrEmpty(journalFile(cfg));
  return value ? JSON.parse(value) as DesktopJournal : undefined;
}
async function rejected(cfg: DesktopConfig, version: string, sha256: string): Promise<boolean> {
  const value = await readOrEmpty(rejectedFile(cfg));
  if (!value) return false;
  const item = JSON.parse(value) as { version?: string; sha256?: string };
  return item.version === version && item.sha256 === sha256;
}

/** The archive to fetch: app.asar alone, or the whole packaged app when the release moves to another Electron. */
function choose(release: ComponentRelease, install: DesktopInstall, iconUpgrade = false): { asset: DesktopAsset; kind: DesktopJournal["kind"] } | undefined {
  const desktop = release.components.desktop;
  if (!desktop) return undefined;
  // macOS seals app.asar in the code signature; replacing that resource alone invalidates the app.
  if (!sealedMacInstall(install) && desktop.electronVersion === install.electronVersion && !iconUpgrade) return { asset: desktop, kind: "asar" };
  const runtime = release.components.desktopRuntime;
  if (!runtime || runtime.electronVersion !== desktop.electronVersion) {
    throw new Error(`Release ${release.version} moves the desktop to Electron ${desktop.electronVersion}; install the new desktop package from the release page`);
  }
  return { asset: runtime, kind: "runtime" };
}

/** The installed desktop already is this component: same Electron and the same app.asar bytes. */
async function installedMatches(asset: DesktopAsset, install: DesktopInstall): Promise<boolean> {
  if (!asset.appAsarSha256 || asset.electronVersion !== install.electronVersion) return false;
  return await fileSha256(join(install.resourcesDir, "app.asar")) === asset.appAsarSha256;
}

/** A staged copy byte-identical to the installed one: for a whole app, the same executable and app.asar. */
async function stagedMatchesInstalled(journal: DesktopJournal, install: DesktopInstall): Promise<boolean> {
  const executable = sealedMacInstall(install) ? join("Contents", "MacOS", basename(install.executable)) : basename(install.executable);
  const resources = sealedMacInstall(install) ? join("Contents", "Resources") : "resources";
  const pairs: Array<[string, string]> = journal.kind === "asar" ? [[journal.staged, journal.target]]
    : [[join(journal.staged, executable), install.executable],
      [join(journal.staged, resources, `app${STAGED_ASAR}`), join(install.resourcesDir, "app.asar")]];
  for (const [staged, installed] of pairs) {
    const digest = await fileSha256(staged);
    if (!digest || digest !== await fileSha256(installed)) return false;
  }
  return true;
}

async function assertFile(file: string): Promise<void> {
  if (!(await stat(file)).isFile()) throw new Error(`Incomplete desktop component: ${basename(file)}`);
}

/** Downloads, verifies and extracts the release's desktop component; nothing in the running app changes. */
export async function stageDesktopUpdate(cfg: DesktopConfig, release: ComponentRelease, request: typeof fetch, install?: DesktopInstall): Promise<boolean> {
  if (!install || await readDesktopJournal(cfg)) return false;
  if (process.platform === "win32" && await readOrEmpty(packagedIconFile(install)) === ICON_REVISION
    && await readOrEmpty(iconFile(cfg)) !== ICON_REVISION) {
    await replaceFile(iconFile(cfg), `${ICON_REVISION}\n`);
  }
  const iconUpgrade = process.platform === "win32" && Boolean(release.components.desktopRuntime)
    && await readOrEmpty(iconFile(cfg)) !== ICON_REVISION;
  if (!iconUpgrade && await readOrEmpty(versionFile(cfg)) === release.version) return false;
  const choice = choose(release, install, iconUpgrade);
  if (!choice || await rejected(cfg, release.version, choice.asset.sha256)) return false;
  if (!iconUpgrade && await installedMatches(choice.asset, install)) {
    await replaceFile(versionFile(cfg), `${release.version}
`);
    return false;
  }
  const updates = join(cfg.dataDir, "updates");
  await mkdir(updates, { recursive: true });
  const directory = await mkdtemp(join(updates, `desktop-${release.version}-`));
  try {
    const archive = join(directory, "desktop.tar.gz");
    const payload = join(directory, "payload");
    await downloadComponent(choice.asset, archive, request);
    await mkdir(payload);
    await extractComponentArchive(archive, payload, choice.asset.expandedBytes, stagedName);
    await rm(archive);
    const staged = choice.kind === "asar" ? join(payload, `app${STAGED_ASAR}`)
      : sealedMacInstall(install) ? join(payload, chooseStagedMacBundle(install.appDir, await readdir(payload))) : payload;
    const target = choice.kind === "asar" ? join(install.resourcesDir, "app.asar") : install.appDir;
    if (choice.kind === "asar") await assertFile(staged);
    else for (const file of sealedMacInstall(install)
      ? [`Contents/MacOS/${basename(install.executable)}`, `Contents/Resources/app${STAGED_ASAR}`]
      : [basename(install.executable), `resources/app${STAGED_ASAR}`]) await assertFile(join(staged, file));
    const journal: DesktopJournal = { version: release.version, sha256: choice.asset.sha256, kind: choice.kind, staged, target, phase: "staged" };
    await replaceFile(journalFile(cfg), JSON.stringify(journal));
    return true;
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

/** A staged desktop update waits for the next start (or the owner's Restart); the version it will become. */
export async function stagedDesktopVersion(cfg: DesktopConfig): Promise<string | null> {
  const journal = await readDesktopJournal(cfg);
  return journal?.phase === "staged" ? journal.version : null;
}

/**
 * Hands a staged update to the helper, which swaps it in once this process (pid) exits and relaunches the app.
 * Returns false when nothing is staged; otherwise the caller quits so the helper can work. `explicit` (the owner's
 * Restart) ignores the wait after a swap that found the app still in use.
 */
export async function handOffDesktopUpdate(cfg: DesktopConfig, install: DesktopInstall, helperSource: string, args: string[] = [], explicit = false): Promise<boolean> {
  const journal = await readDesktopJournal(cfg);
  const updateWaiting = journal?.phase === "staged";
  if (!updateWaiting || !explicit && (journal?.heldUntil ?? 0) > Date.now()) {
    if (!updateWaiting) await ensureMacApplicationsInstall(install.appDir, join(cfg.dataDir, "desktop.log"));
    return false;
  }
  const work = dirname(journal.kind === "asar" ? dirname(journal.staged) : journal.staged);
  if (await stagedMatchesInstalled(journal, install)) {
    // Nothing would change: no swap, no restart; the installed copy already is this release's desktop.
    if (journal.kind === "runtime" && process.platform === "win32") await replaceFile(iconFile(cfg), ICON_REVISION);
    await replaceFile(versionFile(cfg), `${journal.version}
`);
    await rm(journalFile(cfg), { force: true });
    await rm(work, { recursive: true, force: true });
    await ensureMacApplicationsInstall(install.appDir, join(cfg.dataDir, "desktop.log"));
    return false;
  }
  const helper = join(work, "desktop-update-helper.js");
  // Read, not copied: the source sits inside app.asar, which only Electron's own fs can read.
  await writeFile(helper, await readFile(helperSource));
  // A whole-folder swap must not run the helper from inside the folder it renames.
  const node = journal.kind === "runtime" ? join(work, basename(install.nodePath)) : install.nodePath;
  if (journal.kind === "runtime") await copyFile(install.nodePath, node);
  const relaunchExecutable = journal.kind === "runtime" && !sealedMacInstall(install)
    ? join(install.appDir, basename(install.executable)) : install.executable;
  // A Linux runtime swap extracts as the user, so its new chrome-sandbox cannot retain root:4755.
  // Relaunch through the packaged helper, which requests that setup before Electron starts.
  const linuxLauncher = journal.kind === "runtime" && process.platform === "linux"
    && rawFs.existsSync(join(journal.staged, "branch-agent")) ? join(install.appDir, "branch-agent") : undefined;
  const plan: HelperPlan = { journal: journalFile(cfg), versionFile: versionFile(cfg), rejectedFile: rejectedFile(cfg),
    log: join(cfg.dataDir, "desktop.log"), waitPid: process.pid,
    relaunch: { command: linuxLauncher ?? relaunchExecutable, fallback: linuxLauncher ? relaunchExecutable : undefined, args },
    confirmTimeoutMs: CONFIRM_TIMEOUT_MS };
  const planFile = join(work, "desktop-update-plan.json");
  await replaceFile(planFile, JSON.stringify(plan));
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  const child = spawn(node, [helper, planFile], { detached: true, stdio: "ignore", windowsHide: true, env });
  child.unref();
  return true;
}

/** The new desktop app started and showed its window: keep it. The previous copy stays beside it for rollback. */
export async function confirmDesktopUpdate(cfg: DesktopConfig): Promise<string | null> {
  const journal = await readDesktopJournal(cfg);
  if (!journal || journal.phase === "staged") return null;
  await replaceFile(versionFile(cfg), `${journal.version}\n`);
  if (journal.kind === "runtime" && process.platform === "win32") await replaceFile(iconFile(cfg), ICON_REVISION);
  await rm(journalFile(cfg), { force: true });
  return journal.version;
}
