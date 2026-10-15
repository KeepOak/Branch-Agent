// Places the launchable macOS bundle in Applications and keeps the release signature stable.
// The engine and window data stay in ~/Library/Application Support; only the .app moves.
import { execFile } from "node:child_process";
import type * as NodeFs from "node:fs";
import { access, constants, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { appendCappedLog, BRANCH_LOG_LIMITS } from "./log-rotation";

export const MAC_APP_NAME = "Branch";
export const MAC_BUNDLE_FOLDER = "Branch.app";
/** Folder at the root of the darwin release tarball. Installed copies look this name up. */
export const MAC_ARCHIVE_BUNDLE_FOLDER = "Branch Agent.app";
export const MAC_LEGACY_BUNDLE_FOLDER = MAC_ARCHIVE_BUNDLE_FOLDER;
export const MAC_BUNDLE_ID = "com.electron.branch-agent";
export const MAC_EXECUTABLE_NAME = "Branch Agent";
export const MAC_ICON_FILE = "branch.icns";
/** The packaged name: Electron's helpers are "<this> Helper.app", so CFBundleName must stay this. */
export const MAC_HELPER_PREFIX = "Branch Agent";

/** Pinned self-signed release identity. TeamIdentifier is "not set" until a Developer ID is used. */
export const macReleaseSigning = {
  bundleId: MAC_BUNDLE_ID,
  identitySha1: "30BBF0B68236AE05E063465C39DEA6C5B396B11C",
  teamId: "not set",
  designatedRequirement: `identifier "${MAC_BUNDLE_ID}" and certificate root = H"30bbf0b68236ae05e063465c39dea6c5b396b11c"`,
  p12Secret: "BRANCH_MACOS_SIGNING_P12",
  passwordSecret: "BRANCH_MACOS_SIGNING_PASSWORD",
} as const;

/**
 * Electron's fs opens any path ending in .asar as an archive, so copying, removing or renaming a bundle's app.asar
 * from inside the app fails ("Invalid package"). original-fs touches the file's own bytes, as desktop-update.ts does.
 */
const rawFs: typeof NodeFs = process.versions.electron ? require("original-fs") : require("node:fs");
/** The file calls the installer makes. Tests pass a fake that behaves like Electron's fs. */
export type MacBundleFs = typeof NodeFs.promises;

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

/** A packaged bundle (one with Frameworks) must carry the main helper Electron looks up from CFBundleName. */
async function assertHelpers(contents: string): Promise<void> {
  const frameworks = join(contents, "Frameworks");
  try { await lstat(frameworks); } catch { return; }
  const helper = `${MAC_HELPER_PREFIX} Helper`;
  await assertFile(join(frameworks, `${helper}.app`, "Contents", "MacOS", helper));
}

/** Writes the user-facing name and the stable bundle id. Call this before signing; do not restamp a signed bundle. */
export async function stampMacBundle(appDir: string): Promise<void> {
  const contents = join(appDir, "Contents");
  const plistPath = join(contents, "Info.plist");
  const original = await readFile(plistPath, "utf8");
  if (!original.includes("<key>")) throw new Error("Info.plist is not XML");
  // Electron finds its helpers as "<CFBundleName> Helper.app" under Frameworks, so CFBundleName stays the packaged
  // name; renaming it to "Branch" made 0.4.4-build-0daa39ebe50a abort at launch ("Unable to find helper app").
  // Finder, the Dock and Spotlight show CFBundleDisplayName.
  let plist = setPlistString(original, "CFBundleName", MAC_HELPER_PREFIX);
  plist = setPlistString(plist, "CFBundleDisplayName", MAC_APP_NAME);
  plist = setPlistString(plist, "CFBundlePackageType", "APPL");
  plist = setPlistString(plist, "CFBundleIdentifier", MAC_BUNDLE_ID);
  if (!/<key>CFBundleIconFile<\/key>/.test(plist)) plist = setPlistString(plist, "CFBundleIconFile", MAC_ICON_FILE);
  await assertFile(join(contents, "MacOS", MAC_EXECUTABLE_NAME));
  await assertFile(join(contents, "Resources", iconFileName(plist)));
  await assertHelpers(contents);
  await writeFile(plistPath, plist);
}

export interface InstallMacAppOptions extends ApplicationsDirectoryOptions {
  register?: (args: string[]) => Promise<void>;
  /** When this is the running bundle, it is unregistered and left in place. */
  runningAppDir?: string;
  stripQuarantine?: (app: string) => Promise<void>;
  /** Signature report for an app (`codesign -d -r- --verbose=2`), or undefined where it cannot be read. */
  readSignature?: (app: string) => Promise<string | undefined>;
  /** The file API for the bundle tree. Defaults to the one that does not treat app.asar as an archive. */
  fs?: MacBundleFs;
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

/** An app's codesign report on macOS; undefined elsewhere and under tests. */
export async function readMacSignature(app: string): Promise<string | undefined> {
  if (process.platform !== "darwin" || process.env.BRANCH_DESKTOP_TEST_DIST) return undefined;
  return new Promise(resolvePromise => {
    execFile("codesign", ["-d", "-r-", "--verbose=2", app], { windowsHide: true }, (_error, stdout, stderr) => resolvePromise(`${stderr}\n${stdout}`));
  });
}

async function stripQuarantine(app: string): Promise<void> {
  try { await run("xattr", ["-dr", "com.apple.quarantine", app]); } catch { /* already clear */ }
}

async function readBundleId(fs: MacBundleFs, appDir: string): Promise<string> {
  const plist = await fs.readFile(join(appDir, "Contents", "Info.plist"), "utf8");
  const id = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1];
  if (!id) throw new Error(`Missing CFBundleIdentifier in ${basename(appDir)}`);
  return id;
}

async function pathExists(fs: MacBundleFs, file: string): Promise<boolean> {
  try { await fs.lstat(file); return true; } catch { return false; }
}

async function sameInstalledBundle(fs: MacBundleFs, sourceReal: string, destination: string): Promise<boolean> {
  if (resolve(sourceReal) === resolve(destination)) return true;
  try { return await fs.realpath(destination) === sourceReal; } catch { return false; }
}

async function retireLegacy(fs: MacBundleFs, applicationsDir: string, destination: string, runningAppDir: string | undefined,
  register: (args: string[]) => Promise<void>): Promise<void> {
  const legacy = join(applicationsDir, MAC_LEGACY_BUNDLE_FOLDER);
  let info;
  try { info = await fs.lstat(legacy); } catch { return; }
  if (info.isSymbolicLink() || !info.isDirectory()) return;
  const legacyReal = await fs.realpath(legacy);
  const appsReal = await fs.realpath(applicationsDir);
  if (!pathStaysInside(appsReal, legacyReal)) return;
  let id: string;
  try { id = await readBundleId(fs, legacy); } catch { return; }
  if (id !== MAC_BUNDLE_ID) return;
  const destinationReal = await fs.realpath(destination);
  const runningReal = runningAppDir ? await fs.realpath(runningAppDir).catch(() => runningAppDir) : undefined;
  try { await register(["-u", legacy]); } catch { /* best effort */ }
  if (legacyReal === destinationReal || legacyReal === runningReal) return;
  await fs.rm(legacy, { recursive: true, force: true });
}

/** Copies a stamped bundle to Branch.app, registers it, and drops a same-id legacy bundle that is not running. */
export async function installMacApp(source: string, options: InstallMacAppOptions = {}): Promise<string> {
  const fs = options.fs ?? rawFs.promises;
  const id = await readBundleId(fs, source);
  if (id !== MAC_BUNDLE_ID) throw new Error(`Refusing to install ${basename(source)} (${id})`);
  const applicationsDir = await chooseApplicationsDirectory(options);
  await fs.mkdir(applicationsDir, { recursive: true });
  const destination = join(applicationsDir, MAC_BUNDLE_FOLDER);
  const sourceReal = await fs.realpath(source);
  const register = options.register ?? defaultRegister;
  if (await sameInstalledBundle(fs, sourceReal, destination)) {
    await register(["-f", destination]);
    await retireLegacy(fs, applicationsDir, destination, options.runningAppDir ?? source, register);
    return destination;
  }
  if (await pathExists(fs, destination)) {
    const readSignature = options.readSignature ?? readMacSignature;
    assertNoMacSigningDowngrade(await readSignature(destination), await readSignature(source));
  }
  const stageRoot = join(applicationsDir, `.Branch.install-${process.pid}`);
  const aside = join(applicationsDir, ".Branch.previous");
  await fs.rm(stageRoot, { recursive: true, force: true });
  await fs.mkdir(stageRoot);
  const staging = join(stageRoot, MAC_BUNDLE_FOLDER);
  try {
    await fs.cp(source, staging, { recursive: true, verbatimSymlinks: true } as import("node:fs").CopyOptions);
    if (options.stripQuarantine) await options.stripQuarantine(staging);
    else if (process.platform === "darwin") await stripQuarantine(staging);
    await fs.rm(aside, { recursive: true, force: true });
    if (await pathExists(fs, destination)) await fs.rename(destination, aside);
    try {
      await fs.rename(staging, destination);
    } catch (error) {
      if (await pathExists(fs, aside) && !await pathExists(fs, destination)) await fs.rename(aside, destination);
      throw error;
    }
    await fs.rm(aside, { recursive: true, force: true });
  } finally {
    await fs.rm(stageRoot, { recursive: true, force: true });
  }
  await register(["-f", destination]);
  try { await register(["-u", source]); } catch { /* best effort */ }
  await retireLegacy(fs, applicationsDir, destination, options.runningAppDir, register);
  return destination;
}

/** Publishes the running macOS bundle into Applications. Tests and non-mac launches skip it. */
export async function ensureMacApplicationsInstall(appDir: string, logFile: string): Promise<void> {
  if (process.platform !== "darwin" || process.env.BRANCH_DESKTOP_TEST_DIST || !appDir.endsWith(".app")) return;
  try {
    await installMacApp(appDir, { runningAppDir: appDir });
  } catch (error) {
    try {
      appendCappedLog(logFile, `${new Date().toISOString()} macOS Applications install failed: ${String(error)}\n`, BRANCH_LOG_LIMITS);
    } catch { /* a log failure must not block launch */ }
  }
}

/** How a release declares its macOS app is signed (release proof `signing`, set by scripts/mac-release-signing.mjs). */
export type MacReleaseSigningKind = "identity" | "adhoc";

/** True when a `codesign -dv` report shows an ad-hoc signature. */
export function macSignatureIsAdhoc(report: string): boolean {
  return /Signature=adhoc/i.test(report) || /flags=0x[0-9a-f]*\(adhoc[,)]/i.test(report);
}

function designatedRequirement(report: string): string | undefined {
  return report.split(/\r?\n/).map(line => line.trim()).find(line => line.startsWith("designated =>"));
}

/** True when a `codesign -dr -` report carries the pinned release identity's designated requirement. */
export function macSignatureIsPinnedIdentity(report: string): boolean {
  return !macSignatureIsAdhoc(report) && designatedRequirement(report) === `designated => ${macReleaseSigning.designatedRequirement}`;
}

/**
 * Never trade a Branch app signed with the pinned identity for an ad-hoc (or unsigned) copy: macOS would treat it
 * as a different app, and its Keychain items and privacy grants would stop applying.
 */
export function assertNoMacSigningDowngrade(installedReport: string | undefined, incomingReport: string | undefined): void {
  if (!installedReport || !macSignatureIsPinnedIdentity(installedReport)) return;
  if (incomingReport !== undefined && macSignatureIsPinnedIdentity(incomingReport)) return;
  const kind = incomingReport !== undefined && macSignatureIsAdhoc(incomingReport) ? "an ad-hoc signed" : "an unsigned or differently signed";
  throw new Error(`Refusing to replace a Branch app signed with the pinned release identity by ${kind} copy`);
}

/**
 * Checks a release's macOS signature against what the release declares (its proof's `signing`). An ad-hoc signature
 * passes only when the release declares "adhoc"; otherwise it must be the pinned identity. Unsigned always fails.
 */
export function assertMacReleaseSignature(report: string, fingerprint: string, declared: MacReleaseSigningKind = "identity"): void {
  if (declared !== "identity" && declared !== "adhoc") throw new Error(`Unknown declared macOS signing: ${String(declared)}`);
  const designated = designatedRequirement(report);
  if (macSignatureIsAdhoc(report)) {
    if (declared !== "adhoc") throw new Error("macOS release is ad-hoc signed but declares the pinned release identity");
    const identifier = /^Identifier=(.*)$/m.exec(report)?.[1]?.trim();
    if (identifier !== MAC_BUNDLE_ID) throw new Error("ad-hoc signature identifier differs from the Branch bundle id");
    return;
  }
  if (!designated) throw new Error("macOS release is unsigned");
  if (declared === "adhoc") throw new Error("macOS release declares ad-hoc signing but carries another signature");
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
