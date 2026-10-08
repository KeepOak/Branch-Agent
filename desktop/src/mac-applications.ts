// Places the launchable macOS bundle in Applications and keeps the release signature stable.
// The engine and window data stay in ~/Library/Application Support; only the .app moves.
import { execFile } from "node:child_process";
import { access, appendFile, constants, cp, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

export const MAC_APP_NAME = "Branch";
export const MAC_BUNDLE_FOLDER = "Branch.app";
/** Folder at the root of the darwin release tarball. Installed copies look this name up. */
export const MAC_ARCHIVE_BUNDLE_FOLDER = "Branch Agent.app";
export const MAC_LEGACY_BUNDLE_FOLDER = MAC_ARCHIVE_BUNDLE_FOLDER;
export const MAC_BUNDLE_ID = "com.electron.branch-agent";
export const MAC_EXECUTABLE_NAME = "Branch Agent";
export const MAC_ICON_FILE = "branch.icns";

/** Pinned self-signed release identity. TeamIdentifier is "not set" until a Developer ID is used. */
export const macReleaseSigning = {
  bundleId: MAC_BUNDLE_ID,
  identitySha1: "30BBF0B68236AE05E063465C39DEA6C5B396B11C",
  teamId: "not set",
  designatedRequirement: `identifier "${MAC_BUNDLE_ID}" and certificate root = H"30bbf0b68236ae05e063465c39dea6c5b396b11c"`,
  p12Secret: "BRANCH_MACOS_SIGNING_P12",
  passwordSecret: "BRANCH_MACOS_SIGNING_PASSWORD",
} as const;

export const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export function darwinPackagerOptions(iconPath: string): { name: string; executableName: string; appBundleId: string; icon: string } {
  return { name: "Branch Agent", executableName: MAC_EXECUTABLE_NAME, appBundleId: MAC_BUNDLE_ID, icon: iconPath };
}

/** Names a staged archive may use. The tarball root stays `Branch Agent.app`; Applications publishes `Branch.app`. */
export function macBundleCandidates(installedAppDir: string): string[] {
  return [...new Set([basename(installedAppDir), MAC_BUNDLE_FOLDER, MAC_LEGACY_BUNDLE_FOLDER])];
}

export function chooseStagedMacBundle(installedAppDir: string, presentNames: readonly string[]): string {
  const chosen = macBundleCandidates(installedAppDir).find(name => presentNames.includes(name));
  if (!chosen) throw new Error(`Staged macOS app is missing ${macBundleCandidates(installedAppDir).join(" or ")}`);
  return chosen;
}

export function pathStaysInside(root: string, child: string): boolean {
  const rel = relative(resolve(root), resolve(child));
  if (!rel || isAbsolute(rel)) return false;
  return rel.split(sep).every(part => part !== ".." && part !== "");
}

export interface ApplicationsDirectoryOptions {
  applicationsDirectory?: string;
  systemApplications?: string;
  homeDirectory?: string;
  canWrite?: (directory: string) => Promise<boolean>;
}

export async function chooseApplicationsDirectory(options: ApplicationsDirectoryOptions = {}): Promise<string> {
  if (options.applicationsDirectory !== undefined && options.applicationsDirectory !== "") {
    if (!isAbsolute(options.applicationsDirectory)) throw new Error("Applications directory must be absolute");
    return options.applicationsDirectory;
  }
  const systemApplications = options.systemApplications ?? "/Applications";
  if (await (options.canWrite ?? defaultCanWrite)(systemApplications)) return systemApplications;
  const userApplications = join(options.homeDirectory ?? homedir(), "Applications");
  await mkdir(userApplications, { recursive: true });
  return userApplications;
}

async function defaultCanWrite(directory: string): Promise<boolean> {
  try {
    await access(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function setPlistString(plist: string, key: string, value: string): string {
  const escaped = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  if (pattern.test(plist)) return plist.replace(pattern, (_match, open: string, close: string) => `${open}${escaped}${close}`);
  const entry = `\t<key>${key}</key>\n\t<string>${escaped}</string>\n`;
  const close = plist.lastIndexOf("</dict>");
  if (close < 0) throw new Error("Info.plist has no dict");
  return `${plist.slice(0, close)}${entry}${plist.slice(close)}`;
}

function iconFileName(plist: string): string {
  const named = (/<key>CFBundleIconFile<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1] ?? MAC_ICON_FILE).trim();
  return named.endsWith(".icns") ? named : `${named}.icns`;
}

async function assertFile(file: string): Promise<void> {
  let info;
  try { info = await lstat(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Missing bundle file: ${basename(file)}`);
    throw error;
  }
  if (!info.isFile()) throw new Error(`Missing bundle file: ${basename(file)}`);
}

/** Writes the user-facing name and the stable bundle id. Call this before signing; do not restamp a signed bundle. */
export async function stampMacBundle(appDir: string): Promise<void> {
  const contents = join(appDir, "Contents");
  const plistPath = join(contents, "Info.plist");
  const original = await readFile(plistPath, "utf8");
  if (!original.includes("<key>")) throw new Error("Info.plist is not XML");
  let plist = setPlistString(original, "CFBundleName", MAC_APP_NAME);
  plist = setPlistString(plist, "CFBundleDisplayName", MAC_APP_NAME);
  plist = setPlistString(plist, "CFBundlePackageType", "APPL");
  plist = setPlistString(plist, "CFBundleIdentifier", MAC_BUNDLE_ID);
  if (!/<key>CFBundleIconFile<\/key>/.test(plist)) plist = setPlistString(plist, "CFBundleIconFile", MAC_ICON_FILE);
  await assertFile(join(contents, "MacOS", MAC_EXECUTABLE_NAME));
  await assertFile(join(contents, "Resources", iconFileName(plist)));
  await writeFile(plistPath, plist);
}

export interface InstallMacAppOptions extends ApplicationsDirectoryOptions {
  register?: (args: string[]) => Promise<void>;
  /** When this is the running bundle, it is unregistered and left in place. */
  runningAppDir?: string;
  stripQuarantine?: (app: string) => Promise<void>;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { windowsHide: true }, error => error ? reject(error) : resolvePromise());
  });
}

async function defaultRegister(args: string[]): Promise<void> {
  if (process.platform !== "darwin" || process.env.BRANCH_DESKTOP_TEST_DIST) return;
  await run(LSREGISTER, args);
}

async function stripQuarantine(app: string): Promise<void> {
  try { await run("xattr", ["-dr", "com.apple.quarantine", app]); } catch { /* already clear */ }
}

async function readBundleId(appDir: string): Promise<string> {
  const plist = await readFile(join(appDir, "Contents", "Info.plist"), "utf8");
  const id = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1];
  if (!id) throw new Error(`Missing CFBundleIdentifier in ${basename(appDir)}`);
  return id;
}

async function pathExists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch { return false; }
}

async function sameInstalledBundle(sourceReal: string, destination: string): Promise<boolean> {
  if (resolve(sourceReal) === resolve(destination)) return true;
  try { return await realpath(destination) === sourceReal; } catch { return false; }
}

async function retireLegacy(applicationsDir: string, destination: string, runningAppDir: string | undefined, register: (args: string[]) => Promise<void>): Promise<void> {
  const legacy = join(applicationsDir, MAC_LEGACY_BUNDLE_FOLDER);
  let info;
  try { info = await lstat(legacy); } catch { return; }
  if (info.isSymbolicLink() || !info.isDirectory()) return;
  const legacyReal = await realpath(legacy);
  const appsReal = await realpath(applicationsDir);
  if (!pathStaysInside(appsReal, legacyReal)) return;
  let id: string;
  try { id = await readBundleId(legacy); } catch { return; }
  if (id !== MAC_BUNDLE_ID) return;
  const destinationReal = await realpath(destination);
  const runningReal = runningAppDir ? await realpath(runningAppDir).catch(() => runningAppDir) : undefined;
  try { await register(["-u", legacy]); } catch { /* best effort */ }
  if (legacyReal === destinationReal || legacyReal === runningReal) return;
  await rm(legacy, { recursive: true, force: true });
}

/** Copies a stamped bundle to Branch.app, registers it, and drops a same-id legacy bundle that is not running. */
export async function installMacApp(source: string, options: InstallMacAppOptions = {}): Promise<string> {
  const id = await readBundleId(source);
  if (id !== MAC_BUNDLE_ID) throw new Error(`Refusing to install ${basename(source)} (${id})`);
  const applicationsDir = await chooseApplicationsDirectory(options);
  await mkdir(applicationsDir, { recursive: true });
  const destination = join(applicationsDir, MAC_BUNDLE_FOLDER);
  const sourceReal = await realpath(source);
  const register = options.register ?? defaultRegister;
  if (await sameInstalledBundle(sourceReal, destination)) {
    await register(["-f", destination]);
    await retireLegacy(applicationsDir, destination, options.runningAppDir ?? source, register);
    return destination;
  }
  const stageRoot = join(applicationsDir, `.Branch.install-${process.pid}`);
  const aside = join(applicationsDir, ".Branch.previous");
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot);
  const staging = join(stageRoot, MAC_BUNDLE_FOLDER);
  try {
    await cp(source, staging, { recursive: true, verbatimSymlinks: true } as import("node:fs").CopyOptions);
    if (options.stripQuarantine) await options.stripQuarantine(staging);
    else if (process.platform === "darwin") await stripQuarantine(staging);
    await rm(aside, { recursive: true, force: true });
    if (await pathExists(destination)) await rename(destination, aside);
    try {
      await rename(staging, destination);
    } catch (error) {
      if (await pathExists(aside) && !await pathExists(destination)) await rename(aside, destination);
      throw error;
    }
    await rm(aside, { recursive: true, force: true });
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
  await register(["-f", destination]);
  try { await register(["-u", source]); } catch { /* best effort */ }
  await retireLegacy(applicationsDir, destination, options.runningAppDir, register);
  return destination;
}

/** Publishes the running macOS bundle into Applications. Tests and non-mac launches skip it. */
export async function ensureMacApplicationsInstall(appDir: string, logFile: string): Promise<void> {
  if (process.platform !== "darwin" || process.env.BRANCH_DESKTOP_TEST_DIST || !appDir.endsWith(".app")) return;
  try {
    await installMacApp(appDir, { runningAppDir: appDir });
  } catch (error) {
    try {
      await appendFile(logFile, `${new Date().toISOString()} macOS Applications install failed: ${String(error)}\n`);
    } catch { /* a log failure must not block launch */ }
  }
}

/** Fails closed when a release signature is ad-hoc, unsigned, or different from the pinned identity. */
export function assertMacReleaseSignature(report: string, fingerprint: string): void {
  if (/Signature=adhoc/i.test(report) || /flags=0x2\(adhoc\)/.test(report)) {
    throw new Error("macOS release is ad-hoc signed");
  }
  const designated = report.split(/\r?\n/).map(line => line.trim()).find(line => line.startsWith("designated =>"));
  if (!designated) throw new Error("macOS release is unsigned");
  if (designated !== `designated => ${macReleaseSigning.designatedRequirement}`) {
    throw new Error("designated requirement differs from the pinned release identity");
  }
  const team = /^TeamIdentifier=(.*)$/m.exec(report);
  const teamId = team?.[1]?.trim();
  if (teamId !== macReleaseSigning.teamId) {
    throw new Error("TeamIdentifier differs from the pinned release identity");
  }
  const actual = fingerprint.replaceAll(":", "").trim().toUpperCase();
  if (actual !== macReleaseSigning.identitySha1) {
    throw new Error("signing identity fingerprint differs from the pinned release identity");
  }
}
