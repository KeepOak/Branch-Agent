// The desktop app's own update, in the same verified component flow as the engine and window.
// Like electron-updater's quitAndInstall: a release is downloaded, size/SHA256-checked and extracted beside the
// other components while the app runs; the swap happens only once this app has exited. A small helper (written
// outside app.asar, run by plain Node) waits for the exit, swaps app.asar (or the whole app when Electron changes
// or macOS requires a sealed bundle; on Windows, a fresh version folder plus current.txt), relaunches, and restores
// the previous copy if the new one never confirms. Windows never renames a folder that is still in use.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type * as NodeFs from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import type { DesktopConfig } from "./config";
import { extractComponentArchive } from "./component-update-archive";
import { appendCappedLog, BRANCH_LOG_LIMITS } from "./log-rotation";
import { downloadComponent, replaceFile } from "./component-update-files";
import { trustedDownloadResponse, type ComponentRelease, type DesktopAsset } from "./component-update-manifest";
import type { HelperPlan } from "./desktop-update-helper";
import {
  WINDOWS_POINTER, WINDOWS_PREVIOUS, isWindowsVersionFolder, pruneWindowsVersionFolders, usesWindowsVersionedLayout,
  windowsInstallRoot, windowsVersionFolderName,
} from "./desktop-update-helper";
import { assertNoMacSigningDowngrade, chooseStagedMacBundle, ensureMacApplicationsInstall, readMacSignature } from "./mac-applications";
import {
  WINDOWS_APP_USER_MODEL_ID, WINDOWS_LAUNCHER, WINDOWS_LAUNCHER_EXE, WINDOWS_LAUNCHER_RESOURCE, WINDOWS_LAUNCHER_REVISION,
  WINDOWS_LAUNCHER_REVISION_FILE, windowsLauncherScript, windowsShortcutNeedsLauncher,
} from "./windows-launcher.mjs";

export {
  WINDOWS_POINTER, WINDOWS_PREVIOUS, isWindowsVersionFolder, pruneWindowsVersionFolders,
  usesWindowsVersionedLayout, windowsInstallRoot, windowsVersionFolderName,
} from "./desktop-update-helper";
export {
  WINDOWS_LAUNCHER, WINDOWS_LAUNCHER_EXE, WINDOWS_LAUNCHER_RESOURCE, WINDOWS_LAUNCHER_REVISION, windowsLaunchTarget,
  windowsLauncherScript, windowsShortcutNeedsLauncher,
} from "./windows-launcher.mjs";

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
  /** The AppImage file this app runs from (Linux, `APPIMAGE`); its update replaces that one file. */
  appImage?: string;
  /** The OS whose update path applies; defaults to this process's. Tests drive another platform's path with it. */
  platform?: NodeJS.Platform;
  /** An app's code signature report (macOS); defaults to codesign. */
  readSignature?: (app: string) => Promise<string | undefined>;
}
export interface DesktopJournal {
  version: string;
  sha256: string;
  kind: "asar" | "runtime" | "appimage";
  /** The verified, extracted replacement: an app.asar file, a whole app folder or an AppImage file. */
  staged: string;
  /** What the replacement takes the place of. */
  target: string;
  phase: "staged" | "applying" | "applied";
  /**
   * SHA256 recorded at staging of the staged app.asar (asar), of the app.asar inside the staged app (runtime) or of
   * the AppImage; a start that finds other bytes discards the update.
   */
  stagedSha256?: string;
  /** Set when the app was still in use at the swap: later starts wait until then; Restart retries at once. */
  heldUntil?: number;
  /** The update's own folder under updates/, when the staged file lives elsewhere (an AppImage beside its target). */
  work?: string;
  /** Windows side-by-side: user-writable root that holds version folders and current.txt. */
  installRoot?: string;
  /** Folder name under installRoot for this update. A single relative segment, never a path. */
  versionFolder?: string;
  /** Previous version folder name, or empty when the live app is the legacy root itself. */
  previousFolder?: string;
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
const sealedMacInstall = (install: DesktopInstall): boolean => (install.platform ?? process.platform) === "darwin" && install.appDir.endsWith(".app");
/**
 * A Linux AppImage runs from a read-only mount, so neither app.asar nor the whole app can be swapped in place.
 * Its update is the release's AppImage itself: downloaded beside the running file, checked against the release's
 * SHA256SUMS, made executable, then renamed over it by the helper once the app exits.
 */
export function runsFromAppImage(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  return platform === "linux" && Boolean(env.APPIMAGE);
}

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
  // Windows lands each update in a fresh version folder, so a same-Electron release still takes the whole app when
  // the release publishes one: copying the live tree would recurse into the new folder and can fail on locked files.
  if (!sealedMacInstall(install) && desktop.electronVersion === install.electronVersion && !iconUpgrade
    && !(usesWindowsVersionedLayout(install.platform, install.appImage) && release.components.desktopRuntime)) {
    return { asset: desktop, kind: "asar" };
  }
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

/** Each file a staged copy must contain, beside the installed file it replaces. */
function stagedPairs(journal: DesktopJournal, install: DesktopInstall): Array<[string, string]> {
  const executable = sealedMacInstall(install) ? join("Contents", "MacOS", basename(install.executable)) : basename(install.executable);
  const resources = sealedMacInstall(install) ? join("Contents", "Resources") : "resources";
  return journal.kind !== "runtime" ? [[journal.staged, journal.target]]
    : [[join(journal.staged, executable), install.executable],
      [join(journal.staged, resources, `app${STAGED_ASAR}`), join(install.resourcesDir, "app.asar")]];
}

/** A staged copy byte-identical to the installed one: for a whole app, the same executable and app.asar. */
async function stagedMatchesInstalled(journal: DesktopJournal, install: DesktopInstall): Promise<boolean> {
  for (const [staged, installed] of stagedPairs(journal, install)) {
    const digest = await fileSha256(staged);
    if (!digest || digest !== await fileSha256(installed)) return false;
  }
  return true;
}

/** The one staged file whose SHA256 staging records: the app.asar a whole app carries, else the staged file itself. */
function checkedFile(journal: DesktopJournal, install: DesktopInstall): string {
  return journal.kind === "runtime" ? stagedPairs(journal, install)[1]![0] : journal.staged;
}

/** Why a staged record can no longer be applied: one of its files is gone, or the checked bytes changed since staging. */
async function stagedDefect(journal: DesktopJournal, install: DesktopInstall): Promise<string | undefined> {
  if (typeof journal.staged !== "string" || typeof journal.target !== "string" || typeof journal.version !== "string") return "the record is incomplete";
  for (const [staged] of stagedPairs(journal, install)) {
    if (await fileSha256(staged) === undefined) return `${basename(staged)} is missing`;
  }
  const checked = checkedFile(journal, install);
  if (journal.stagedSha256 && await fileSha256(checked) !== journal.stagedSha256) return `${basename(checked)} fails its SHA256`;
  return undefined;
}

/** The helper ships inside app.asar; without it the swap cannot run. Other read errors still surface. */
async function helperMissing(helperSource: string): Promise<boolean> {
  try { await readFile(helperSource); return false; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

/** A record that cannot be applied is dropped, and the app starts on its current build. The reason goes to desktop.log. */
async function discardStagedUpdate(cfg: DesktopConfig, journal: Pick<DesktopJournal, "version"> | undefined, reason: string): Promise<false> {
  // Neither a record that cannot be removed nor the log ever blocks launch.
  let removed = true;
  try { await rm(journalFile(cfg), { force: true }); } catch { removed = false; }
  const version = typeof journal?.version === "string" ? `${journal.version} ` : "";
  try { appendCappedLog(join(cfg.dataDir, "desktop.log"), `${new Date().toISOString()} desktop update ${version}discarded: ${reason}; starting the current build${removed ? "" : " (the record could not be removed)"}\n`, BRANCH_LOG_LIMITS); } catch { /* ignore */ }
  return false;
}

async function assertFile(file: string): Promise<void> {
  if (!(await stat(file)).isFile()) throw new Error(`Incomplete desktop component: ${basename(file)}`);
}

/** The folder every asset of this release is published in (the manifest's own asset URLs name it). */
function releaseBase(release: ComponentRelease): string {
  const url = release.components.engine.url;
  return url.slice(0, url.lastIndexOf("/"));
}

/** The Linux AppImage a release publishes (release-installers.mjs names it). */
export const appImageAssetName = (version: string): string => `Branch-Agent-${version}-linux-x64.AppImage`;

/**
 * The release's SHA256SUMS as name to digest. `required` refuses a release without one; otherwise a release
 * published before SHA256SUMS existed (404) returns undefined and its manifest digests stand alone.
 */
export async function releaseSha256Sums(release: ComponentRelease, request: typeof fetch, required: boolean): Promise<Map<string, string> | undefined> {
  const response = await request(`${releaseBase(release)}/SHA256SUMS`, { signal: AbortSignal.timeout(60_000) });
  if (response.status === 404 && !required) return undefined;
  trustedDownloadResponse(response);
  const sums = new Map<string, string>();
  for (const line of (await response.text()).split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) [ *]?(\S.*)$/.exec(line.trim());
    if (match) sums.set(match[2]!, match[1]!);
  }
  if (!sums.size) throw new Error(`Release ${release.version} has an empty or unreadable SHA256SUMS`);
  return sums;
}

/** Streams a file to disk and checks its SHA-256; a mismatch deletes it. Never larger than 4 GiB. */
async function downloadVerified(url: string, sha256: string, file: string, request: typeof fetch): Promise<void> {
  const response = await request(url, { signal: AbortSignal.timeout(900_000) });
  trustedDownloadResponse(response);
  await rm(file, { force: true });
  const handle = await open(file, "wx", 0o600);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of response.body!) {
      bytes += chunk.length;
      if (bytes > 4 * 1024 ** 3) throw new Error(`${basename(file)} is larger than any release asset`);
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    await handle.sync();
  } catch (error) { await handle.close(); await rm(file, { force: true }); throw error; }
  await handle.close();
  if (hash.digest("hex") !== sha256) {
    await rm(file, { force: true });
    throw new Error(`${basename(url)} does not match the release's SHA256SUMS; nothing was changed`);
  }
}

/**
 * The AppImage update: the release's AppImage, checked against its SHA256SUMS entry, staged executable beside
 * the running file so the helper's rename over it is atomic (same folder, same filesystem).
 */
async function stageAppImageUpdate(cfg: DesktopConfig, release: ComponentRelease, request: typeof fetch, appImage: string): Promise<boolean> {
  const name = appImageAssetName(release.version);
  const sha256 = (await releaseSha256Sums(release, request, true))!.get(name);
  if (!sha256) throw new Error(`Release ${release.version} lists no ${name} in SHA256SUMS`);
  if (await rejected(cfg, release.version, sha256)) return false;
  if (await fileSha256(appImage) === sha256) {
    await replaceFile(versionFile(cfg), `${release.version}\n`);
    return false;
  }
  const updates = join(cfg.dataDir, "updates");
  await mkdir(updates, { recursive: true });
  const work = await mkdtemp(join(updates, `desktop-${release.version}-`));
  const staged = `${appImage}.update-${release.version}`;
  try {
    await writeFile(join(work, ".update-staging"), "");
    await downloadVerified(`${releaseBase(release)}/${name}`, sha256, staged, request);
    await chmod(staged, 0o755);
    const journal: DesktopJournal = { version: release.version, sha256, kind: "appimage", staged, target: appImage, phase: "staged", stagedSha256: sha256, work };
    await replaceFile(journalFile(cfg), JSON.stringify(journal));
    await writeFile(join(work, ".desktop-complete"), "");
    await rm(join(work, ".update-staging"), { force: true });
    return true;
  } catch (error) {
    await rm(work, { recursive: true, force: true });
    await rm(staged, { force: true });
    throw error;
  }
}

/** Downloads, verifies and extracts the release's desktop component; nothing in the running app changes. */
export async function stageDesktopUpdate(cfg: DesktopConfig, release: ComponentRelease, request: typeof fetch, install?: DesktopInstall): Promise<boolean> {
  if (!install) return false;
  const held = await readDesktopJournal(cfg);
  // A staged app that was never applied is replaced by a newer release. Left alone, it would be applied after the newer
  // engine and window, and roll the app back to an older build.
  if (held) {
    if (held.phase !== "staged" || held.version === release.version) return false;
    await dropStagedDesktop(cfg, held, `replaced by ${release.version}`);
  }
  if (install.appImage) {
    if (await readOrEmpty(versionFile(cfg)) === release.version) return false;
    return stageAppImageUpdate(cfg, release, request, install.appImage);
  }
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
  // Only a release that will actually be downloaded is checked against its SHA256SUMS: nothing is fetched otherwise.
  const sums = await releaseSha256Sums(release, request, false);
  const assetName = basename(new URL(choice.asset.url).pathname);
  if (sums && sums.get(assetName) !== choice.asset.sha256) throw new Error(`${assetName} does not match the release's SHA256SUMS`);
  const updates = join(cfg.dataDir, "updates");
  await mkdir(updates, { recursive: true });
  const directory = await mkdtemp(join(updates, `desktop-${release.version}-`));
  try {
    await writeFile(join(directory, ".update-staging"), "");
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
    if (sealedMacInstall(install)) {
      const signature = install.readSignature ?? readMacSignature;
      try { assertNoMacSigningDowngrade(await signature(install.appDir), await signature(staged)); } catch (error) {
        await replaceFile(rejectedFile(cfg), JSON.stringify({ version: release.version, sha256: choice.asset.sha256 }));
        throw error;
      }
    }
    const recorded: DesktopJournal = { version: release.version, sha256: choice.asset.sha256, kind: choice.kind, staged, target, phase: "staged" };
    const versioned = usesWindowsVersionedLayout(install.platform, install.appImage) && choice.kind === "runtime";
    if (versioned) {
      const installRoot = windowsInstallRoot(install.appDir);
      recorded.installRoot = installRoot;
      recorded.versionFolder = windowsVersionFolderName(release.version, choice.asset.sha256);
      recorded.previousFolder = isWindowsVersionFolder(basename(install.appDir)) ? basename(install.appDir) : "";
      if (!recorded.previousFolder) {
        const pointed = await readOrEmpty(join(installRoot, WINDOWS_POINTER));
        if (isWindowsVersionFolder(pointed)) recorded.previousFolder = pointed;
      }
    }
    const journal: DesktopJournal = { ...recorded, stagedSha256: await fileSha256(checkedFile(recorded, install)) };
    await replaceFile(journalFile(cfg), JSON.stringify(journal));
    await writeFile(join(directory, ".desktop-complete"), "");
    await rm(join(directory, ".update-staging"), { force: true });
    return true;
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

/**
 * Removes a staged desktop update that was never applied: its record, and its folder under updates/ (only a folder
 * inside updates/ is ever removed). The log says why, so an owner who looks sees the replacement.
 */
export async function dropStagedDesktop(cfg: DesktopConfig, journal: DesktopJournal, reason: string): Promise<void> {
  const updates = join(cfg.dataDir, "updates");
  await rm(journalFile(cfg), { force: true });
  if (journal.kind === "appimage" && typeof journal.staged === "string") await rm(journal.staged, { force: true }).catch(() => undefined);
  const inside = typeof journal.work === "string" ? relative(updates, journal.work) : "";
  if (inside && !inside.startsWith("..") && !isAbsolute(inside)) await rm(journal.work!, { recursive: true, force: true }).catch(() => undefined);
  try { appendCappedLog(join(cfg.dataDir, "desktop.log"), `${new Date().toISOString()} desktop update ${journal.version} dropped: ${reason}\n`, BRANCH_LOG_LIMITS); } catch { /* ignore */ }
}

/** A staged desktop update waits for the next start (or the owner's Restart); the version it will become. */
export async function stagedDesktopVersion(cfg: DesktopConfig): Promise<string | null> {
  const journal = await readDesktopJournal(cfg);
  return journal?.phase === "staged" ? journal.version : null;
}

/**
 * Starts the helper detached. Resolves to undefined once it runs, or to the failure text when it cannot start. The
 * error listener is required: an unhandled 'error' event would stop the app before startup continues.
 */
function startHelper(node: string, args: string[], env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(node, args, { detached: true, stdio: "ignore", windowsHide: true, env });
    child.on("error", (error) => resolve(error.message));
    child.once("spawn", () => { child.unref(); resolve(undefined); });
  });
}

/**
 * Hands a staged update to the helper, which swaps it in once this process (pid) exits and relaunches the app.
 * Returns false when nothing is staged; otherwise the caller quits so the helper can work. `explicit` (the owner's
 * Restart) ignores the wait after a swap that found the app still in use.
 */
export async function handOffDesktopUpdate(cfg: DesktopConfig, install: DesktopInstall, helperSource: string, args: string[] = [], explicit = false): Promise<boolean> {
  let journal: DesktopJournal | undefined;
  try { journal = await readDesktopJournal(cfg); } catch (error) {
    return discardStagedUpdate(cfg, undefined, `the record is unreadable (${error instanceof Error ? error.message : String(error)})`);
  }
  // Whatever goes wrong with a pending update (its files gone, a folder that vanished under the helper, a disk
  // error), the record is dropped and the app starts on its current build: a pending update never blocks launch.
  try { return await handOffJournal(cfg, install, helperSource, args, explicit, journal); } catch (error) {
    if (!journal) throw error;
    if (journal.kind === "appimage" && typeof journal.staged === "string") await rm(journal.staged, { force: true }).catch(() => undefined);
    return discardStagedUpdate(cfg, journal, error instanceof Error ? error.message : String(error));
  }
}

async function handOffJournal(cfg: DesktopConfig, install: DesktopInstall, helperSource: string, args: string[], explicit: boolean,
  journal: DesktopJournal | undefined): Promise<boolean> {
  const updateWaiting = journal?.phase === "staged";
  if (!updateWaiting || !explicit && (journal?.heldUntil ?? 0) > Date.now()) {
    if (!updateWaiting) await ensureMacApplicationsInstall(install.appDir, join(cfg.dataDir, "desktop.log"));
    return false;
  }
  const work = journal.work ?? dirname(journal.kind === "asar" ? dirname(journal.staged) : journal.staged);
  const defect = await stagedDefect(journal, install) ?? (await helperMissing(helperSource) ? "the update helper is missing" : undefined);
  if (defect) {
    if (journal.kind === "appimage") await rm(journal.staged, { force: true });
    return discardStagedUpdate(cfg, journal, defect);
  }
  if (await stagedMatchesInstalled(journal, install)) {
    // Nothing would change: no swap, no restart; the installed copy already is this release's desktop.
    if (journal.kind === "runtime" && process.platform === "win32") await replaceFile(iconFile(cfg), ICON_REVISION);
    await replaceFile(versionFile(cfg), `${journal.version}
`);
    await rm(journalFile(cfg), { force: true });
    await rm(work, { recursive: true, force: true });
    if (journal.kind === "appimage") await rm(journal.staged, { force: true });
    await ensureMacApplicationsInstall(install.appDir, join(cfg.dataDir, "desktop.log"));
    return false;
  }
  const helper = join(work, "desktop-update-helper.js");
  // Read, not copied: the source sits inside app.asar, which only Electron's own fs can read.
  await writeFile(helper, await readFile(helperSource));
  // The helper asks leftover processes in the install folder to leave before an in-place rename.
  await readFile(join(dirname(helperSource), "install-folder-holders.js")).then(bytes => writeFile(join(work, "install-folder-holders.js"), bytes)).catch((error: unknown) => {
    try { appendCappedLog(join(cfg.dataDir, "desktop.log"), `${new Date().toISOString()} desktop update ${journal.version}: install-folder holders not copied (${String(error)})\n`, BRANCH_LOG_LIMITS); } catch { /* ignore */ }
  });
  // The Windows layout's helper writes the cmd stub and points shortcuts at the launcher from the one shared module.
  // Without it the helper still swaps, so a failed copy only logs.
  if (journal.installRoot) {
    const launcherModule = join(dirname(helperSource), "windows-launcher.mjs");
    await readFile(launcherModule).then(bytes => writeFile(join(work, "windows-launcher.mjs"), bytes)).catch((error: unknown) => {
      try { appendCappedLog(join(cfg.dataDir, "desktop.log"), `${new Date().toISOString()} desktop update ${journal.version}: windows launcher module not copied (${String(error)})\n`, BRANCH_LOG_LIMITS); } catch { /* ignore */ }
    });
  }
  // A whole-folder swap must not run the helper from inside the folder it renames, nor an AppImage swap from its
  // mount, which goes away when the app exits.
  const ownNode = journal.kind !== "asar";
  const node = ownNode ? join(work, basename(install.nodePath)) : install.nodePath;
  if (ownNode) await copyFile(install.nodePath, node);
  const versionedExe = journal.installRoot && journal.versionFolder
    ? join(journal.installRoot, journal.versionFolder, basename(install.executable)) : undefined;
  const relaunchExecutable = journal.kind === "appimage" ? journal.target
    : versionedExe ? versionedExe
    : journal.kind === "runtime" && !sealedMacInstall(install) ? join(install.appDir, basename(install.executable)) : install.executable;
  // A Linux runtime swap extracts as the user, so its new chrome-sandbox cannot retain root:4755.
  // Relaunch through the packaged helper, which requests that setup before Electron starts.
  const linuxLauncher = journal.kind === "runtime" && process.platform === "linux"
    && rawFs.existsSync(join(journal.staged, "branch-agent")) ? join(install.appDir, "branch-agent") : undefined;
  const plan: HelperPlan = { journal: journalFile(cfg), versionFile: versionFile(cfg), rejectedFile: rejectedFile(cfg),
    log: join(cfg.dataDir, "desktop.log"), waitPid: process.pid,
    relaunch: { command: linuxLauncher ?? relaunchExecutable, fallback: linuxLauncher ? relaunchExecutable : versionedExe ? install.executable : undefined, args },
    confirmTimeoutMs: CONFIRM_TIMEOUT_MS };
  const planFile = join(work, "desktop-update-plan.json");
  await replaceFile(planFile, JSON.stringify(plan));
  // ELECTRON_NO_ASAR: under Electron's own Node, the helper must see app.asar as the plain file it copies and renames.
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", ELECTRON_NO_ASAR: "1" };
  const failure = await startHelper(node, [helper, planFile], env);
  if (failure) return discardStagedUpdate(cfg, journal, `the update helper could not start: ${failure}`);
  return true;
}

/** The new desktop app started and showed its window: keep it. The previous copy stays beside it for rollback. */
export async function confirmDesktopUpdate(cfg: DesktopConfig): Promise<string | null> {
  const journal = await readDesktopJournal(cfg);
  if (!journal || journal.phase === "staged") return null;
  const updates = join(cfg.dataDir, "updates");
  const folder = journal.work ?? join(updates, relative(updates, journal.staged).split(/[\\/]/)[0]!);
  const receipt = join(cfg.dataDir, "desktop-update-retained.json");
  const raw = await readOrEmpty(receipt);
  const retained: string[] = raw ? JSON.parse(raw) : [];
  await replaceFile(receipt, JSON.stringify([folder, ...retained.filter(path => path !== folder)].slice(0, 2)));
  await replaceFile(versionFile(cfg), `${journal.version}\n`);
  if (journal.kind === "runtime" && process.platform === "win32") await replaceFile(iconFile(cfg), ICON_REVISION);
  if (journal.installRoot && journal.versionFolder) {
    await pruneWindowsVersionFolders(journal.installRoot, [journal.versionFolder, journal.previousFolder ?? ""]).catch(() => undefined);
  }
  await rm(journalFile(cfg), { force: true });
  return journal.version;
}

/** At launch: drop unused Windows version folders, skipping any that are still locked. */
export async function pruneWindowsInstall(install: DesktopInstall, log?: (line: string) => void): Promise<void> {
  if (!usesWindowsVersionedLayout(install.platform, install.appImage)) return;
  const root = windowsInstallRoot(install.appDir);
  const keep = new Set<string>();
  if (isWindowsVersionFolder(basename(install.appDir))) keep.add(basename(install.appDir));
  for (const file of [WINDOWS_POINTER, WINDOWS_PREVIOUS]) {
    const name = await readOrEmpty(join(root, file));
    if (isWindowsVersionFolder(name)) keep.add(name);
  }
  if (!keep.size) return;
  await pruneWindowsVersionFolders(root, keep, { log });
}

/** A Windows shortcut (.lnk) and the file it opens. */
export interface WindowsShortcut { path: string; target: string }
/** Reads and rewrites Branch's Windows shortcuts; tests pass their own. */
export interface WindowsShortcuts {
  list(): Promise<WindowsShortcut[]>;
  retarget(paths: string[], launcher: string): Promise<void>;
  /** Points Start in at the user folder without changing the target. */
  repairWorkingDirectory?(paths: string[]): Promise<void>;
}
/** The Start menu, the desktop, Startup and the taskbar pins: where a Branch Agent.lnk can live. */
const SHORTCUT_FOLDERS = "@([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('Startup'),"
  + "(Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar'))";
const SHORTCUT_WORKING_DIR_MARK = "working-dir=userprofile";
const shortcutMarkerValue = (launcher: string): string => `${launcher}\n${SHORTCUT_WORKING_DIR_MARK}`;
const psQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
function powershell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, timeout: 15_000 }, (error, stdout) => error ? reject(error) : resolve(String(stdout)));
  });
}
/** WScript.Shell, as the installer's own shortcuts use: no elevation, and only links named Branch Agent.lnk. */
export const powershellShortcuts: WindowsShortcuts = {
  list: async () => {
    const out = await powershell("[Console]::OutputEncoding=[Text.Encoding]::UTF8; $shell=New-Object -ComObject WScript.Shell; $found=@(); "
      + `foreach($dir in ${SHORTCUT_FOLDERS}) { if(!$dir) { continue }; $path=Join-Path $dir 'Branch Agent.lnk'; `
      + "if(Test-Path -LiteralPath $path) { $found += [pscustomobject]@{path=$path;target=$shell.CreateShortcut($path).TargetPath} } }; "
      + "ConvertTo-Json -Compress -InputObject @($found)");
    const parsed: unknown = JSON.parse(out.trim() || "[]");
    return (Array.isArray(parsed) ? parsed : [parsed]) as WindowsShortcut[];
  },
  retarget: async (paths, launcher) => {
    await powershell(`$shell=New-Object -ComObject WScript.Shell; $exe=${psQuote(launcher)}; foreach($path in @(${paths.map(psQuote).join(",")})) { `
      + "$link=$shell.CreateShortcut($path); $link.TargetPath=$exe; $link.WorkingDirectory=$env:USERPROFILE; "
      + "$link.IconLocation=\"$exe,0\"; $link.Save() }");
  },
  repairWorkingDirectory: async (paths) => {
    await powershell(`$shell=New-Object -ComObject WScript.Shell; foreach($path in @(${paths.map(psQuote).join(",")})) { `
      + "$link=$shell.CreateShortcut($path); $link.WorkingDirectory=$env:USERPROFILE; $link.Save() }");
  },
};
const shortcutMarker = (cfg: DesktopConfig): string => join(cfg.dataDir, "desktop-shortcut-launcher.txt");

/** The stable launcher at this install's root, when it is there (Windows only). */
export function windowsStableLauncher(install: DesktopInstall): string | undefined {
  if (!usesWindowsVersionedLayout(install.platform, install.appImage)) return undefined;
  const launcher = join(windowsInstallRoot(install.appDir), WINDOWS_LAUNCHER_EXE);
  return rawFs.existsSync(launcher) ? launcher : undefined;
}

/** What a pin of a running window should start: the launcher, so the pin never names a version folder. */
export function windowsRelaunchDetails(install: DesktopInstall): { appId: string; relaunchCommand: string; relaunchDisplayName: string; appIconPath: string } | undefined {
  const launcher = windowsStableLauncher(install);
  return launcher ? { appId: WINDOWS_APP_USER_MODEL_ID, relaunchCommand: `"${launcher}"`, relaunchDisplayName: "Branch Agent", appIconPath: launcher } : undefined;
}

/**
 * At launch on Windows: place the stable launcher at the install root from this package's resources/ (a newer
 * revision replaces it, the same one never does), then, once per launcher path, point every Branch Agent.lnk that
 * still opens a Branch Agent.exe under the root (a version folder or a legacy root copy) at the launcher. Links that
 * already open the launcher, or open anything else, are left alone. Returns the links it changed. A failure leaves
 * the marker unwritten, so the next launch tries again.
 */
export async function ensureWindowsLauncher(cfg: DesktopConfig, install: DesktopInstall, log: (line: string) => void = () => undefined,
  shortcuts: WindowsShortcuts = powershellShortcuts): Promise<string[]> {
  if (!usesWindowsVersionedLayout(install.platform, install.appImage)) return [];
  const root = windowsInstallRoot(install.appDir);
  const launcher = join(root, WINDOWS_LAUNCHER_EXE);
  const revisionFile = join(root, WINDOWS_LAUNCHER_REVISION_FILE);
  const bundled = join(install.resourcesDir, WINDOWS_LAUNCHER_RESOURCE);
  if ((!rawFs.existsSync(launcher) || await readOrEmpty(revisionFile) !== WINDOWS_LAUNCHER_REVISION) && rawFs.existsSync(bundled)) {
    const temporary = `${launcher}.${process.pid}.tmp`;
    try {
      await copyFile(bundled, temporary);
      await rename(temporary, launcher);
      await writeFile(revisionFile, `${WINDOWS_LAUNCHER_REVISION}\n`);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      log(`windows launcher: could not place ${WINDOWS_LAUNCHER_EXE} (${String(error)})`);
    }
  }
  // A package without the launcher (a development build) leaves the shortcuts as they are.
  if (!rawFs.existsSync(launcher)) return [];
  if (!rawFs.existsSync(join(root, WINDOWS_LAUNCHER))) await writeFile(join(root, WINDOWS_LAUNCHER), windowsLauncherScript()).catch(() => undefined);
  if (await readOrEmpty(shortcutMarker(cfg)) === shortcutMarkerValue(launcher)) return [];
  const listed = await shortcuts.list();
  const stale = listed.filter(link => windowsShortcutNeedsLauncher(link.target, root)).map(link => link.path);
  if (stale.length) await shortcuts.retarget(stale, launcher);
  if (shortcuts.repairWorkingDirectory) {
    const repair = listed.filter(link => stale.includes(link.path) || link.target === launcher).map(link => link.path);
    if (repair.length) await shortcuts.repairWorkingDirectory(repair);
  }
  await replaceFile(shortcutMarker(cfg), `${shortcutMarkerValue(launcher)}\n`);
  if (stale.length) log(`windows launcher: pointed ${stale.length} shortcut(s) at ${WINDOWS_LAUNCHER_EXE}`);
  return stale;
}
